import crypto from "node:crypto";
import type { PipelineConfig, PipelineResult, Implementation, TaxonomyEvaluationResult } from "../types/pipeline.js";
import type { ChecklistItem, TestCase } from "../types/tc.js";
import type { EvaluationResult } from "../types/pipeline.js";
import { parseSpreadsheetUrl, findSheetName, readSheetValues } from "../sheets/reader.js";
import { createSheet, writeHeaders, writeTestCases, clearSheetData } from "../sheets/writer.js";
import { env } from "../config/env.js";
import { getSkill } from "../skills/registry.js";
import { skillManifestToResolved } from "../skills/resolved-skill.js";
import { detectHeaderAndData } from "../pipeline/plan.js";
import { sortGlobalCommonTcFirstAndRenumber } from "../pipeline/generator.js";
import {
  resolvePipelineDebugRoot,
  writePipelineDebugJson,
} from "../pipeline/pipeline-debug.js";
import {
  formatLlmJsonFailureForUi,
  getLlmJsonLogCharLimit,
  LlmJsonParseError,
} from "../llm/gemini-client.js";
import { runTaxonomyPhase } from "./llm-taxonomy-agent.js";
import { eventBus } from "./event-bus.js";
import { getAgent } from "./registry.js";
import { createExecution, updateAgentState, completeExecution } from "./store.js";
import type { PlanInput } from "./deterministic-plan-agent.js";
import type { GeneratorInput } from "./deterministic-generator-agent.js";
import type { MergeInput } from "./llm-merge-agent.js";
import type { EvaluatorInput } from "./deterministic-evaluator-agent.js";
import type { TaxonomyEvaluatorInput } from "./deterministic-taxonomy-evaluator-agent.js";

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

const PIPELINE_MAX_TOTAL_TCS = process.env.PIPELINE_MAX_TOTAL_TCS
  ? parseInt(process.env.PIPELINE_MAX_TOTAL_TCS)
  : 800;

function failedPipelineResult(
  targetSheetName: string,
  message: string,
  opts?: { llmJsonFailureLog?: string },
): PipelineResult {
  return {
    success: false,
    sheetName: targetSheetName,
    rounds: 0,
    stats: {
      totalTCs: 0,
      domainDistribution: {},
      priorityDistribution: { P0: 0, P1: 0, P2: 0 },
      typeDistribution: { Functional: 0, Negative: 0, Boundary: 0, Regression: 0, Accessibility: 0, Security: 0 },
      coverageGaps: [`PIPELINE_ERROR: ${message}`],
      mappingGaps: [],
    },
    evaluationIssues: [{ type: "schema", message }],
    ...(opts?.llmJsonFailureLog ? { llmJsonFailureLog: opts.llmJsonFailureLog } : {}),
  };
}

function applyTotalTcCap(testCases: TestCase[], reason: string): TestCase[] {
  if (testCases.length <= PIPELINE_MAX_TOTAL_TCS) return testCases;
  console.warn(
    `[orchestrator] total TC cap applied (${reason}): ${testCases.length} -> ${PIPELINE_MAX_TOTAL_TCS}`,
  );
  return testCases.slice(0, PIPELINE_MAX_TOTAL_TCS);
}

function emitPipelineFinished(pipelineId: string): void {
  eventBus.emit(pipelineId, {
    agentId: "orchestrator",
    agentType: "evaluator",
    status: "completed",
    progress: 100,
    message: "파이프라인 종료",
    timestamp: new Date().toISOString(),
    payload: { pipelineFinished: true },
  });
}

export async function orchestrate(
  config: PipelineConfig,
  options?: { pipelineId?: string },
): Promise<PipelineResult & { pipelineId: string }> {
  const pipelineId = options?.pipelineId ?? crypto.randomUUID().slice(0, 8);
  const impl: Implementation = config.implementation ?? "llm";
  const manifest = getSkill(config.skillId);

  createExecution(pipelineId, config as unknown as Record<string, unknown>);

  console.log(
    `[orchestrator] pipeline=${pipelineId} impl=${impl} skill=${manifest.id} domainMode=${config.domainMode ?? "preset"}`,
  );

  try {
    return await runOrchestrationBody(pipelineId, config, impl, manifest);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[orchestrator] pipeline=${pipelineId} failed:`, err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    if (err instanceof LlmJsonParseError) {
      const detail = formatLlmJsonFailureForUi(err, getLlmJsonLogCharLimit());
      process.stderr.write(`\n[orchestrator] ========== LLM JSON FAILURE (copy for debug) ==========\n${detail}\n[orchestrator] ========== END LLM JSON FAILURE ==========\n\n`);
    }
    const llmLog = err instanceof LlmJsonParseError ? formatLlmJsonFailureForUi(err, 24_000) : undefined;
    const failure = failedPipelineResult(config.targetSheetName, message, { llmJsonFailureLog: llmLog });
    completeExecution(pipelineId, failure);
    emitPipelineFinished(pipelineId);
    throw err;
  }
}

async function runOrchestrationBody(
  pipelineId: string,
  config: PipelineConfig,
  impl: Implementation,
  manifest: ReturnType<typeof getSkill>,
): Promise<PipelineResult & { pipelineId: string }> {
  const { spreadsheetId, gid } = parseSpreadsheetUrl(config.spreadsheetUrl);
  const sourceSheetName = await findSheetName(spreadsheetId, {
    sheetName: config.sourceSheetName,
    gid: config.sourceGid ?? gid ?? undefined,
  });

  const raw = await readSheetValues(spreadsheetId, `'${sourceSheetName}'!A1:ZZ`);
  if (raw.length < 2) {
    throw new Error(`Source sheet '${sourceSheetName}' has no data rows`);
  }

  const agentConfig = { pipelineId, skillId: config.skillId, domainScope: config.domainScope, implementation: impl };

  let resolved = skillManifestToResolved(manifest);
  if (config.domainMode === "discovered") {
    if (!env.geminiApiKey) {
      throw new Error("domainMode 'discovered' requires GEMINI_API_KEY in environment");
    }
    const { headers, dataRows } = detectHeaderAndData(raw);
    const sampleRows = dataRows.slice(0, 30);
    const maxTaxonomyRetries = 2;
    const taxEvalAgent = getAgent<TaxonomyEvaluatorInput, TaxonomyEvaluationResult>("taxonomy-evaluator", impl);

    for (let attempt = 0; attempt <= maxTaxonomyRetries; attempt++) {
      resolved = await runTaxonomyPhase(
        { headers, sampleRows, sourceSheetName, baseSkill: manifest },
        eventBus,
        pipelineId,
      );

      const taxEvalResult = await taxEvalAgent.run(
        { resolvedSkill: resolved, headers, sampleRows },
        eventBus,
        agentConfig,
      );

      if (taxEvalResult.data?.passed) {
        updateAgentState(pipelineId, {
          agentId: taxEvalResult.agentId, agentType: "taxonomy-evaluator",
          status: "completed", progress: 100,
          message: "Taxonomy 검증 통과", durationMs: taxEvalResult.durationMs,
        });
        break;
      }

      const issueCount = taxEvalResult.data?.issues.length ?? 0;
      console.log(
        `[orchestrator] taxonomy-eval attempt ${attempt + 1}/${maxTaxonomyRetries + 1}: ${issueCount} issues`,
      );

      if (attempt === maxTaxonomyRetries) {
        updateAgentState(pipelineId, {
          agentId: taxEvalResult.agentId, agentType: "taxonomy-evaluator",
          status: "completed", progress: 100,
          message: `Taxonomy 검증 미통과 (${issueCount}건), 현재 결과로 계속 진행`,
          durationMs: taxEvalResult.durationMs,
        });
        console.warn(`[orchestrator] taxonomy-eval failed after ${maxTaxonomyRetries + 1} attempts, proceeding with current taxonomy`);
      }
    }
  }

  // --- Plan ---
  const planAgent = getAgent<PlanInput, ChecklistItem[]>("plan", impl);

  const planResult = await planAgent.run(
    { raw, sourceSheetName, resolvedSkill: resolved },
    eventBus,
    agentConfig,
  );

  if (planResult.status === "failed" || !planResult.data) {
    throw new Error(`Plan failed: ${planResult.error}`);
  }

  updateAgentState(pipelineId, {
    agentId: planResult.agentId, agentType: "plan",
    status: "completed", progress: 100,
    message: `${planResult.data.length}건 체크리스트`, durationMs: planResult.durationMs,
  });

  const fullChecklist = planResult.data;
  const scopedChecklist =
    config.domainScope === "ALL"
      ? fullChecklist
      : fullChecklist.filter((c) => c.domain.toUpperCase() === config.domainScope);

  if (scopedChecklist.length === 0) {
    throw new Error(`No checklist items match domain scope '${config.domainScope}'`);
  }

  const debugRoot = resolvePipelineDebugRoot(env.pipelineDebugDir);
  if (debugRoot) {
    await writePipelineDebugJson(debugRoot, pipelineId, "plan/full-checklist.json", fullChecklist);
    await writePipelineDebugJson(debugRoot, pipelineId, "plan/scoped-checklist.json", scopedChecklist);
    await writePipelineDebugJson(debugRoot, pipelineId, "plan/meta.json", {
      savedAt: new Date().toISOString(),
      pipelineId,
      domainScope: config.domainScope,
      sourceSheetName,
      targetSheetName: config.targetSheetName,
      skillId: config.skillId,
      implementation: impl,
      fullChecklistCount: fullChecklist.length,
      scopedChecklistCount: scopedChecklist.length,
      planDurationMs: planResult.durationMs,
      planAgentId: planResult.agentId,
    });
  }

  // --- Prepare sheet ---
  const sheetName = await createSheet(spreadsheetId, config.targetSheetName);
  await writeHeaders(spreadsheetId, sheetName);

  // --- Batch loop: generator만 (Evaluator는 전체 완료 후 1회) ---
  const genAgent = getAgent<GeneratorInput, TestCase[]>("generator", impl);
  const evalAgent = getAgent<EvaluatorInput, EvaluationResult>("evaluator", impl);
  const genConfig = {
    ownerDefault: config.ownerDefault,
    environmentDefault: config.environmentDefault,
    maxTcPerRequirement: config.maxTcPerRequirement,
  };
  const evalConfig = { ownerDefault: config.ownerDefault, environmentDefault: config.environmentDefault };

  const batches = chunkArray(scopedChecklist, env.llmGenBatchSize);
  const totalBatches = batches.length;
  const allBatchTcs: TestCase[][] = [];
  let tcCounter = 1;

  console.log(`[orchestrator] ${scopedChecklist.length}건 → ${totalBatches}배치 생성 (배치 ${env.llmGenBatchSize}건, Evaluator는 마지막 1회)`);

  eventBus.emit(pipelineId, {
    agentId: "orchestrator",
    agentType: "generator",
    status: "running",
    progress: 0,
    message: `${scopedChecklist.length}건 체크리스트 → ${totalBatches}배치 생성 중 (검증은 전체 완료 후 1회)`,
    timestamp: new Date().toISOString(),
    payload: {
      phase: "batch_generate",
      batchTotal: totalBatches,
      checklistTotal: scopedChecklist.length,
      batchSize: env.llmGenBatchSize,
    },
  });

  for (let bi = 0; bi < totalBatches; bi++) {
    const batchChecklist = batches[bi]!;
    const batchLabel = `배치 ${bi + 1}/${totalBatches}`;

    eventBus.emit(pipelineId, {
      agentId: "orchestrator",
      agentType: "generator",
      status: "running",
      progress: Math.round((bi / Math.max(totalBatches, 1)) * 55),
      message: `${batchLabel}: TC 생성 중 (${batchChecklist.length}건 체크리스트)…`,
      timestamp: new Date().toISOString(),
      payload: {
        phase: "batch_generate",
        batchCurrent: bi + 1,
        batchTotal: totalBatches,
        checklistInBatch: batchChecklist.length,
        tcCountSoFar: tcCounter - 1,
      },
    });

    const genResult = await genAgent.run(
      { checklist: batchChecklist, config: genConfig, resolvedSkill: resolved },
      eventBus,
      agentConfig,
    );

    if (genResult.status === "failed" || !genResult.data) {
      throw new Error(`Generator failed at ${batchLabel}: ${genResult.error}`);
    }

    const batchTcs = applyTotalTcCap(genResult.data, batchLabel);

    for (const tc of batchTcs) {
      tc.TC_ID = `TC-${String(tcCounter++).padStart(4, "0")}`;
    }

    if (debugRoot) {
      const bn = String(bi + 1).padStart(3, "0");
      await writePipelineDebugJson(debugRoot, pipelineId, `generator/batch-${bn}-input.json`, {
        savedAt: new Date().toISOString(),
        batchIndex: bi + 1,
        batchTotal: totalBatches,
        checklist: batchChecklist,
        config: genConfig,
        resolvedSkill: resolved,
      });
      await writePipelineDebugJson(debugRoot, pipelineId, `generator/batch-${bn}-output.json`, {
        savedAt: new Date().toISOString(),
        batchIndex: bi + 1,
        testCases: batchTcs,
        generatorDurationMs: genResult.durationMs,
        generatorAgentId: genResult.agentId,
      });
    }

    await writeTestCases(spreadsheetId, sheetName, batchTcs);
    allBatchTcs.push(batchTcs);

    const batchProgress = Math.round(((bi + 1) / Math.max(totalBatches, 1)) * 55);
    eventBus.emit(pipelineId, {
      agentId: "orchestrator",
      agentType: "generator",
      status: "running",
      progress: batchProgress,
      message: `${batchLabel}: 생성 ${batchTcs.length}건 → Sheets 기록 (누적 TC ${tcCounter - 1}건)`,
      timestamp: new Date().toISOString(),
      payload: {
        phase: "batch_generate",
        batchCurrent: bi + 1,
        batchTotal: totalBatches,
        tcGeneratedThisBatch: batchTcs.length,
        tcCountSoFar: tcCounter - 1,
      },
    });

    console.log(`[orchestrator] ${batchLabel} done: ${batchTcs.length} TCs written`);
  }

  let allTestCases = allBatchTcs.flat();
  allTestCases = applyTotalTcCap(allTestCases, "all batches combined");

  if (debugRoot) {
    await writePipelineDebugJson(debugRoot, pipelineId, "generator/all-batches-output.json", {
      savedAt: new Date().toISOString(),
      testCases: allTestCases,
      totalCount: allTestCases.length,
    });
  }

  // --- Evaluator 1회 (+ fallback은 전체 스코프) ---
  let totalRounds = 1;
  let lastEvalResult: Awaited<ReturnType<typeof evalAgent.run>> | null = null;

  eventBus.emit(pipelineId, {
    agentId: "orchestrator",
    agentType: "evaluator",
    status: "running",
    progress: 58,
    message: `전체 검증 시작: 체크리스트 ${scopedChecklist.length}건, TC ${allTestCases.length}건`,
    timestamp: new Date().toISOString(),
    payload: {
      phase: "final_eval",
      checklistTotal: scopedChecklist.length,
      totalTcCount: allTestCases.length,
      evalRound: 0,
    },
  });

  let evalResult = await evalAgent.run(
    {
      checklist: scopedChecklist,
      testCases: allTestCases,
      resolvedSkill: resolved,
      config: evalConfig,
    },
    eventBus,
    agentConfig,
  );

  if (evalResult.status === "failed" || !evalResult.data) {
    throw new Error(`Evaluator failed (final): ${evalResult.error}`);
  }

  lastEvalResult = evalResult;
  const repairedAfterFirst = (evalResult.data as EvaluationResult & { repairedTestCases?: TestCase[] })
    .repairedTestCases;
  if (repairedAfterFirst) {
    allTestCases = applyTotalTcCap(repairedAfterFirst, "final evaluator repair");
  }

  let round = 1;
  const maxRounds = config.maxFallbackRounds;

  while (
    !evalResult.data.passed &&
    evalResult.data.uncoveredItems.length > 0 &&
    round <= maxRounds
  ) {
    console.log(
      `[orchestrator] final fallback round ${round}: ${evalResult.data.uncoveredItems.length} uncovered`,
    );

    eventBus.emit(pipelineId, {
      agentId: "orchestrator",
      agentType: "evaluator",
      status: "running",
      progress: 60 + Math.min(15, round * 5),
      message: `Fallback ${round}/${maxRounds}: 미커버 ${evalResult.data.uncoveredItems.length}건 보완 생성 중…`,
      timestamp: new Date().toISOString(),
      payload: {
        phase: "final_fallback",
        uncoveredCount: evalResult.data.uncoveredItems.length,
        evalRound: round,
        maxFallbackRounds: maxRounds,
        totalTcCount: allTestCases.length,
      },
    });

    const extraResult = await genAgent.run(
      { checklist: evalResult.data.uncoveredItems, config: genConfig, resolvedSkill: resolved },
      eventBus,
      agentConfig,
    );

    if (extraResult.data?.length) {
      let n = tcCounter;
      for (const tc of extraResult.data) {
        tc.TC_ID = `TC-${String(n++).padStart(4, "0")}`;
      }
      tcCounter = n;
      allTestCases = applyTotalTcCap([...allTestCases, ...extraResult.data], `final fallback ${round}`);
    }

    await clearSheetData(spreadsheetId, sheetName);
    await writeTestCases(spreadsheetId, sheetName, allTestCases);

    evalResult = await evalAgent.run(
      {
        checklist: scopedChecklist,
        testCases: allTestCases,
        resolvedSkill: resolved,
        config: evalConfig,
      },
      eventBus,
      agentConfig,
    );

    if (!evalResult.data) break;

    lastEvalResult = evalResult;
    const extraRepaired = (evalResult.data as EvaluationResult & { repairedTestCases?: TestCase[] })
      .repairedTestCases;
    if (extraRepaired) {
      allTestCases = applyTotalTcCap(extraRepaired, `final repair round ${round}`);
      await clearSheetData(spreadsheetId, sheetName);
      await writeTestCases(spreadsheetId, sheetName, allTestCases);
    }

    totalRounds += 1;
    round++;
  }

  await clearSheetData(spreadsheetId, sheetName);
  await writeTestCases(spreadsheetId, sheetName, allTestCases);

  updateAgentState(pipelineId, {
    agentId: lastEvalResult?.agentId ?? "evaluator",
    agentType: "evaluator",
    status: "completed",
    progress: 100,
    message: `전체 검증 완료 (TC ${allTestCases.length}건, Evaluator·Fallback ${totalRounds}회)`,
    durationMs: lastEvalResult?.durationMs ?? 0,
  });

  // --- Merge (optional, 전체 TC 대상) ---
  if (config.mergeSimilarTestCases) {
    const mergeAgent = getAgent<MergeInput, TestCase[]>("merge", impl);
    const mergeResult = await mergeAgent.run(
      { testCases: allTestCases },
      eventBus,
      agentConfig,
    );

    if (mergeResult.data) {
      const before = allTestCases.length;
      allTestCases = applyTotalTcCap(
        sortGlobalCommonTcFirstAndRenumber(mergeResult.data),
        "merge",
      );
      console.log(`[orchestrator] merge: ${before} → ${allTestCases.length} TCs`);

      // merge 결과로 시트 덮어쓰기
      await clearSheetData(spreadsheetId, sheetName);
      await writeTestCases(spreadsheetId, sheetName, allTestCases);
    }

    updateAgentState(pipelineId, {
      agentId: mergeResult.agentId, agentType: "merge",
      status: "completed", progress: 100,
      message: mergeResult.data
        ? `병합 완료 (${mergeResult.data.length}건)`
        : "병합 스킵 (원본 유지)",
      durationMs: mergeResult.durationMs,
    });
  }

  console.log(`[orchestrator] wrote ${allTestCases.length} TCs to '${sheetName}' (${totalBatches} batches, ${totalRounds} total rounds)`);

  const finalStats = lastEvalResult?.data?.stats ?? {
    totalTCs: allTestCases.length,
    domainDistribution: {},
    priorityDistribution: { P0: 0, P1: 0, P2: 0 },
    typeDistribution: { Functional: 0, Negative: 0, Boundary: 0, Regression: 0, Accessibility: 0, Security: 0 },
    coverageGaps: [],
    mappingGaps: [],
  };
  finalStats.totalTCs = allTestCases.length;

  const result: PipelineResult & { pipelineId: string } = {
    pipelineId,
    success: lastEvalResult?.data?.passed ?? true,
    sheetName,
    rounds: totalRounds,
    stats: finalStats,
    evaluationIssues: lastEvalResult?.data?.issues ?? [],
  };

  completeExecution(pipelineId, result);
  emitPipelineFinished(pipelineId);
  return result;
}
