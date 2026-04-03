import crypto from "node:crypto";
import { z } from "zod";
import { TC_TYPES } from "../types/tc.js";
import type { TcType } from "../types/tc.js";
import type { SkillManifest } from "../skills/types.js";
import { env } from "../config/env.js";
import { generateJson } from "../llm/gemini-client.js";
import { buildTaxonomySkeletonPrompt, buildHybridTaxonomyPrompt } from "../llm/prompts/taxonomy-skeleton-prompt.js";
import { buildTaxonomyDomainDetailPrompt, buildKeywordRefillPrompt } from "../llm/prompts/taxonomy-domain-detail-prompt.js";
import {
  skillManifestToResolved,
  mergeTaxonomyIntoResolved,
  mergeHybridTaxonomyIntoResolved,
  type ResolvedSkill,
  type HybridTaxonomyResult,
} from "../skills/resolved-skill.js";
import { buildKeywordPatterns, tryInferDomain } from "../pipeline/plan.js";
import type { eventBus } from "./event-bus.js";

const LLM_CONCURRENCY = 4;

const TcTypeEnum = z.enum(TC_TYPES as unknown as [string, ...string[]]);

const TcTemplateSchema = z.object({
  type: TcTypeEnum,
  scenarioSuffix: z.string().max(512),
  precondition: z.string().max(2000),
  steps: z.string().max(8000),
  expectedResult: z.string().max(2000),
});

const domainIdRegex = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

const TaxonomySkeletonSchema = z.object({
  domains: z.array(
    z.object({
      id: z.string().regex(domainIdRegex),
      summary: z.string().max(200).optional(),
    }),
  ).min(3).max(12),
});

const TaxonomyDomainDetailResponseSchema = z.object({
  domain: z.object({
    id: z.string().regex(domainIdRegex),
    keywords: z.array(z.string().min(1).max(120)).min(1).max(40),
    minSets: z.record(TcTypeEnum, z.number().int().min(0).max(25)).optional(),
    templates: z.array(TcTemplateSchema).max(12).optional(),
  }),
});

const HybridTaxonomySchema = z.object({
  reclassified: z.array(
    z.object({
      rowIndex: z.number().int().min(0),
      domain: z.string(),
      suggestedKeywords: z.array(z.string().max(120)),
    }),
  ),
  newDomains: z.array(
    z.object({
      id: z.string().regex(domainIdRegex),
      summary: z.string().max(200).optional(),
      keywords: z.array(z.string().min(1).max(120)).min(1).max(40),
      minSets: z.record(TcTypeEnum, z.number().int().min(0).max(25)).optional(),
      templates: z.array(TcTemplateSchema).max(12).optional(),
    }),
  ),
});

export interface TaxonomyPhaseInput {
  headers: string[];
  sampleRows: string[][];
  sourceSheetName: string;
  baseSkill: SkillManifest;
}

const jsonGenOverrides = { maxOutputTokens: env.llmMaxTokens };

type DomainEntry = {
  id: string;
  keywords: string[];
  minSets?: Partial<Record<TcType, number>>;
  templates: { type: TcType; scenarioSuffix: string; precondition: string; steps: string; expectedResult: string }[];
};

function dedupeKeywordsByDomainOrder(domains: DomainEntry[]): { domains: DomainEntry[]; removedCount: number } {
  const seen = new Set<string>();
  let removedCount = 0;
  const deduped = domains.map((domain) => {
    const keywords: string[] = [];
    for (const raw of domain.keywords) {
      const key = raw.trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) {
        removedCount++;
        continue;
      }
      seen.add(key);
      keywords.push(raw.trim());
    }
    return { ...domain, keywords };
  });
  return { domains: deduped, removedCount };
}

async function generateDomainDetailOnce(
  input: TaxonomyPhaseInput,
  domainId: string,
  domainOrder: readonly string[],
  summary: string | undefined,
): Promise<{ domain: z.infer<typeof TaxonomyDomainDetailResponseSchema>["domain"]; usage: { totalTokens: number } }> {
  const prompt = buildTaxonomyDomainDetailPrompt(
    input.headers,
    input.sampleRows,
    input.sourceSheetName,
    input.baseSkill,
    domainId,
    domainOrder,
    summary,
  );
  const { data, usage } = await generateJson(prompt, TaxonomyDomainDetailResponseSchema, jsonGenOverrides);
  if (data.domain.id !== domainId) {
    throw new Error(`Taxonomy domain detail id mismatch: expected "${domainId}", got "${data.domain.id}"`);
  }
  return { domain: data.domain, usage };
}

async function generateDomainDetailWithRetry(
  input: TaxonomyPhaseInput,
  domainId: string,
  domainOrder: readonly string[],
  summary: string | undefined,
): Promise<{ domain: z.infer<typeof TaxonomyDomainDetailResponseSchema>["domain"]; usage: { totalTokens: number } }> {
  try {
    return await generateDomainDetailOnce(input, domainId, domainOrder, summary);
  } catch (firstErr) {
    console.warn(`[taxonomy] domain "${domainId}" detail failed, retrying once:`, firstErr);
    return await generateDomainDetailOnce(input, domainId, domainOrder, summary);
  }
}

// ---------------------------------------------------------------------------
// Phase 1: preset 키워드 기반 사전 분류
// ---------------------------------------------------------------------------

interface PreClassifyResult {
  presetResolved: ResolvedSkill;
  unclassifiedRows: string[][];
  classifiedCount: number;
}

function preClassifyWithPreset(input: TaxonomyPhaseInput): PreClassifyResult {
  const presetResolved = skillManifestToResolved(input.baseSkill);
  const patterns = buildKeywordPatterns(presetResolved);

  const unclassifiedRows: string[][] = [];
  let classifiedCount = 0;

  for (const row of input.sampleRows) {
    const text = row.join(" ");
    const domain = tryInferDomain(text, patterns, presetResolved);
    if (domain) {
      classifiedCount++;
    } else {
      unclassifiedRows.push(row);
    }
  }

  return { presetResolved, unclassifiedRows, classifiedCount };
}

// ---------------------------------------------------------------------------
// Phase 2: 미분류 행에 대한 hybrid LLM taxonomy
// ---------------------------------------------------------------------------

async function runHybridLlmPhase(
  input: TaxonomyPhaseInput,
  presetResolved: ResolvedSkill,
  unclassifiedRows: string[][],
  bus: typeof eventBus,
  pipelineId: string,
  agentId: string,
): Promise<{ resolved: ResolvedSkill; totalTokens: number }> {
  bus.emit(pipelineId, {
    agentId,
    agentType: "taxonomy",
    status: "running",
    progress: 30,
    message: `Taxonomy Phase 2: 미분류 ${unclassifiedRows.length}건 LLM 분석 중...`,
    timestamp: new Date().toISOString(),
    payload: { phase: "hybrid-llm", unclassifiedCount: unclassifiedRows.length },
  });

  const prompt = buildHybridTaxonomyPrompt(
    presetResolved,
    unclassifiedRows,
    input.headers,
    input.sourceSheetName,
  );

  const { data: hybridResult, usage } = await generateJson(prompt, HybridTaxonomySchema, jsonGenOverrides);
  let totalTokens = usage.totalTokens;

  const validReclassified = hybridResult.reclassified.filter(
    (r) => presetResolved.domainOrder.includes(r.domain),
  );

  const existingIds = new Set(presetResolved.domainOrder);
  const validNewDomains = hybridResult.newDomains.filter(
    (nd) => !existingIds.has(nd.id) && domainIdRegex.test(nd.id),
  );

  bus.emit(pipelineId, {
    agentId,
    agentType: "taxonomy",
    status: "running",
    progress: 60,
    message: `Taxonomy Phase 2: 재매핑 ${validReclassified.length}건, 새 도메인 ${validNewDomains.length}개`,
    timestamp: new Date().toISOString(),
    payload: {
      phase: "hybrid-result",
      reclassifiedCount: validReclassified.length,
      newDomainCount: validNewDomains.length,
      newDomainIds: validNewDomains.map((d) => d.id),
    },
  });

  const hybridForMerge: HybridTaxonomyResult = {
    reclassified: validReclassified,
    newDomains: validNewDomains.map((nd) => ({
      id: nd.id,
      keywords: nd.keywords,
      minSets: nd.minSets,
      templates: (nd.templates ?? []).map((t) => ({ ...t, type: t.type as TcType })),
    })),
  };

  if (validNewDomains.length > 0) {
    bus.emit(pipelineId, {
      agentId,
      agentType: "taxonomy",
      status: "running",
      progress: 65,
      message: `Taxonomy Phase 2: 새 도메인 ${validNewDomains.length}개 상세 검증 중...`,
      timestamp: new Date().toISOString(),
      payload: { phase: "new-domain-detail", count: validNewDomains.length },
    });

    const newDomainOrder = [
      ...presetResolved.domainOrder,
      ...validNewDomains.map((d) => d.id),
    ] as readonly string[];

    const detailResults = await Promise.allSettled(
      validNewDomains
        .filter((nd) => (nd.templates ?? []).length === 0)
        .map(async (nd) => {
          const { domain, usage: dUsage } = await generateDomainDetailWithRetry(
            input, nd.id, newDomainOrder, nd.summary,
          );
          totalTokens += dUsage.totalTokens;
          return domain;
        }),
    );

    for (const r of detailResults) {
      if (r.status !== "fulfilled") continue;
      const idx = hybridForMerge.newDomains.findIndex((d) => d.id === r.value.id);
      if (idx >= 0) {
        hybridForMerge.newDomains[idx] = {
          id: r.value.id,
          keywords: r.value.keywords,
          minSets: r.value.minSets,
          templates: (r.value.templates ?? []).map((t) => ({ ...t, type: t.type as TcType })),
        };
      }
    }
  }

  const resolved = mergeHybridTaxonomyIntoResolved(presetResolved, hybridForMerge);
  return { resolved, totalTokens };
}

// ---------------------------------------------------------------------------
// Full LLM taxonomy (기존 경로, 폴백용)
// ---------------------------------------------------------------------------

async function runFullTaxonomyPhase(
  input: TaxonomyPhaseInput,
  bus: typeof eventBus,
  pipelineId: string,
  agentId: string,
): Promise<{ resolved: ResolvedSkill; totalTokens: number }> {
  bus.emit(pipelineId, {
    agentId,
    agentType: "taxonomy",
    status: "running",
    progress: 10,
    message: "Taxonomy: 전체 도메인 구조 설계 중 (full LLM)...",
    timestamp: new Date().toISOString(),
    payload: { phase: "skeleton" },
  });

  const skeletonPrompt = buildTaxonomySkeletonPrompt(
    input.headers,
    input.sampleRows,
    input.sourceSheetName,
    input.baseSkill,
  );

  const { data: skeleton, usage: skUsage } = await generateJson(skeletonPrompt, TaxonomySkeletonSchema, jsonGenOverrides);

  const domainOrder = skeleton.domains.map((d) => d.id) as readonly string[];
  const summaryById = new Map(skeleton.domains.map((d) => [d.id, d.summary]));

  bus.emit(pipelineId, {
    agentId,
    agentType: "taxonomy",
    status: "running",
    progress: 25,
    message: `Taxonomy: ${domainOrder.length}개 도메인 뼈대 확정, 상세 생성 중...`,
    timestamp: new Date().toISOString(),
    payload: { phase: "skeleton", domainOrder: [...domainOrder], usage: skUsage },
  });

  let totalTokens = skUsage.totalTokens;

  const n = domainOrder.length;
  let doneCount = 0;

  const semaphore = { running: 0, queue: [] as (() => void)[] };
  function acquire(): Promise<void> {
    if (semaphore.running < LLM_CONCURRENCY) {
      semaphore.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => semaphore.queue.push(() => { semaphore.running++; resolve(); }));
  }
  function release(): void {
    semaphore.running--;
    semaphore.queue.shift()?.();
  }

  async function fetchDomain(domainId: string): Promise<DomainEntry> {
    await acquire();
    try {
      const { domain, usage } = await generateDomainDetailWithRetry(
        input, domainId, domainOrder, summaryById.get(domainId),
      );
      totalTokens += usage.totalTokens;
      doneCount++;

      bus.emit(pipelineId, {
        agentId,
        agentType: "taxonomy",
        status: "running",
        progress: 25 + Math.round((doneCount / n) * 70),
        message: `Taxonomy: 도메인 "${domainId}" 완료 (${doneCount}/${n})`,
        timestamp: new Date().toISOString(),
        payload: { phase: "domain", domainId, done: doneCount, total: n },
      });

      return {
        id: domain.id,
        keywords: domain.keywords,
        minSets: domain.minSets,
        templates: (domain.templates ?? []).map((t) => ({ ...t, type: t.type as TcType })),
      };
    } finally {
      release();
    }
  }

  bus.emit(pipelineId, {
    agentId,
    agentType: "taxonomy",
    status: "running",
    progress: 25,
    message: `Taxonomy: ${n}개 도메인 상세 병렬 생성 시작 (동시 ${Math.min(n, LLM_CONCURRENCY)}개)...`,
    timestamp: new Date().toISOString(),
    payload: { phase: "domain-parallel", total: n, concurrency: LLM_CONCURRENCY },
  });

  const results = await Promise.allSettled(
    domainOrder.map((id) => fetchDomain(id)),
  );

  const mergedDomains: DomainEntry[] = [];
  const errors: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === "fulfilled") {
      mergedDomains.push(r.value);
    } else {
      errors.push(`domain "${domainOrder[i]}": ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Taxonomy domain detail failed for ${errors.length}/${n} domains:\n${errors.join("\n")}`);
  }

  const MIN_KEYWORDS = 2;
  const KeywordRefillSchema = z.object({
    keywords: z.array(z.string().min(1).max(120)).min(1),
  });

  let { domains: dedupedDomains, removedCount } = dedupeKeywordsByDomainOrder(mergedDomains);
  if (removedCount > 0) {
    console.warn(`[taxonomy] removed ${removedCount} overlapped keywords by domain order`);
  }

  const deficitDomains = dedupedDomains.filter((d) => d.keywords.length < MIN_KEYWORDS);
  if (deficitDomains.length > 0) {
    const allUsedKeys = new Set(
      dedupedDomains.flatMap((d) => d.keywords.map((k) => k.toLowerCase().trim())),
    );

    bus.emit(pipelineId, {
      agentId,
      agentType: "taxonomy",
      status: "running",
      progress: 96,
      message: `Taxonomy: 키워드 미달 ${deficitDomains.length}개 도메인 보정 중...`,
      timestamp: new Date().toISOString(),
      payload: { phase: "keyword-refill", deficit: deficitDomains.map((d) => d.id) },
    });

    const refillResults = await Promise.allSettled(
      deficitDomains.map(async (domain) => {
        const excludedKeywords = [...allUsedKeys].filter(
          (k) => !domain.keywords.some((dk) => dk.toLowerCase().trim() === k),
        );
        const prompt = buildKeywordRefillPrompt(
          domain.id,
          domainOrder,
          domain.keywords,
          excludedKeywords,
          MIN_KEYWORDS,
          summaryById.get(domain.id),
        );
        const { data, usage } = await generateJson(prompt, KeywordRefillSchema, jsonGenOverrides);
        totalTokens += usage.totalTokens;
        return { domainId: domain.id, newKeywords: data.keywords };
      }),
    );

    const domainMap = new Map(dedupedDomains.map((d) => [d.id, d]));
    for (const r of refillResults) {
      if (r.status !== "fulfilled") continue;
      const target = domainMap.get(r.value.domainId);
      if (!target) continue;
      target.keywords = [...target.keywords, ...r.value.newKeywords];
    }

    const redeupe = dedupeKeywordsByDomainOrder([...domainMap.values()]);
    dedupedDomains = redeupe.domains;
    if (redeupe.removedCount > 0) {
      console.warn(`[taxonomy] refill re-dedupe: removed ${redeupe.removedCount} keywords`);
    }
  }

  const resolved = mergeTaxonomyIntoResolved(input.baseSkill, { domains: dedupedDomains });
  return { resolved, totalTokens };
}

// ---------------------------------------------------------------------------
// 공개 엔트리포인트: Phase 1 -> (필요시) Phase 2
// ---------------------------------------------------------------------------

export async function runTaxonomyPhase(
  input: TaxonomyPhaseInput,
  bus: typeof eventBus,
  pipelineId: string,
): Promise<ResolvedSkill> {
  const agentId = `tax-llm-${crypto.randomUUID().slice(0, 6)}`;
  const start = Date.now();

  bus.emit(pipelineId, {
    agentId,
    agentType: "taxonomy",
    status: "running",
    progress: 0,
    message: "Taxonomy Phase 1: preset 키워드 기반 사전 분류 중...",
    timestamp: new Date().toISOString(),
    payload: { phase: "preset-classify" },
  });

  const { presetResolved, unclassifiedRows, classifiedCount } = preClassifyWithPreset(input);
  const totalRows = input.sampleRows.length;

  bus.emit(pipelineId, {
    agentId,
    agentType: "taxonomy",
    status: "running",
    progress: 15,
    message: `Taxonomy Phase 1: ${classifiedCount}/${totalRows}건 분류 완료, 미분류 ${unclassifiedRows.length}건`,
    timestamp: new Date().toISOString(),
    payload: {
      phase: "preset-classify-done",
      classifiedCount,
      unclassifiedCount: unclassifiedRows.length,
      totalRows,
    },
  });

  let resolved: ResolvedSkill;
  let totalTokens = 0;

  if (unclassifiedRows.length === 0) {
    resolved = presetResolved;
    console.log(`[taxonomy] ${pipelineId} all ${totalRows} rows classified by preset, skipping LLM`);

    bus.emit(pipelineId, {
      agentId,
      agentType: "taxonomy",
      status: "completed",
      progress: 100,
      message: `Taxonomy 완료: preset 분류로 전체 커버 (LLM 호출 없음, ${resolved.domainOrder.length}개 도메인)`,
      timestamp: new Date().toISOString(),
      payload: { usage: { totalTokens: 0 }, domainOrder: [...resolved.domainOrder], skippedLlm: true },
    });
  } else {
    console.log(`[taxonomy] ${pipelineId} ${unclassifiedRows.length}/${totalRows} rows unclassified, running hybrid LLM`);

    const hybridResult = await runHybridLlmPhase(
      input, presetResolved, unclassifiedRows, bus, pipelineId, agentId,
    );
    resolved = hybridResult.resolved;
    totalTokens = hybridResult.totalTokens;

    bus.emit(pipelineId, {
      agentId,
      agentType: "taxonomy",
      status: "completed",
      progress: 100,
      message: `Taxonomy 완료: ${resolved.domainOrder.length}개 도메인 (tokens: ${totalTokens})`,
      timestamp: new Date().toISOString(),
      payload: { usage: { totalTokens }, domainOrder: [...resolved.domainOrder] },
    });
  }

  console.log(`[taxonomy] ${pipelineId} domains=${resolved.domainOrder.join(",")} ${Date.now() - start}ms tokens=${totalTokens}`);

  return resolved;
}
