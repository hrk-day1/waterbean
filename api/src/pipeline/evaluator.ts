import type { ChecklistItem, TcType, TestCase, TestPoint } from "../types/tc.js";
import { TC_TYPES } from "../types/tc.js";
import type {
  EvaluateOptions,
  EvaluationIssue,
  EvaluationResult,
  EvaluatorGateMode,
  PipelineStats,
} from "../types/pipeline.js";
import type { ResolvedSkill } from "../skills/resolved-skill.js";
import { isPipelineGlobalCommonTc } from "./generator.js";
import { deriveTestPointsForChecklist } from "./test-points.js";

const VALID_PRIORITIES = new Set(["P0", "P1", "P2"]);
const VALID_SEVERITIES = new Set(["S1", "S2", "S3"]);
const VALID_TYPES = new Set<string>(TC_TYPES);

const BLOCKING_ISSUE_TYPES = new Set(["schema", "required_field", "coverage", "test_point_missing"]);

const DEFAULT_EVALUATE_OPTIONS: EvaluateOptions = {
  evalSpecGrounding: "warn",
  evalTraceability: "warn",
};

function resolveEvaluateOptions(overrides?: EvaluateOptions): EvaluateOptions {
  return {
    evalSpecGrounding: overrides?.evalSpecGrounding ?? DEFAULT_EVALUATE_OPTIONS.evalSpecGrounding,
    evalTraceability: overrides?.evalTraceability ?? DEFAULT_EVALUATE_OPTIONS.evalTraceability,
  };
}

function issueIsBlocking(issue: EvaluationIssue, opts: EvaluateOptions): boolean {
  if (BLOCKING_ISSUE_TYPES.has(issue.type)) return true;
  if (issue.type === "spec_ungrounded") return opts.evalSpecGrounding === "block";
  if (issue.type === "traceability_mismatch") return opts.evalTraceability === "block";
  return false;
}

export function evaluate(
  checklist: ChecklistItem[],
  testCases: TestCase[],
  resolved: ResolvedSkill,
  evaluateOptions?: EvaluateOptions,
): EvaluationResult {
  const opts = resolveEvaluateOptions(evaluateOptions);
  const issues: EvaluationIssue[] = [];

  validateSchema(testCases, issues);
  validateRequiredFields(testCases, issues);
  const domainDist = validateDomainMinSets(testCases, issues, resolved);
  const uncoveredItems = validateCoverage(checklist, testCases, issues);
  validateTestPointCoverage(checklist, testCases, issues);
  validateDuplicates(testCases, issues);

  const byReqId = buildChecklistByRequirementId(checklist);
  validateTraceabilityAlignment(testCases, byReqId, issues, opts.evalTraceability);
  validateSpecGrounding(testCases, byReqId, issues, opts.evalSpecGrounding);

  const stats = buildStats(testCases, domainDist, checklist);

  const hasBlockingIssues = issues.some((i) => issueIsBlocking(i, opts));

  return {
    passed: !hasBlockingIssues && uncoveredItems.length === 0,
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

function buildKeywordPatterns(resolved: ResolvedSkill): Map<string, RegExp> {
  const map = new Map<string, RegExp>();
  for (const domain of resolved.domainOrder) {
    const words = resolved.domainKeywords[domain];
    if (words?.length) {
      map.set(domain, new RegExp(words.join("|"), "i"));
    }
  }
  return map;
}

function inferDomainFromTc(
  tc: TestCase,
  patterns: Map<string, RegExp>,
  resolved: ResolvedSkill,
): string {
  const text = `${tc.Feature} ${tc.Scenario}`;
  for (const domain of resolved.domainOrder) {
    const re = patterns.get(domain);
    if (re?.test(text)) return domain;
  }
  return resolved.fallbackDomain;
}

function validateDomainMinSets(
  testCases: TestCase[],
  issues: EvaluationIssue[],
  resolved: ResolvedSkill,
): Record<string, number> {
  const patterns = buildKeywordPatterns(resolved);
  const domainDist: Record<string, number> = Object.fromEntries(
    resolved.domainOrder.map((d) => [d, 0]),
  );
  const counts: Record<string, Record<TcType, number>> = Object.fromEntries(
    resolved.domainOrder.map((d) => [d, emptyTypeCounts()]),
  );

  for (const tc of testCases) {
    if (isPipelineGlobalCommonTc(tc)) continue;
    const domain = inferDomainFromTc(tc, patterns, resolved);
    domainDist[domain] = (domainDist[domain] ?? 0) + 1;
    if (!counts[domain]) counts[domain] = emptyTypeCounts();
    counts[domain][tc.Type]++;
  }

  for (const [domain, minSet] of Object.entries(resolved.domainMinSets)) {
    if ((domainDist[domain] ?? 0) === 0) continue;

    const c = counts[domain] ?? emptyTypeCounts();

    for (const [type, minCount] of Object.entries(minSet)) {
      if (c[type as TcType] < minCount) {
        issues.push({
          type: "domain_min",
          message: `${domain} 도메인: ${type} TC가 ${c[type as TcType]}개로 최소 ${minCount}개 미달`,
          details: { domain, type, current: c[type as TcType], required: minCount },
        });
      }
    }
  }

  return domainDist;
}

function splitReqIds(raw: string): string[] {
  return raw.split(",").map((id) => id.trim()).filter(Boolean);
}

function buildChecklistByRequirementId(checklist: ChecklistItem[]): Map<string, ChecklistItem> {
  const m = new Map<string, ChecklistItem>();
  for (const c of checklist) {
    if (!m.has(c.requirementId)) m.set(c.requirementId, c);
  }
  return m;
}

function parseTraceabilityRows(raw: string): number[] {
  return [...raw.matchAll(/R\s*(\d+)/gi)].map((m) => parseInt(m[1]!, 10));
}

function linkedChecklistItems(tc: TestCase, byReqId: Map<string, ChecklistItem>): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  for (const reqId of splitReqIds(tc.Requirement_ID)) {
    const item = byReqId.get(reqId);
    if (item) out.push(item);
  }
  return out;
}

interface SpecGroundingRule {
  id: string;
  tcPattern: RegExp;
  specPattern: RegExp;
  skipIfAnyPaymentDomain?: boolean;
}

const SPEC_GROUNDING_RULES: SpecGroundingRule[] = [
  { id: "webhook", tcPattern: /webhook|웹훅/i, specPattern: /webhook|웹훅/i },
  { id: "idempotency", tcPattern: /멱등|idempot/i, specPattern: /멱등|idempot/i },
  {
    id: "pg_vendor",
    tcPattern: /토스페이먼츠|toss\s*payments|아임포트|iamport|이니시스|나이스페이|nice\s*pay|stripe|paypal/i,
    specPattern:
      /토스|아임포트|이니시스|나이스|stripe|paypal|\bPG\b|pg사|실결제|payment\s*gateway|결제\s*게이트웨이/i,
  },
  {
    id: "batch",
    tcPattern: /배치\s*잡|batch\s*job|\bcron\b|크론|스케줄러|scheduler/i,
    specPattern: /배치|batch|\bcron\b|크론|스케줄러|scheduler/i,
  },
  {
    id: "refund_flow",
    tcPattern: /환불\s*(처리|요청|완료)|전액\s*환불|부분\s*환불/i,
    specPattern: /환불|refund/i,
  },
  {
    id: "pg_generic",
    tcPattern: /\bPG\b|pg\s*연동|payment\s*gateway|결제\s*게이트웨이/i,
    specPattern: /\bPG\b|실결제|웹훅|멱등|결제\s*게이트웨이|payment\s*gateway|pg\s*연동/i,
    skipIfAnyPaymentDomain: true,
  },
];

function specTextNormalized(items: ChecklistItem[]): string {
  if (items.length === 0) return "";
  return normalizeText(
    items
      .map((i) => [i.description, i.feature, (i.featureTypes ?? []).join(" ")].join(" "))
      .join(" "),
  );
}

function tcBodyNormalized(tc: TestCase): string {
  return normalizeText(`${tc.Feature} ${tc.Scenario} ${tc.Test_Steps} ${tc.Expected_Result}`);
}

function validateTraceabilityAlignment(
  testCases: TestCase[],
  byReqId: Map<string, ChecklistItem>,
  issues: EvaluationIssue[],
  mode: EvaluatorGateMode,
): void {
  if (mode === "off") return;

  for (const tc of testCases) {
    if (isPipelineGlobalCommonTc(tc)) continue;
    const rows = parseTraceabilityRows(tc.Traceability);
    if (rows.length === 0) continue;

    const expectedRows = new Set<number>();
    for (const reqId of splitReqIds(tc.Requirement_ID)) {
      const item = byReqId.get(reqId);
      if (item) expectedRows.add(item.sourceRow);
    }
    if (expectedRows.size === 0) continue;

    const rowSet = new Set(rows);
    const missing = [...expectedRows].filter((r) => !rowSet.has(r));
    if (missing.length > 0) {
      issues.push({
        type: "traceability_mismatch",
        message: `${tc.TC_ID}: Traceability(${tc.Traceability})에 체크리스트 기대 행 R${missing.join(", R")} 없음`,
        details: { tcId: tc.TC_ID, traceability: tc.Traceability, missingRows: missing },
      });
    }
  }
}

function validateSpecGrounding(
  testCases: TestCase[],
  byReqId: Map<string, ChecklistItem>,
  issues: EvaluationIssue[],
  mode: EvaluatorGateMode,
): void {
  if (mode === "off") return;

  for (const tc of testCases) {
    if (isPipelineGlobalCommonTc(tc)) continue;

    const items = linkedChecklistItems(tc, byReqId);
    if (items.length === 0) continue;

    const specNorm = specTextNormalized(items);
    const tcNorm = tcBodyNormalized(tc);
    const violated: string[] = [];

    for (const rule of SPEC_GROUNDING_RULES) {
      if (rule.skipIfAnyPaymentDomain && items.some((i) => i.domain === "Payment")) {
        continue;
      }
      if (rule.tcPattern.test(tcNorm) && !rule.specPattern.test(specNorm)) {
        violated.push(rule.id);
      }
    }

    if (violated.length > 0) {
      issues.push({
        type: "spec_ungrounded",
        message: `${tc.TC_ID}: TC 본문에 기능설명·기능명에 없는 주제가 포함됨 (${violated.join(", ")})`,
        details: { tcId: tc.TC_ID, themes: violated, requirementIds: splitReqIds(tc.Requirement_ID) },
      });
    }
  }
}

function validateCoverage(
  checklist: ChecklistItem[],
  testCases: TestCase[],
  issues: EvaluationIssue[],
): ChecklistItem[] {
  const coveredReqIds = new Set(testCases.flatMap((tc) => splitReqIds(tc.Requirement_ID)));
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

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function validateDuplicates(testCases: TestCase[], issues: EvaluationIssue[]) {
  const seen = new Map<string, string>();

  for (const tc of testCases) {
    const feature = normalizeText(tc.Feature);
    const scenario = normalizeText(tc.Scenario);
    const dupKey = `${feature}|${scenario}|${tc.Type}`;
    const existing = seen.get(dupKey);
    if (existing) {
      issues.push({
        type: "duplicate",
        message: `${tc.TC_ID}와 ${existing}가 중복 (기능: ${tc.Feature})`,
      });
    } else {
      seen.set(dupKey, tc.TC_ID);
    }
  }
}

function testPointMatchesTc(tp: TestPoint, tc: TestCase): boolean {
  const scenarioLower = tc.Scenario.toLowerCase();
  const expectedLower = tc.Expected_Result.toLowerCase();
  const combined = `${scenarioLower} ${expectedLower}`;

  const intentWords = tp.intent.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const matchedWords = intentWords.filter((w) => combined.includes(w));
  if (matchedWords.length >= Math.ceil(intentWords.length * 0.4)) return true;

  const pointTypeLower = tp.pointType.toLowerCase();
  if (combined.includes(pointTypeLower)) return true;

  return false;
}

function validateTestPointCoverage(
  checklist: ChecklistItem[],
  testCases: TestCase[],
  issues: EvaluationIssue[],
): void {
  const testPointMap = deriveTestPointsForChecklist(checklist, true);

  const tcByReqId = new Map<string, TestCase[]>();
  for (const tc of testCases) {
    for (const reqId of splitReqIds(tc.Requirement_ID)) {
      const list = tcByReqId.get(reqId) ?? [];
      list.push(tc);
      tcByReqId.set(reqId, list);
    }
  }

  for (const item of checklist) {
    const points = testPointMap.get(item.id) ?? [];
    const requiredPoints = points.filter((p) => p.required);
    if (requiredPoints.length === 0) continue;

    const itemTcs = tcByReqId.get(item.requirementId) ?? [];
    if (itemTcs.length === 0) continue;

    for (const tp of requiredPoints) {
      const covered = itemTcs.some((tc) => testPointMatchesTc(tp, tc));
      if (!covered) {
        issues.push({
          type: "test_point_missing",
          message: `${item.requirementId}: 기능 '${item.feature}'에서 필수 테스트 포인트 '${tp.pointType}' 누락 — ${tp.intent}`,
          details: {
            checklistId: item.id,
            requirementId: item.requirementId,
            feature: item.feature,
            pointType: tp.pointType,
            intent: tp.intent,
          },
        });
      }
    }
  }
}

function buildStats(
  testCases: TestCase[],
  domainDist: Record<string, number>,
  checklist: ChecklistItem[],
): PipelineStats {
  const priorityDist = { P0: 0, P1: 0, P2: 0 };
  const typeDist: Record<TcType, number> = {
    Functional: 0, Negative: 0, Boundary: 0, Regression: 0, Accessibility: 0, Security: 0,
  };
  const coverageGaps: string[] = [];
  const mappingGaps: string[] = [];
  const mappingGapSeen = new Set<string>();

  for (const tc of testCases) {
    if (tc.Priority in priorityDist) priorityDist[tc.Priority as keyof typeof priorityDist]++;
    if (tc.Type in typeDist) typeDist[tc.Type]++;

    const reasons: string[] = [];
    if (tc.Feature === "UNKNOWN_FEATURE") reasons.push("Feature");

    const reqIds = splitReqIds(tc.Requirement_ID);
    if (reqIds.some((id) => id.startsWith("AUTO-"))) reasons.push("Requirement_ID");

    if (reasons.length > 0) {
      const message = `${tc.TC_ID}: MAPPING_GAP:${reasons.join(",")}`;
      if (!mappingGapSeen.has(message)) {
        mappingGapSeen.add(message);
        mappingGaps.push(message);
      }
    }
  }

  const coveredReqIds = new Set(testCases.flatMap((tc) => splitReqIds(tc.Requirement_ID)));
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
