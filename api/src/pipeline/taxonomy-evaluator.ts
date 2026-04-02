import type { EvaluationIssue, TaxonomyEvaluationResult } from "../types/pipeline.js";
import type { ResolvedSkill } from "../skills/resolved-skill.js";

const MIN_DOMAINS = 3;
const MAX_DOMAINS = 12;
const MIN_KEYWORDS_PER_DOMAIN = 3;
const MAX_MINSETS_TOTAL_PER_DOMAIN = 50;
const BALANCE_RATIO_THRESHOLD = 5;

export function evaluateTaxonomy(resolved: ResolvedSkill): TaxonomyEvaluationResult {
  const issues: EvaluationIssue[] = [];
  const suggestions: string[] = [];

  validateDomainCount(resolved, issues, suggestions);
  validateKeywordQuality(resolved, issues, suggestions);
  validateKeywordOverlap(resolved, issues, suggestions);
  validateTemplateCompleteness(resolved, issues, suggestions);
  validateMinSets(resolved, issues, suggestions);
  validateBalance(resolved, issues, suggestions);

  return {
    passed: issues.length === 0,
    issues,
    suggestions,
  };
}

function validateDomainCount(
  resolved: ResolvedSkill,
  issues: EvaluationIssue[],
  suggestions: string[],
): void {
  const count = resolved.domainOrder.length;
  if (count < MIN_DOMAINS) {
    issues.push({
      type: "taxonomy_domain_count",
      message: `도메인이 ${count}개로 최소 ${MIN_DOMAINS}개 미달`,
      details: { current: count, min: MIN_DOMAINS },
    });
    suggestions.push("기능 목록을 더 세분화하여 도메인을 추가하세요.");
  }
  if (count > MAX_DOMAINS) {
    issues.push({
      type: "taxonomy_domain_count",
      message: `도메인이 ${count}개로 최대 ${MAX_DOMAINS}개 초과`,
      details: { current: count, max: MAX_DOMAINS },
    });
    suggestions.push("유사한 도메인을 병합하여 개수를 줄이세요.");
  }
}

function validateKeywordQuality(
  resolved: ResolvedSkill,
  issues: EvaluationIssue[],
  suggestions: string[],
): void {
  for (const domain of resolved.domainOrder) {
    const keywords = resolved.domainKeywords[domain] ?? [];

    if (keywords.length < MIN_KEYWORDS_PER_DOMAIN) {
      issues.push({
        type: "taxonomy_keyword_quality",
        message: `${domain}: 키워드가 ${keywords.length}개로 최소 ${MIN_KEYWORDS_PER_DOMAIN}개 미달`,
        details: { domain, current: keywords.length, min: MIN_KEYWORDS_PER_DOMAIN },
      });
    }

    const empties = keywords.filter((k) => k.trim().length === 0);
    if (empties.length > 0) {
      issues.push({
        type: "taxonomy_keyword_quality",
        message: `${domain}: 빈 키워드 ${empties.length}개 발견`,
        details: { domain, emptyCount: empties.length },
      });
    }

    const lower = keywords.map((k) => k.toLowerCase().trim());
    const unique = new Set(lower);
    if (unique.size < lower.length) {
      const dupeCount = lower.length - unique.size;
      issues.push({
        type: "taxonomy_keyword_quality",
        message: `${domain}: 도메인 내 중복 키워드 ${dupeCount}개 발견`,
        details: { domain, duplicateCount: dupeCount },
      });
      suggestions.push(`${domain} 도메인의 중복 키워드를 제거하세요.`);
    }
  }
}

function validateKeywordOverlap(
  resolved: ResolvedSkill,
  issues: EvaluationIssue[],
  suggestions: string[],
): void {
  const domains = [...resolved.domainOrder];
  const keywordMap = new Map<string, string[]>();

  for (const domain of domains) {
    for (const kw of resolved.domainKeywords[domain] ?? []) {
      const key = kw.toLowerCase().trim();
      if (!key) continue;
      const list = keywordMap.get(key) ?? [];
      list.push(domain);
      keywordMap.set(key, list);
    }
  }

  const overlaps: { keyword: string; domains: string[] }[] = [];
  for (const [keyword, domainList] of keywordMap) {
    if (domainList.length > 1) {
      overlaps.push({ keyword, domains: domainList });
    }
  }

  if (overlaps.length > 0) {
    issues.push({
      type: "taxonomy_keyword_overlap",
      message: `${overlaps.length}개 키워드가 여러 도메인에 중복 등록됨`,
      details: { overlaps: overlaps.slice(0, 10) },
    });
    suggestions.push("도메인 간 중복 키워드를 정리하면 분류 정확도가 향상됩니다.");
  }
}

function validateTemplateCompleteness(
  resolved: ResolvedSkill,
  issues: EvaluationIssue[],
  _suggestions: string[],
): void {
  for (const domain of resolved.domainOrder) {
    const templates = resolved.templates[domain] ?? [];

    if (templates.length === 0) {
      issues.push({
        type: "taxonomy_template_completeness",
        message: `${domain}: 템플릿이 없음 (최소 1개 필요)`,
        details: { domain },
      });
      continue;
    }

    for (let i = 0; i < templates.length; i++) {
      const t = templates[i]!;
      const missing: string[] = [];
      if (!t.steps?.trim()) missing.push("steps");
      if (!t.expectedResult?.trim()) missing.push("expectedResult");
      if (missing.length > 0) {
        issues.push({
          type: "taxonomy_template_completeness",
          message: `${domain} 템플릿[${i}]: ${missing.join(", ")} 필드가 비어있음`,
          details: { domain, templateIndex: i, missingFields: missing },
        });
      }
    }
  }
}

function validateMinSets(
  resolved: ResolvedSkill,
  issues: EvaluationIssue[],
  suggestions: string[],
): void {
  for (const domain of resolved.domainOrder) {
    const minSet = resolved.domainMinSets[domain];
    if (!minSet) continue;

    const total = Object.values(minSet).reduce((sum, v) => sum + v, 0);
    if (total > MAX_MINSETS_TOTAL_PER_DOMAIN) {
      issues.push({
        type: "taxonomy_minsets",
        message: `${domain}: minSets 합계 ${total}이 상한 ${MAX_MINSETS_TOTAL_PER_DOMAIN} 초과`,
        details: { domain, total, max: MAX_MINSETS_TOTAL_PER_DOMAIN },
      });
      suggestions.push(`${domain} 도메인의 최소 TC 수를 줄이세요.`);
    }

    if (minSet.Functional === 0) {
      issues.push({
        type: "taxonomy_minsets",
        message: `${domain}: Functional TC 최소 개수가 0 (정상 기능 검증 누락 우려)`,
        details: { domain },
      });
    }
  }
}

function validateBalance(
  resolved: ResolvedSkill,
  issues: EvaluationIssue[],
  suggestions: string[],
): void {
  if (resolved.domainOrder.length < 2) return;

  const kwCounts = resolved.domainOrder.map(
    (d) => (resolved.domainKeywords[d] ?? []).length,
  );
  const tplCounts = resolved.domainOrder.map(
    (d) => (resolved.templates[d] ?? []).length,
  );

  checkSkew("키워드", kwCounts, resolved.domainOrder, issues, suggestions);
  checkSkew("템플릿", tplCounts, resolved.domainOrder, issues, suggestions);
}

function checkSkew(
  label: string,
  counts: number[],
  domainOrder: readonly string[],
  issues: EvaluationIssue[],
  suggestions: string[],
): void {
  const nonZero = counts.filter((c) => c > 0);
  if (nonZero.length < 2) return;

  const min = Math.min(...nonZero);
  const max = Math.max(...nonZero);
  if (min > 0 && max / min >= BALANCE_RATIO_THRESHOLD) {
    const maxDomain = domainOrder[counts.indexOf(max)]!;
    const minDomain = domainOrder[counts.indexOf(min)]!;
    issues.push({
      type: "taxonomy_balance",
      message: `${label} 편중: ${maxDomain}(${max}개) vs ${minDomain}(${min}개), 비율 ${(max / min).toFixed(1)}x`,
      details: { label, maxDomain, maxCount: max, minDomain, minCount: min },
    });
    suggestions.push(`${label} 분포를 균등하게 조정하면 TC 품질이 향상됩니다.`);
  }
}
