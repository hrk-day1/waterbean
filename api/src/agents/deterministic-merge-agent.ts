import crypto from "node:crypto";
import type { TestCase } from "../types/tc.js";
import type { Agent } from "./registry.js";
import type { AgentResult, SubAgentConfig } from "./types.js";
import type { eventBus } from "./event-bus.js";
import type { MergeInput } from "./llm-merge-agent.js";

export class DeterministicMergeAgent implements Agent<MergeInput, TestCase[]> {
  readonly type = "merge" as const;

  async run(
    input: MergeInput,
    bus: typeof eventBus,
    config: SubAgentConfig,
  ): Promise<AgentResult<TestCase[]>> {
    const agentId = `merge-det-${crypto.randomUUID().slice(0, 6)}`;
    const start = Date.now();

    bus.emit(config.pipelineId, {
      agentId, agentType: "merge", status: "completed", progress: 100,
      message: `결정적 모드: 병합 스킵 (${input.testCases.length}건 유지)`,
      timestamp: new Date().toISOString(),
    });

    return {
      agentId, agentType: "merge", status: "completed",
      data: input.testCases, durationMs: Date.now() - start,
    };
  }
}
