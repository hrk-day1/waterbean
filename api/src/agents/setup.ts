import { registerAgent } from "./registry.js";
import { DeterministicPlanAgent } from "./deterministic-plan-agent.js";
import { LlmPlanAgent } from "./llm-plan-agent.js";
import { DeterministicGeneratorAgent } from "./deterministic-generator-agent.js";
import { LlmGeneratorAgent } from "./llm-generator-agent.js";
import { DeterministicEvaluatorAgent } from "./deterministic-evaluator-agent.js";
import { LlmEvaluatorAgent } from "./llm-evaluator-agent.js";
import { DeterministicTaxonomyEvaluatorAgent } from "./deterministic-taxonomy-evaluator-agent.js";
import { LlmTaxonomyEvaluatorAgent } from "./llm-taxonomy-evaluator-agent.js";

export function setupAgents(): void {
  registerAgent("plan", "deterministic", DeterministicPlanAgent as never);
  registerAgent("plan", "llm", LlmPlanAgent as never);
  registerAgent("generator", "deterministic", DeterministicGeneratorAgent as never);
  registerAgent("generator", "llm", LlmGeneratorAgent as never);
  registerAgent("evaluator", "deterministic", DeterministicEvaluatorAgent as never);
  registerAgent("evaluator", "llm", LlmEvaluatorAgent as never);
  registerAgent("taxonomy-evaluator", "deterministic", DeterministicTaxonomyEvaluatorAgent as never);
  registerAgent("taxonomy-evaluator", "llm", LlmTaxonomyEvaluatorAgent as never);

  console.log("[agents] 8 agents registered (4 deterministic + 4 llm)");
}
