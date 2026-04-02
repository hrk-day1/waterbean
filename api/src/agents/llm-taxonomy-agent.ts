import crypto from "node:crypto";
import { z } from "zod";
import { TC_TYPES } from "../types/tc.js";
import type { TcType } from "../types/tc.js";
import type { SkillManifest } from "../skills/types.js";
import { env } from "../config/env.js";
import { generateJson } from "../llm/gemini-client.js";
import { buildTaxonomySkeletonPrompt } from "../llm/prompts/taxonomy-skeleton-prompt.js";
import { buildTaxonomyDomainDetailPrompt, buildKeywordRefillPrompt } from "../llm/prompts/taxonomy-domain-detail-prompt.js";
import { mergeTaxonomyIntoResolved, type ResolvedSkill } from "../skills/resolved-skill.js";
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
    templates: z.array(TcTemplateSchema).min(1).max(12),
  }),
});

export interface TaxonomyPhaseInput {
  headers: string[];
  sampleRows: string[][];
  sourceSheetName: string;
  baseSkill: SkillManifest;
}

const jsonGenOverrides = { maxOutputTokens: env.llmMaxTokens };

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
    message: "Taxonomy: 도메인 구조 설계 중...",
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
        templates: domain.templates.map((t) => ({ ...t, type: t.type as TcType })),
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

  bus.emit(pipelineId, {
    agentId,
    agentType: "taxonomy",
    status: "completed",
    progress: 100,
    message: `Taxonomy 완료: ${resolved.domainOrder.length}개 도메인 (tokens: ${totalTokens})`,
    timestamp: new Date().toISOString(),
    payload: { usage: { totalTokens }, domainOrder: [...resolved.domainOrder] },
  });

  console.log(`[taxonomy] ${pipelineId} domains=${resolved.domainOrder.join(",")} ${Date.now() - start}ms tokens=${totalTokens}`);

  return resolved;
}
