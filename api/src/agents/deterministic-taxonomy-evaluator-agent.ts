import crypto from "node:crypto";
import type { TaxonomyEvaluationResult } from "../types/pipeline.js";
import type { ResolvedSkill } from "../skills/resolved-skill.js";
import { evaluateTaxonomy } from "../pipeline/taxonomy-evaluator.js";
import type { Agent } from "./registry.js";
import type { AgentResult, SubAgentConfig } from "./types.js";
import type { eventBus } from "./event-bus.js";

export interface TaxonomyEvaluatorInput {
  resolvedSkill: ResolvedSkill;
  headers: string[];
  sampleRows: string[][];
}

export class DeterministicTaxonomyEvaluatorAgent
  implements Agent<TaxonomyEvaluatorInput, TaxonomyEvaluationResult>
{
  readonly type = "taxonomy-evaluator" as const;

  async run(
    input: TaxonomyEvaluatorInput,
    bus: typeof eventBus,
    config: SubAgentConfig,
  ): Promise<AgentResult<TaxonomyEvaluationResult>> {
    const agentId = `tax-eval-det-${crypto.randomUUID().slice(0, 6)}`;
    const start = Date.now();

    bus.emit(config.pipelineId, {
      agentId,
      agentType: "taxonomy-evaluator",
      status: "running",
      progress: 0,
      message: "Taxonomy 규칙 기반 검증 중...",
      timestamp: new Date().toISOString(),
    });

    try {
      const result = evaluateTaxonomy(input.resolvedSkill);

      bus.emit(config.pipelineId, {
        agentId,
        agentType: "taxonomy-evaluator",
        status: "completed",
        progress: 100,
        message: result.passed
          ? "Taxonomy 검증 통과"
          : `Taxonomy 검증 이슈 ${result.issues.length}건`,
        timestamp: new Date().toISOString(),
        payload: { issueCount: result.issues.length, suggestions: result.suggestions },
      });

      return {
        agentId,
        agentType: "taxonomy-evaluator",
        status: "completed",
        data: result,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      bus.emit(config.pipelineId, {
        agentId,
        agentType: "taxonomy-evaluator",
        status: "failed",
        progress: 0,
        message,
        timestamp: new Date().toISOString(),
      });
      return {
        agentId,
        agentType: "taxonomy-evaluator",
        status: "failed",
        data: null,
        error: message,
        durationMs: Date.now() - start,
      };
    }
  }
}
