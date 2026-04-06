import crypto from "node:crypto";
import type { ChecklistItem, TestCase } from "../types/tc.js";
import type { EvaluateOptions, EvaluationResult } from "../types/pipeline.js";
import type { ResolvedSkill } from "../skills/resolved-skill.js";
import { evaluate } from "../pipeline/evaluator.js";
import type { Agent } from "./registry.js";
import type { AgentResult, SubAgentConfig } from "./types.js";
import type { eventBus } from "./event-bus.js";

export interface EvaluatorInput {
  checklist: ChecklistItem[];
  testCases: TestCase[];
  resolvedSkill: ResolvedSkill;
  config: { ownerDefault: string; environmentDefault: string };
  /** 미전달 시 evaluate 내부 기본값(warn) */
  evaluateOptions?: EvaluateOptions;
}

export class DeterministicEvaluatorAgent implements Agent<EvaluatorInput, EvaluationResult> {
  readonly type = "evaluator" as const;

  async run(
    input: EvaluatorInput,
    bus: typeof eventBus,
    config: SubAgentConfig,
  ): Promise<AgentResult<EvaluationResult>> {
    const agentId = `eval-det-${crypto.randomUUID().slice(0, 6)}`;
    const start = Date.now();

    bus.emit(config.pipelineId, {
      agentId, agentType: "evaluator", status: "running", progress: 0,
      message: "규칙 기반 검증 중...", timestamp: new Date().toISOString(),
    });

    try {
      const result = evaluate(
        input.checklist,
        input.testCases,
        input.resolvedSkill,
        input.evaluateOptions,
      );

      bus.emit(config.pipelineId, {
        agentId, agentType: "evaluator", status: "completed", progress: 100,
        message: `검증 완료: ${result.passed ? "통과" : `이슈 ${result.issues.length}건`}`,
        timestamp: new Date().toISOString(),
      });

      return {
        agentId, agentType: "evaluator", status: "completed",
        data: result, durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      bus.emit(config.pipelineId, {
        agentId, agentType: "evaluator", status: "failed", progress: 0,
        message, timestamp: new Date().toISOString(),
      });
      return {
        agentId, agentType: "evaluator", status: "failed",
        data: null, error: message, durationMs: Date.now() - start,
      };
    }
  }
}
