import crypto from "node:crypto";
import { z } from "zod";
import type { EvaluationIssue, TaxonomyEvaluationResult } from "../types/pipeline.js";
import { evaluateTaxonomy } from "../pipeline/taxonomy-evaluator.js";
import { generateJson } from "../llm/gemini-client.js";
import { buildTaxonomyEvalPrompt } from "../llm/prompts/taxonomy-evaluator-prompt.js";
import type { Agent } from "./registry.js";
import type { AgentResult, SubAgentConfig } from "./types.js";
import type { eventBus } from "./event-bus.js";
import type { TaxonomyEvaluatorInput } from "./deterministic-taxonomy-evaluator-agent.js";

const LlmTaxonomyEvalSchema = z.object({
  passed: z.boolean(),
  issues: z.array(
    z.object({
      type: z.literal("taxonomy_llm"),
      message: z.string(),
      severity: z.enum(["error", "warning"]),
    }),
  ),
  suggestions: z.array(z.string()),
});

export class LlmTaxonomyEvaluatorAgent
  implements Agent<TaxonomyEvaluatorInput, TaxonomyEvaluationResult>
{
  readonly type = "taxonomy-evaluator" as const;

  async run(
    input: TaxonomyEvaluatorInput,
    bus: typeof eventBus,
    config: SubAgentConfig,
  ): Promise<AgentResult<TaxonomyEvaluationResult>> {
    const agentId = `tax-eval-llm-${crypto.randomUUID().slice(0, 6)}`;
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
      const ruleResult = evaluateTaxonomy(input.resolvedSkill);

      bus.emit(config.pipelineId, {
        agentId,
        agentType: "taxonomy-evaluator",
        status: "running",
        progress: 40,
        message: "Taxonomy LLM 검증 중...",
        timestamp: new Date().toISOString(),
      });

      const prompt = buildTaxonomyEvalPrompt(
        input.resolvedSkill,
        input.headers,
        input.sampleRows,
        ruleResult.issues,
      );

      const { data: llmResult } = await generateJson(prompt, LlmTaxonomyEvalSchema);

      const errorIssues = llmResult.issues.filter((i) => i.severity === "error");
      const llmIssues: EvaluationIssue[] = errorIssues.map((i) => ({
        type: "taxonomy_llm" as const,
        message: i.message,
        details: { severity: i.severity },
      }));

      const allIssues = [...ruleResult.issues, ...llmIssues];
      const allSuggestions = [...ruleResult.suggestions, ...llmResult.suggestions];
      const passed = ruleResult.passed && (llmResult.passed || errorIssues.length === 0);

      const result: TaxonomyEvaluationResult = {
        passed,
        issues: allIssues,
        suggestions: allSuggestions,
      };

      bus.emit(config.pipelineId, {
        agentId,
        agentType: "taxonomy-evaluator",
        status: "completed",
        progress: 100,
        message: passed
          ? "Taxonomy 검증 통과"
          : `Taxonomy 검증 이슈 ${allIssues.length}건`,
        timestamp: new Date().toISOString(),
        payload: { issueCount: allIssues.length, suggestions: allSuggestions },
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
      console.warn(`[tax-eval-llm] LLM 검증 실패, 규칙 검증만 반환: ${message}`);

      const ruleResult = evaluateTaxonomy(input.resolvedSkill);

      bus.emit(config.pipelineId, {
        agentId,
        agentType: "taxonomy-evaluator",
        status: "completed",
        progress: 100,
        message: `규칙 검증만 완료 (LLM 실패): 이슈 ${ruleResult.issues.length}건`,
        timestamp: new Date().toISOString(),
      });

      return {
        agentId,
        agentType: "taxonomy-evaluator",
        status: "completed",
        data: ruleResult,
        durationMs: Date.now() - start,
      };
    }
  }
}
