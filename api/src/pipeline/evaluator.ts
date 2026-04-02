import type { ChecklistItem, Domain, TcType, TestCase } from "../types/tc.js";
import { DOMAINS, TC_TYPES } from "../types/tc.js";
import type { EvaluationIssue, EvaluationResult, PipelineStats } from "../types/pipeline.js";
import type { SkillManifest } from "../skills/types.js";

const VALID_PRIORITIES = new Set(["P0", "P1", "P2"]);
const VALID_SEVERITIES = new Set(["S1", "S2", "S3"]);
const VALID_TYPES = new Set<string>(TC_TYPES);

export function evaluate(
  checklist: ChecklistItem[],
  testCases: TestCase[],
  skill: SkillManifest,
): EvaluationResult {
  const issues: EvaluationIssue[] = [];

  validateSchema(testCases, issues);
  validateRequiredFields(testCases, issues);
  const domainDist = validateDomainMinSets(testCases, issues, skill);
  const uncoveredItems = validateCoverage(checklist, testCases, issues);
  validateDuplicates(testCases, issues);

  const stats = buildStats(testCases, domainDist, checklist);

  return {
    passed: issues.length === 0 && uncoveredItems.length === 0,
    totalTCs: testCases.length,
    issues,
    uncoveredItems,
    stats,
  };
}

function validateSchema(testCases: TestCase[], issues: EvaluationIssue[]) {
  for (const tc of testCases) {
    if (!VALID_TYPES.has(tc.Type)) {
      issues.push({
        type: "schema",
        message: `${tc.TC_ID}: Type '${tc.Type}' 은 허용 목록에 없음`,
      });
    }
    if (!VALID_PRIORITIES.has(tc.Priority)) {
      issues.push({
        type: "schema",
        message: `${tc.TC_ID}: Priority '${tc.Priority}' 은 P0/P1/P2 중 하나여야 함`,
      });
    }
    if (!VALID_SEVERITIES.has(tc.Severity)) {
      issues.push({
        type: "schema",
        message: `${tc.TC_ID}: Severity '${tc.Severity}' 은 S1/S2/S3 중 하나여야 함`,
      });
    }
  }
}

function validateRequiredFields(testCases: TestCase[], issues: EvaluationIssue[]) {
  for (const tc of testCases) {
    if (!tc.Requirement_ID) {
      issues.push({ type: "required_field", message: `${tc.TC_ID}: Requirement_ID 누락` });
    }
    if (!tc.Traceability) {
      issues.push({ type: "required_field", message: `${tc.TC_ID}: Traceability 누락` });
    }
    if (!tc.Expected_Result) {
      issues.push({ type: "required_field", message: `${tc.TC_ID}: Expected_Result 누락` });
    }
  }
}

function emptyTypeCounts(): Record<TcType, number> {
  return { Functional: 0, Negative: 0, Boundary: 0, Security: 0, Regression: 0, Accessibility: 0 };
}

function buildKeywordPatterns(
  domainKeywords: Record<Domain, string[]>,
): Map<Domain, RegExp> {
  const map = new Map<Domain, RegExp>();
  for (const domain of DOMAINS) {
    const words = domainKeywords[domain];
    if (words?.length) {
      map.set(domain, new RegExp(words.join("|"), "i"));
    }
  }
  return map;
}

function inferDomainFromTc(
  tc: TestCase,
  patterns: Map<Domain, RegExp>,
): Domain {
  const text = `${tc.Feature} ${tc.Scenario}`;
  for (const domain of DOMAINS) {
    const re = patterns.get(domain);
    if (re?.test(text)) return domain;
  }
  return "Admin";
}

function validateDomainMinSets(
  testCases: TestCase[],
  issues: EvaluationIssue[],
  skill: SkillManifest,
): Record<Domain, number> {
  const patterns = buildKeywordPatterns(skill.domainKeywords);
  const domainDist = Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<Domain, number>;
  const counts = Object.fromEntries(DOMAINS.map((d) => [d, emptyTypeCounts()])) as Record<Domain, Record<TcType, number>>;

  for (const tc of testCases) {
    const domain = inferDomainFromTc(tc, patterns);
    domainDist[domain]++;
    counts[domain][tc.Type]++;
  }

  for (const [domain, minSet] of Object.entries(skill.domainMinSets)) {
    const d = domain as Domain;
    if (domainDist[d] === 0) continue;

    for (const [type, minCount] of Object.entries(minSet)) {
      if (counts[d][type as TcType] < minCount) {
        issues.push({
          type: "domain_min",
          message: `${d} 도메인: ${type} TC가 ${counts[d][type as TcType]}개로 최소 ${minCount}개 미달`,
          details: { domain: d, type, current: counts[d][type as TcType], required: minCount },
        });
      }
    }
  }

  return domainDist;
}

function validateCoverage(
  checklist: ChecklistItem[],
  testCases: TestCase[],
  issues: EvaluationIssue[],
): ChecklistItem[] {
  const coveredReqIds = new Set(testCases.map((tc) => tc.Requirement_ID));
  const uncovered = checklist.filter((item) => !coveredReqIds.has(item.requirementId));

  for (const item of uncovered) {
    issues.push({
      type: "coverage",
      message: `${item.requirementId}: 체크리스트 항목 '${item.description}'에 대한 TC 없음`,
      details: { checklistId: item.id, requirementId: item.requirementId },
    });
  }

  return uncovered;
}

function validateDuplicates(testCases: TestCase[], issues: EvaluationIssue[]) {
  const seen = new Map<string, string>();

  for (const tc of testCases) {
    const key = `${tc.Requirement_ID}|${tc.Scenario.toLowerCase().replace(/\s+/g, " ").trim()}`;
    const existing = seen.get(key);
    if (existing) {
      issues.push({
        type: "duplicate",
        message: `${tc.TC_ID}와 ${existing}가 중복 (${tc.Requirement_ID})`,
      });
    } else {
      seen.set(key, tc.TC_ID);
    }
  }
}

function buildStats(
  testCases: TestCase[],
  domainDist: Record<Domain, number>,
  checklist: ChecklistItem[],
): PipelineStats {
  const priorityDist = { P0: 0, P1: 0, P2: 0 };
  const typeDist: Record<TcType, number> = {
    Functional: 0, Negative: 0, Boundary: 0, Regression: 0, Accessibility: 0, Security: 0,
  };
  const coverageGaps: string[] = [];
  const mappingGaps: string[] = [];

  for (const tc of testCases) {
    if (tc.Priority in priorityDist) priorityDist[tc.Priority as keyof typeof priorityDist]++;
    if (tc.Type in typeDist) typeDist[tc.Type]++;
    if (tc.Notes.includes("MAPPING_GAP")) mappingGaps.push(`${tc.TC_ID}: ${tc.Notes}`);
  }

  const coveredReqIds = new Set(testCases.map((tc) => tc.Requirement_ID));
  for (const item of checklist) {
    if (!coveredReqIds.has(item.requirementId)) {
      coverageGaps.push(`${item.requirementId}: ${item.description}`);
    }
  }

  return {
    totalTCs: testCases.length,
    domainDistribution: domainDist,
    priorityDistribution: priorityDist,
    typeDistribution: typeDist,
    coverageGaps,
    mappingGaps,
  };
}
