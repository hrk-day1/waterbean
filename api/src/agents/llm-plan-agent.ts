import crypto from "node:crypto";
import { z } from "zod";
import type { ChecklistItem } from "../types/tc.js";
import { generateJson, type LlmUsage } from "../llm/gemini-client.js";
import {
  buildPlanPromptChunkBody,
  buildPlanPromptPrefix,
  buildPlanPromptSuffix,
} from "../llm/prompts/plan-prompt.js";
import { expandKeys, PLAN_KEY_MAP } from "../llm/key-mapping.js";
import {
  detectHeaderAndData,
  buildChecklist,
  inferFeatureTypes,
  isValidFeatureType,
  projectRowToTcSourceFields,
  resolveSourceSheetColumns,
} from "../pipeline/plan.js";
import { enrichChecklistWithSpecRisk } from "../pipeline/spec-risk.js";
import { env } from "../config/env.js";
import type { Agent } from "./registry.js";
import type { AgentResult, SubAgentConfig } from "./types.js";
import type { eventBus } from "./event-bus.js";
import type { PlanInput } from "./deterministic-plan-agent.js";

function normalizeCompactChecklistItem(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };
  const m = PLAN_KEY_MAP;

  const ds = o[m.description];
  if (Array.isArray(ds)) {
    o[m.description] = ds
      .map((x) => String(x).trim())
      .filter((s) => s.length > 0)
      .join("\n");
  }

  const ft = o[m.featureTypes];
  if (typeof ft === "string") {
    o[m.featureTypes] = [ft];
  } else if (ft != null && !Array.isArray(ft)) {
    o[m.featureTypes] = [String(ft)];
  }

  return o;
}

function compactChecklistSchema(allowed: readonly string[]) {
  if (allowed.length === 0) {
    throw new Error("resolvedSkill.domainOrder must not be empty");
  }
  const domainZod =
    allowed.length === 1
      ? z.literal(allowed[0])
      : z.enum(allowed as [string, ...string[]]);
  const m = PLAN_KEY_MAP;
  const itemSchema = z.object({
    [m.id]: z.string(),
    [m.requirementId]: z.string(),
    [m.feature]: z.string(),
    [m.domain]: domainZod,
    [m.description]: z.string(),
    [m.sourceRow]: z.number(),
    [m.sourceSheet]: z.string(),
    [m.covered]: z.boolean(),
    [m.featureTypes]: z.array(z.string()).optional(),
    [m.precondition]: z.string().optional(),
    [m.categoryPath]: z.string().optional(),
  });
  type CompactPlanRow = z.infer<typeof itemSchema>;
  return z.preprocess(
    (val) => (Array.isArray(val) ? val.map(normalizeCompactChecklistItem) : val),
    z.array(itemSchema),
  ) as z.ZodType<CompactPlanRow[]>;
}

interface RawChecklistItem {
  id: string;
  requirementId: string;
  feature: string;
  domain: string;
  description: string;
  sourceRow: number;
  sourceSheet: string;
  covered: boolean;
  featureTypes?: string[];
  precondition?: string;
  categoryPath?: string;
}

function validateAndFillFeatureTypes(raw: RawChecklistItem[]): ChecklistItem[] {
  return raw.map((item) => {
    const validated = (item.featureTypes ?? []).filter(isValidFeatureType);
    const featureTypes = validated.length > 0
      ? validated
      : inferFeatureTypes(`${item.feature} ${item.description}`);
    return { ...item, featureTypes };
  });
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function reassignIds(items: RawChecklistItem[]): RawChecklistItem[] {
  return items.map((item, i) => ({
    ...item,
    id: `CL-${String(i + 1).padStart(4, "0")}`,
  }));
}

function sumUsage(usages: LlmUsage[]): LlmUsage {
  return usages.reduce(
    (acc, u) => ({
      promptTokens: acc.promptTokens + u.promptTokens,
      completionTokens: acc.completionTokens + u.completionTokens,
      totalTokens: acc.totalTokens + u.totalTokens,
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  );
}

/**
 * 동시에 최대 `concurrency`개의 비동기 작업만 실행하고, 결과는 입력 순서대로 반환.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  const results = new Array<R>(n);
  if (n === 0) return results;

  let nextIndex = 0;
  const limit = Math.max(1, Math.min(concurrency, n));

  const runWorker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= n) return;
      results[i] = await worker(items[i]!, i);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

export class LlmPlanAgent implements Agent<PlanInput, ChecklistItem[]> {
  readonly type = "plan" as const;

  async run(
    input: PlanInput,
    bus: typeof eventBus,
    config: SubAgentConfig,
  ): Promise<AgentResult<ChecklistItem[]>> {
    const agentId = `plan-llm-${crypto.randomUUID().slice(0, 6)}`;
    const start = Date.now();

    bus.emit(config.pipelineId, {
      agentId, agentType: "plan", status: "running", progress: 0,
      message: "LLM으로 시트 분석 중...", timestamp: new Date().toISOString(),
    });

    try {
      const { headers, dataRows, headerRowIndex } = detectHeaderAndData(input.raw);
      const sourceCols = resolveSourceSheetColumns(headers);
      const chunkSize = env.llmPlanChunkSize;
      const chunks = chunkArray(dataRows, chunkSize);
      const schema = compactChecklistSchema(input.resolvedSkill.domainOrder);
      const concurrency = env.llmPlanConcurrency;

      const promptPrefix = buildPlanPromptPrefix(input.resolvedSkill);
      const promptSuffix = buildPlanPromptSuffix(input.resolvedSkill, input.sourceSheetName);

      bus.emit(config.pipelineId, {
        agentId, agentType: "plan", status: "running", progress: 10,
        message: `${dataRows.length}행 → ${chunks.length}청크(행당 ${chunkSize}), 동시 ${concurrency}건`,
        timestamp: new Date().toISOString(),
      });

      let finishedChunks = 0;
      const chunkResults = await mapWithConcurrency(
        chunks,
        concurrency,
        async (chunk, ci) => {
          const baseSourceRow = headerRowIndex + 2 + ci * chunkSize;
          const projectedRows = chunk.map((row, i) => ({
            sourceRow: baseSourceRow + i,
            fields: projectRowToTcSourceFields(row, sourceCols),
          }));
          const prompt =
            promptPrefix
            + buildPlanPromptChunkBody(input.sourceSheetName, projectedRows)
            + promptSuffix;

          const { data: compactItems, usage } = await generateJson(prompt, schema);
          const chunkItems = expandKeys<RawChecklistItem>(compactItems, PLAN_KEY_MAP);

          finishedChunks++;
          const progress = 10 + Math.round((finishedChunks / chunks.length) * 80);
          bus.emit(config.pipelineId, {
            agentId, agentType: "plan", status: "running", progress,
            message: `Plan 배치 완료 ${finishedChunks}/${chunks.length} (이번 ${chunkItems.length}건, tokens: ${usage.totalTokens})`,
            timestamp: new Date().toISOString(),
          });

          return { chunkItems, usage };
        },
      );

      const allRaw: RawChecklistItem[] = [];
      const usages: LlmUsage[] = [];
      for (const r of chunkResults) {
        allRaw.push(...r.chunkItems);
        usages.push(r.usage);
      }

      const reindexed = reassignIds(allRaw);
      const checklist = enrichChecklistWithSpecRisk(validateAndFillFeatureTypes(reindexed));
      const classifiedCount = checklist.filter((c) => c.featureTypes && c.featureTypes.length > 0).length;
      const totalUsage = sumUsage(usages);

      bus.emit(config.pipelineId, {
        agentId, agentType: "plan", status: "completed", progress: 100,
        message: `LLM 체크리스트 ${checklist.length}건 완료 (${chunks.length}청크, 기능유형 분류 ${classifiedCount}건, tokens: ${totalUsage.totalTokens})`,
        timestamp: new Date().toISOString(),
        payload: { usage: totalUsage },
      });

      return {
        agentId, agentType: "plan", status: "completed",
        data: checklist, durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn(`[llm-plan] failed, falling back to deterministic: ${message}`);

      bus.emit(config.pipelineId, {
        agentId, agentType: "plan", status: "running", progress: 70,
        message: "LLM 실패, 규칙 기반 폴백 실행 중...", timestamp: new Date().toISOString(),
      });

      try {
        const { headers, dataRows, headerRowIndex } = detectHeaderAndData(input.raw);
        const checklist = buildChecklist(
          headers, dataRows, input.sourceSheetName, headerRowIndex, input.resolvedSkill,
        );

        bus.emit(config.pipelineId, {
          agentId, agentType: "plan", status: "completed", progress: 100,
          message: `폴백 체크리스트 ${checklist.length}건 완료`,
          timestamp: new Date().toISOString(),
        });

        return {
          agentId, agentType: "plan", status: "completed",
          data: checklist, durationMs: Date.now() - start,
        };
      } catch (fallbackErr) {
        const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : "Unknown error";
        bus.emit(config.pipelineId, {
          agentId, agentType: "plan", status: "failed", progress: 0,
          message: fbMsg, timestamp: new Date().toISOString(),
        });
        return {
          agentId, agentType: "plan", status: "failed",
          data: null, error: fbMsg, durationMs: Date.now() - start,
        };
      }
    }
  }
}
