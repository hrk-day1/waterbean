import crypto from "node:crypto";
import type { ChecklistItem } from "../types/tc.js";
import type { ResolvedSkill } from "../skills/resolved-skill.js";
import { detectHeaderAndData, buildChecklist } from "../pipeline/plan.js";
import type { Agent } from "./registry.js";
import type { AgentResult, SubAgentConfig } from "./types.js";
import type { eventBus } from "./event-bus.js";

export interface PlanInput {
  raw: string[][];
  sourceSheetName: string;
  resolvedSkill: ResolvedSkill;
}

export class DeterministicPlanAgent implements Agent<PlanInput, ChecklistItem[]> {
  readonly type = "plan" as const;

  async run(
    input: PlanInput,
    bus: typeof eventBus,
    config: SubAgentConfig,
  ): Promise<AgentResult<ChecklistItem[]>> {
    const agentId = `plan-det-${crypto.randomUUID().slice(0, 6)}`;
    const start = Date.now();

    bus.emit(config.pipelineId, {
      agentId, agentType: "plan", status: "running", progress: 0,
      message: "헤더 감지 중...", timestamp: new Date().toISOString(),
    });

    try {
      const { headers, dataRows, headerRowIndex } = detectHeaderAndData(input.raw);

      bus.emit(config.pipelineId, {
        agentId, agentType: "plan", status: "running", progress: 50,
        message: "체크리스트 구축 중...", timestamp: new Date().toISOString(),
      });

      const checklist = buildChecklist(
        headers, dataRows, input.sourceSheetName, headerRowIndex, input.resolvedSkill,
      );

      const classifiedCount = checklist.filter((c) => c.featureTypes && c.featureTypes.length > 0).length;

      bus.emit(config.pipelineId, {
        agentId, agentType: "plan", status: "completed", progress: 100,
        message: `${checklist.length}건 체크리스트 완료 (기능유형 분류 ${classifiedCount}건)`,
        timestamp: new Date().toISOString(),
      });

      return {
        agentId, agentType: "plan", status: "completed",
        data: checklist, durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      bus.emit(config.pipelineId, {
        agentId, agentType: "plan", status: "failed", progress: 0,
        message, timestamp: new Date().toISOString(),
      });
      return {
        agentId, agentType: "plan", status: "failed",
        data: null, error: message, durationMs: Date.now() - start,
      };
    }
  }
}
