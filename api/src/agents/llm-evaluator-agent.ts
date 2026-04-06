import crypto from "node:crypto";
import { z } from "zod";
import type { ChecklistItem, TestCase } from "../types/tc.js";
import { TC_TYPES } from "../types/tc.js";
import type { EvaluationResult } from "../types/pipeline.js";
import { evaluate } from "../pipeline/evaluator.js";
import { generateJson } from "../llm/gemini-client.js";
import { buildRepairPrompt } from "../llm/prompts/evaluator-prompt.js";
import { expandKeys, TC_KEY_MAP } from "../llm/key-mapping.js";
import { enrichTestCasesFromChecklist } from "../pipeline/tc-enrich.js";
import type { Agent } from "./registry.js";
import type { AgentResult, SubAgentConfig } from "./types.js";
import type { eventBus } from "./event-bus.js";
import type { EvaluatorInput } from "./deterministic-evaluator-agent.js";

const MAX_REPAIR_ROUNDS = 2;
const REPAIR_MAX_NEW_PER_ROUND = process.env.LLM_REPAIR_MAX_NEW_PER_ROUND
  ? parseInt(process.env.LLM_REPAIR_MAX_NEW_PER_ROUND)
  : 20;
const REPAIR_MAX_PER_REQUIREMENT = process.env.LLM_REPAIR_MAX_PER_REQUIREMENT
  ? parseInt(process.env.LLM_REPAIR_MAX_PER_REQUIREMENT)
  : 2;

function splitRequirementIds(raw: string): string[] {
  return raw.split(",").map((id) => id.trim()).filter(Boolean);
}

function guardRepairCandidates(
  existingTcs: TestCase[],
  candidates: TestCase[],
): TestCase[] {
  const reqCounts = new Map<string, number>();
  for (const tc of existingTcs) {
    for (const reqId of splitRequirementIds(tc.Requirement_ID)) {
      reqCounts.set(reqId, (reqCounts.get(reqId) ?? 0) + 1);
    }
  }

  const accepted: TestCase[] = [];
  for (const tc of candidates) {
    if (accepted.length >= REPAIR_MAX_NEW_PER_ROUND) break;
    const reqIds = splitRequirementIds(tc.Requirement_ID);
    const overCap = reqIds.some((reqId) => (reqCounts.get(reqId) ?? 0) >= REPAIR_MAX_PER_REQUIREMENT);
    if (overCap) continue;
    for (const reqId of reqIds) {
      reqCounts.set(reqId, (reqCounts.get(reqId) ?? 0) + 1);
    }
    accepted.push(tc);
  }
  return accepted;
}

const rm = TC_KEY_MAP;
const CompactRepairResponseSchema = z.object({
  ntc: z.array(
    z.object({
      [rm.TC_ID]: z.string(),
      [rm.Feature]: z.string().optional(),
      [rm.Requirement_ID]: z.string(),
      [rm.Scenario]: z.string(),
      [rm.Precondition]: z.string(),
      [rm.Test_Steps]: z.string(),
      [rm.Test_Data]: z.string(),
      [rm.Expected_Result]: z.string(),
      [rm.Priority]: z.enum(["P0", "P1", "P2"]),
      [rm.Severity]: z.enum(["S1", "S2", "S3"]),
      [rm.Type]: z.enum(TC_TYPES as unknown as [string, ...string[]]),
      [rm.Environment]: z.string().optional(),
      [rm.Owner]: z.string().optional(),
      [rm.Status]: z.string().optional(),
      [rm.Automation_Candidate]: z.string().optional(),
      [rm.Traceability]: z.string(),
      [rm.Notes]: z.string().optional(),
    }),
  ),
  rn: z.string(),
});

export class LlmEvaluatorAgent implements Agent<EvaluatorInput, EvaluationResult> {
  readonly type = "evaluator" as const;

  async run(
    input: EvaluatorInput,
    bus: typeof eventBus,
    config: SubAgentConfig,
  ): Promise<AgentResult<EvaluationResult>> {
    const agentId = `eval-llm-${crypto.randomUUID().slice(0, 6)}`;
    const start = Date.now();
    let allTcs = [...input.testCases];

    bus.emit(config.pipelineId, {
      agentId, agentType: "evaluator", status: "running", progress: 0,
      message: "규칙 게이트 검증 중...", timestamp: new Date().toISOString(),
    });

    try {
      let evalResult = evaluate(input.checklist, allTcs, input.resolvedSkill, input.evaluateOptions);
      let round = 0;

      while (
        !evalResult.passed &&
        evalResult.uncoveredItems.length > 0 &&
        round < MAX_REPAIR_ROUNDS
      ) {
        round++;
        const progress = Math.round((round / (MAX_REPAIR_ROUNDS + 1)) * 80);

        bus.emit(config.pipelineId, {
          agentId, agentType: "evaluator", status: "running", progress,
          message: `LLM 수정 라운드 ${round}/${MAX_REPAIR_ROUNDS}...`,
          timestamp: new Date().toISOString(),
        });

        const nextTcId = allTcs.length + 1;
        const prompt = buildRepairPrompt(
          evalResult.issues,
          evalResult.uncoveredItems,
          allTcs,
          input.resolvedSkill,
          input.config,
          nextTcId,
        );

        const { data: compactResult } = await generateJson(prompt, CompactRepairResponseSchema);
        const expandedRepair = expandKeys<TestCase>(compactResult.ntc, TC_KEY_MAP);
        const newTcs = enrichTestCasesFromChecklist(expandedRepair, input.checklist, input.config);

        if (newTcs.length > 0) {
          const guarded = guardRepairCandidates(allTcs, newTcs);
          allTcs = [...allTcs, ...guarded];
          console.log(
            `[llm-eval] repair round ${round}: +${guarded.length}/${newTcs.length} TCs, note: ${compactResult.rn}`,
          );
        }

        evalResult = evaluate(input.checklist, allTcs, input.resolvedSkill, input.evaluateOptions);
      }

      bus.emit(config.pipelineId, {
        agentId, agentType: "evaluator", status: "completed", progress: 100,
        message: `검증 완료: ${evalResult.passed ? "통과" : `이슈 ${evalResult.issues.length}건`} (repair ${round}회)`,
        timestamp: new Date().toISOString(),
        payload: { repairRounds: round, finalTcCount: allTcs.length },
      });

      (evalResult as EvaluationResult & { repairedTestCases?: TestCase[] }).repairedTestCases = allTcs;

      return {
        agentId, agentType: "evaluator", status: "completed",
        data: evalResult, durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn(`[llm-eval] LLM repair failed, returning rule-only result: ${message}`);

      const evalResult = evaluate(input.checklist, allTcs, input.resolvedSkill, input.evaluateOptions);

      bus.emit(config.pipelineId, {
        agentId, agentType: "evaluator", status: "completed", progress: 100,
        message: `규칙 검증만 완료 (LLM repair 실패): 이슈 ${evalResult.issues.length}건`,
        timestamp: new Date().toISOString(),
      });

      return {
        agentId, agentType: "evaluator", status: "completed",
        data: evalResult, durationMs: Date.now() - start,
      };
    }
  }
}
