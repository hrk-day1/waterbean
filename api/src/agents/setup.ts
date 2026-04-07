import { registerAgent } from "./registry.js";
import { LlmPlanAgent } from "./llm-plan-agent.js";
import { LlmGeneratorAgent } from "./llm-generator-agent.js";
import { LlmMergeAgent } from "./llm-merge-agent.js";
import { LlmEvaluatorAgent } from "./llm-evaluator-agent.js";
import { LlmTaxonomyEvaluatorAgent } from "./llm-taxonomy-evaluator-agent.js";

export function setupAgents(): void {
  registerAgent("plan", "llm", LlmPlanAgent as never);
  registerAgent("generator", "llm", LlmGeneratorAgent as never);
  registerAgent("merge", "llm", LlmMergeAgent as never);
  registerAgent("evaluator", "llm", LlmEvaluatorAgent as never);
  registerAgent("taxonomy-evaluator", "llm", LlmTaxonomyEvaluatorAgent as never);

  console.log("[agents] 5 LLM agents registered");
}
