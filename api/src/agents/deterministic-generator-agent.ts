import crypto from "node:crypto";
import type { ChecklistItem, TestCase } from "../types/tc.js";
import type { ResolvedSkill } from "../skills/resolved-skill.js";
import { generateTestCasesFromTestPoints } from "../pipeline/generator.js";
import type { Agent } from "./registry.js";
import type { AgentResult, SubAgentConfig } from "./types.js";
import type { eventBus } from "./event-bus.js";

export interface GeneratorInput {
  checklist: ChecklistItem[];
  config: { ownerDefault: string; environmentDefault: string; maxTcPerRequirement?: number };
  resolvedSkill: ResolvedSkill;
}

export class DeterministicGeneratorAgent implements Agent<GeneratorInput, TestCase[]> {
  readonly type = "generator" as const;

  async run(
    input: GeneratorInput,
    bus: typeof eventBus,
    config: SubAgentConfig,
  ): Promise<AgentResult<TestCase[]>> {
    const agentId = `gen-det-${crypto.randomUUID().slice(0, 6)}`;
    const start = Date.now();

    bus.emit(config.pipelineId, {
      agentId, agentType: "generator", status: "running", progress: 0,
      message: `기능 기반 TC 생성 중 (${input.checklist.length}건)...`,
      timestamp: new Date().toISOString(),
    });

    try {
      const testCases = generateTestCasesFromTestPoints(input.checklist, input.config, input.resolvedSkill);

      bus.emit(config.pipelineId, {
        agentId, agentType: "generator", status: "completed", progress: 100,
        message: `${testCases.length}건 TC 생성 완료 (test point 기반)`,
        timestamp: new Date().toISOString(),
      });

      return {
        agentId, agentType: "generator", status: "completed",
        data: testCases, durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      bus.emit(config.pipelineId, {
        agentId, agentType: "generator", status: "failed", progress: 0,
        message, timestamp: new Date().toISOString(),
      });
      return {
        agentId, agentType: "generator", status: "failed",
        data: null, error: message, durationMs: Date.now() - start,
      };
    }
  }
}
