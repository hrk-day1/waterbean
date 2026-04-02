import crypto from "node:crypto";
import type { PipelineConfig, PipelineResult, Implementation, TaxonomyEvaluationResult } from "../types/pipeline.js";
import type { ChecklistItem, TestCase } from "../types/tc.js";
import type { EvaluationResult } from "../types/pipeline.js";
import { parseSpreadsheetUrl, findSheetName, readSheetValues } from "../sheets/reader.js";
import { createSheet, writeHeaders, writeTestCases } from "../sheets/writer.js";
import { env } from "../config/env.js";
import { getSkill } from "../skills/registry.js";
import { skillManifestToResolved } from "../skills/resolved-skill.js";
import { detectHeaderAndData } from "../pipeline/plan.js";
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
import type { EvaluatorInput } from "./deterministic-evaluator-agent.js";
import type { TaxonomyEvaluatorInput } from "./deterministic-taxonomy-evaluator-agent.js";

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

  // --- Generator ---
  const genAgent = getAgent<GeneratorInput, TestCase[]>("generator", impl);
  const genConfig = {
    ownerDefault: config.ownerDefault,
    environmentDefault: config.environmentDefault,
    maxTcPerRequirement: config.maxTcPerRequirement,
  };

  const genResult = await genAgent.run(
    { checklist: scopedChecklist, config: genConfig, resolvedSkill: resolved },
    eventBus,
    agentConfig,
  );

  if (genResult.status === "failed" || !genResult.data) {
    throw new Error(`Generator failed: ${genResult.error}`);
  }

  updateAgentState(pipelineId, {
    agentId: genResult.agentId, agentType: "generator",
    status: "completed", progress: 100,
    message: `${genResult.data.length}건 TC 생성`, durationMs: genResult.durationMs,
  });

  let allTestCases = genResult.data;

  // --- Evaluator (with fallback loop) ---
  const evalAgent = getAgent<EvaluatorInput, EvaluationResult>("evaluator", impl);
  const evalInput: EvaluatorInput = {
    checklist: scopedChecklist,
    testCases: allTestCases,
    resolvedSkill: resolved,
    config: { ownerDefault: config.ownerDefault, environmentDefault: config.environmentDefault },
  };

  let evalResult = await evalAgent.run(evalInput, eventBus, agentConfig);

  if (evalResult.status === "failed" || !evalResult.data) {
    throw new Error(`Evaluator failed: ${evalResult.error}`);
  }

  const repairedTcs = (evalResult.data as EvaluationResult & { repairedTestCases?: TestCase[] }).repairedTestCases;
  if (repairedTcs) {
    allTestCases = repairedTcs;
  }

  let round = 1;
  const maxRounds = config.maxFallbackRounds;

  while (
    !evalResult.data.passed &&
    evalResult.data.uncoveredItems.length > 0 &&
    round <= maxRounds
  ) {
    console.log(`[orchestrator] fallback round ${round}: ${evalResult.data.uncoveredItems.length} uncovered`);

    const extraResult = await genAgent.run(
      { checklist: evalResult.data.uncoveredItems, config: genConfig, resolvedSkill: resolved },
      eventBus,
      agentConfig,
    );

    if (extraResult.data) {
      allTestCases = [...allTestCases, ...extraResult.data];
    }

    evalResult = await evalAgent.run(
      { checklist: scopedChecklist, testCases: allTestCases, resolvedSkill: resolved, config: evalInput.config },
      eventBus,
      agentConfig,
    );

    if (!evalResult.data) break;

    const extraRepaired = (evalResult.data as EvaluationResult & { repairedTestCases?: TestCase[] }).repairedTestCases;
    if (extraRepaired) {
      allTestCases = extraRepaired;
    }

    round++;
  }

  updateAgentState(pipelineId, {
    agentId: evalResult.agentId, agentType: "evaluator",
    status: "completed", progress: 100,
    message: `검증 ${evalResult.data!.passed ? "통과" : "미통과"}`,
    durationMs: evalResult.durationMs,
  });

  // --- Write ---
  const sheetName = await createSheet(spreadsheetId, config.targetSheetName);
  await writeHeaders(spreadsheetId, sheetName);
  await writeTestCases(spreadsheetId, sheetName, allTestCases);

  console.log(`[orchestrator] wrote ${allTestCases.length} TCs to '${sheetName}' after ${round} round(s)`);

  const result: PipelineResult & { pipelineId: string } = {
    pipelineId,
    success: evalResult.data!.passed,
    sheetName,
    rounds: round,
    stats: evalResult.data!.stats,
    evaluationIssues: evalResult.data!.issues,
  };

  completeExecution(pipelineId, result);
  emitPipelineFinished(pipelineId);
  return result;
}
