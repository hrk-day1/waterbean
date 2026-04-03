import type { TcType } from "../types/tc.js";
import { DOMAINS, TC_TYPES } from "../types/tc.js";
import type { SkillManifest, TcTemplate, PolicyHint } from "./types.js";

export interface ResolvedPriorityRule {
  domain: string;
  types: TcType[];
  priority: "P0" | "P1" | "P2";
}

export interface ResolvedSeverityRule {
  domain: string;
  types: TcType[];
  severity: "S1" | "S2" | "S3";
}

/** 런타임 스킬: preset JSON 또는 Taxonomy 결과를 문자열 도메인 키로 통일 */
export interface ResolvedSkill {
  id: string;
  name: string;
  description: string;
  /** 프롬프트·추론 순서 (Taxonomy 출력 순서 또는 preset DOMAINS 순서) */
  domainOrder: readonly string[];
  /** 키워드 미매칭 시 Plan/Evaluator 기본 도메인 */
  fallbackDomain: string;
  domainKeywords: Record<string, string[]>;
  /** @deprecated Phase 4에서 policyHints로 대체됨. 하위호환용으로 유지. */
  templates: Record<string, TcTemplate[]>;
  /** manifest.commonTemplates — 도메인별로 복제하지 않고 파이프라인당 1블록으로만 사용 */
  globalTemplates: TcTemplate[];
  policyHints: PolicyHint[];
  domainMinSets: Record<string, Record<TcType, number>>;
  priorityRules: ResolvedPriorityRule[];
  severityRules: ResolvedSeverityRule[];
}

export function skillManifestToResolved(manifest: SkillManifest): ResolvedSkill {
  const domainOrder = [...DOMAINS] as string[];
  const commonTemplates = manifest.commonTemplates ?? [];
  const manifestTemplates = manifest.templates ?? ({} as Record<string, TcTemplate[]>);
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    domainOrder,
    fallbackDomain: "Admin",
    domainKeywords: Object.fromEntries(
      domainOrder.map((d) => [d, manifest.domainKeywords[d as keyof typeof manifest.domainKeywords] ?? []]),
    ),
    templates: Object.fromEntries(
      domainOrder.map((d) => {
        const domainSpecific = manifestTemplates[d as keyof typeof manifestTemplates] ?? [];
        return [d, [...domainSpecific]];
      }),
    ),
    globalTemplates: [...commonTemplates],
    policyHints: manifest.policyHints ?? [],
    domainMinSets: Object.fromEntries(
      domainOrder.map((d) => [
        d,
        manifest.domainMinSets[d as keyof typeof manifest.domainMinSets] ??
          ({} as Record<TcType, number>),
      ]),
    ),
    priorityRules: manifest.priorityRules.map((r) => ({
      domain: r.domain as string,
      types: r.types,
      priority: r.priority,
    })),
    severityRules: manifest.severityRules.map((r) => ({
      domain: r.domain as string,
      types: r.types,
      severity: r.severity,
    })),
  };
}

/** Taxonomy LLM이 반환하는 도메인 단위 페이로드 (Zod 검증 후 merge) */
export interface TaxonomyDomainPayload {
  id: string;
  keywords: string[];
  minSets?: Partial<Record<TcType, number>>;
  templates?: TcTemplate[];
}

function normalizeMinSet(partial?: Partial<Record<TcType, number>>): Record<TcType, number> {
  return Object.fromEntries(
    TC_TYPES.map((t) => [t, partial?.[t] ?? 0]),
  ) as Record<TcType, number>;
}

/** Hybrid taxonomy: preset resolved를 유지하면서 키워드 보강 + 새 도메인 추가 */
export interface HybridTaxonomyResult {
  reclassified: { rowIndex: number; domain: string; suggestedKeywords: string[] }[];
  newDomains: TaxonomyDomainPayload[];
}

export function mergeHybridTaxonomyIntoResolved(
  presetResolved: ResolvedSkill,
  hybrid: HybridTaxonomyResult,
): ResolvedSkill {
  const domainKeywords: Record<string, string[]> = {};
  for (const d of presetResolved.domainOrder) {
    domainKeywords[d] = [...(presetResolved.domainKeywords[d] ?? [])];
  }

  const templates: Record<string, TcTemplate[]> = {};
  for (const d of presetResolved.domainOrder) {
    templates[d] = [...(presetResolved.templates[d] ?? [])];
  }

  const domainMinSets: Record<string, Record<TcType, number>> = {};
  for (const d of presetResolved.domainOrder) {
    domainMinSets[d] = { ...(presetResolved.domainMinSets[d] ?? normalizeMinSet()) };
  }

  const addedKeywords = new Map<string, Set<string>>();
  for (const d of presetResolved.domainOrder) {
    addedKeywords.set(d, new Set((domainKeywords[d] ?? []).map((k) => k.toLowerCase().trim())));
  }

  for (const entry of hybrid.reclassified) {
    const seen = addedKeywords.get(entry.domain);
    if (!seen || !domainKeywords[entry.domain]) continue;
    for (const kw of entry.suggestedKeywords) {
      const key = kw.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      domainKeywords[entry.domain].push(kw.trim());
    }
  }

  const newDomainIds: string[] = [];
  for (const nd of hybrid.newDomains) {
    newDomainIds.push(nd.id);
    domainKeywords[nd.id] = nd.keywords;
    templates[nd.id] = nd.templates ?? [];
    domainMinSets[nd.id] = normalizeMinSet(nd.minSets);
  }

  const domainOrder = [...presetResolved.domainOrder, ...newDomainIds] as readonly string[];

  return {
    id: presetResolved.id,
    name: presetResolved.name,
    description: presetResolved.description,
    domainOrder,
    fallbackDomain: presetResolved.fallbackDomain,
    domainKeywords,
    templates,
    globalTemplates: [...presetResolved.globalTemplates],
    policyHints: presetResolved.policyHints,
    domainMinSets,
    priorityRules: presetResolved.priorityRules,
    severityRules: presetResolved.severityRules,
  };
}

/** 베이스 스킬의 우선순위·심각도 규칙을 유지하고, 도메인·키워드·템플릿·최소세트는 Taxonomy로 덮어씀 */
export function mergeTaxonomyIntoResolved(
  base: SkillManifest,
  taxonomy: { domains: TaxonomyDomainPayload[] },
): ResolvedSkill {
  const baseResolved = skillManifestToResolved(base);
  if (taxonomy.domains.length === 0) {
    throw new Error("Taxonomy returned no domains");
  }

  const domainOrder = taxonomy.domains.map((d) => d.id) as readonly string[];
  const fallbackDomain = domainOrder[0]!;

  const domainKeywords: Record<string, string[]> = {};
  const templates: Record<string, TcTemplate[]> = {};
  const domainMinSets: Record<string, Record<TcType, number>> = {};

  for (const d of taxonomy.domains) {
    domainKeywords[d.id] = d.keywords;
    templates[d.id] = d.templates ?? [];
    domainMinSets[d.id] = normalizeMinSet(d.minSets);
  }

  return {
    id: base.id,
    name: base.name,
    description: base.description,
    domainOrder,
    fallbackDomain,
    domainKeywords,
    templates,
    globalTemplates: [...baseResolved.globalTemplates],
    policyHints: baseResolved.policyHints,
    domainMinSets,
    priorityRules: baseResolved.priorityRules,
    severityRules: baseResolved.severityRules,
  };
}
