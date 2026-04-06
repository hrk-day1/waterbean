import crypto from "node:crypto";
import type { PipelineConfig } from "../types/pipeline.js";
import type { ForkRequest, ForkResult, ForkVariantResult } from "../types/fork.js";
import { runPipeline } from "./runner.js";
import { eventBus } from "../agents/event-bus.js";
import { createExecution, completeExecution } from "../agents/store.js";

function emitForkProgress(
  forkId: string,
  agentId: string,
  message: string,
  progress: number,
  status: "running" | "completed" | "failed",
): void {
  eventBus.emit(forkId, {
    agentId,
    agentType: "generator",
    status,
    progress,
    message,
    timestamp: new Date().toISOString(),
  });
}

function emitForkFinished(forkId: string): void {
  eventBus.emit(forkId, {
    agentId: "fork-root",
    agentType: "evaluator",
    status: "completed",
    progress: 100,
    message: "Fork 비교 실행 종료",
    timestamp: new Date().toISOString(),
    payload: { pipelineFinished: true },
  });
}

export async function runFork(
  request: ForkRequest,
  options?: { forkId?: string; emitProgress?: boolean },
): Promise<ForkResult> {
  const forkId = options?.forkId ?? crypto.randomUUID().slice(0, 8);
  const track = options?.emitProgress === true;

  if (track) {
    createExecution(forkId, request as unknown as Record<string, unknown>);
    emitForkProgress(forkId, "fork-root", `Fork 시작 (${request.variants.length}개 변형)`, 5, "running");
  }

  const promises = request.variants.map<Promise<ForkVariantResult>>(
    async (variant) => {
      const sheetName = `${request.baseSheetName}_${variant.label}`;

      if (track) {
        emitForkProgress(
          forkId,
          `fork-${variant.label}`,
          `변형 "${variant.label}" 파이프라인 실행 중…`,
          15,
          "running",
        );
      }

      const config: PipelineConfig = {
        spreadsheetUrl: request.spreadsheetUrl,
        targetSheetName: sheetName,
        domainMode: variant.domainMode ?? "preset",
        domainScope: variant.domainScope as PipelineConfig["domainScope"],
        ownerDefault: request.ownerDefault,
        environmentDefault: request.environmentDefault,
        maxTcPerRequirement: request.maxTcPerRequirement,
        highRiskMaxTcPerRequirement: request.highRiskMaxTcPerRequirement,
        maxFallbackRounds: variant.maxFallbackRounds,
        skillId: variant.skillId,
      };

      try {
        const result = await runPipeline(config);
        if (track) {
          emitForkProgress(
            forkId,
            `fork-${variant.label}`,
            `변형 "${variant.label}" 완료`,
            80,
            "completed",
          );
        }
        return { label: variant.label, result };
      } catch (reason) {
        const errorMsg = reason instanceof Error ? reason.message : "Unknown error";
        if (track) {
          emitForkProgress(forkId, `fork-${variant.label}`, `변형 "${variant.label}" 실패: ${errorMsg}`, 0, "failed");
        }
        throw reason;
      }
    },
  );

  const settled = await Promise.allSettled(promises);

  const results: ForkVariantResult[] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;

    const label = request.variants[i].label;
    const errorMsg = s.reason instanceof Error ? s.reason.message : "Unknown error";
    console.error(`[fork] variant '${label}' failed:`, s.reason);

    return {
      label,
      result: {
        success: false,
        sheetName: `${request.baseSheetName}_${label}`,
        rounds: 0,
        stats: {
          totalTCs: 0,
          domainDistribution: {},
          priorityDistribution: { P0: 0, P1: 0, P2: 0 },
          typeDistribution: { Functional: 0, Negative: 0, Boundary: 0, Regression: 0, Accessibility: 0, Security: 0 },
          coverageGaps: [`FORK_ERROR: ${errorMsg}`],
          mappingGaps: [],
        },
        evaluationIssues: [{ type: "schema" as const, message: errorMsg }],
      },
    };
  });

  const forkResult: ForkResult = {
    forkId,
    completedAt: new Date().toISOString(),
    results,
  };

  if (track) {
    completeExecution(forkId, forkResult);
    emitForkFinished(forkId);
  }

  return forkResult;
}
