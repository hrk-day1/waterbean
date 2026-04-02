import crypto from "node:crypto";
import type { PipelineConfig } from "../types/pipeline.js";
import type { ForkRequest, ForkResult, ForkVariantResult } from "../types/fork.js";
import { runPipeline } from "./runner.js";

export async function runFork(request: ForkRequest): Promise<ForkResult> {
  const forkId = crypto.randomUUID().slice(0, 8);

  const promises = request.variants.map<Promise<ForkVariantResult>>(
    async (variant) => {
      const sheetName = `${request.baseSheetName}_${variant.label}`;

      const config: PipelineConfig = {
        spreadsheetUrl: request.spreadsheetUrl,
        targetSheetName: sheetName,
        domainScope: variant.domainScope as PipelineConfig["domainScope"],
        ownerDefault: request.ownerDefault,
        environmentDefault: request.environmentDefault,
        maxTcPerRequirement: request.maxTcPerRequirement,
        maxFallbackRounds: variant.maxFallbackRounds,
        skillId: variant.skillId,
      };

      const result = await runPipeline(config);
      return { label: variant.label, result };
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
          domainDistribution: { Auth: 0, Payment: 0, Content: 0, Membership: 0, Community: 0, Creator: 0, Admin: 0 },
          priorityDistribution: { P0: 0, P1: 0, P2: 0 },
          typeDistribution: { Functional: 0, Negative: 0, Boundary: 0, Regression: 0, Accessibility: 0, Security: 0 },
          coverageGaps: [`FORK_ERROR: ${errorMsg}`],
          mappingGaps: [],
        },
        evaluationIssues: [{ type: "schema" as const, message: errorMsg }],
      },
    };
  });

  return {
    forkId,
    completedAt: new Date().toISOString(),
    results,
  };
}
