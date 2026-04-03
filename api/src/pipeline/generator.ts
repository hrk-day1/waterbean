import type { ChecklistItem, Priority, Severity, TestCase, TestPoint, TcType } from "../types/tc.js";
import { TC_TYPES } from "../types/tc.js";
import type { TcTemplate } from "../skills/types.js";
import type { ResolvedSkill, ResolvedPriorityRule, ResolvedSeverityRule } from "../skills/resolved-skill.js";
import { deriveTestPointsForChecklist } from "./test-points.js";

/** 파이프라인 공통 TC 블록 — 체크리스트 requirementId와 충돌 없음 */
export const GLOBAL_COMMON_REQUIREMENT_ID = "GLOBAL-COMMON";

interface GeneratorConfig {
  ownerDefault: string;
  environmentDefault: string;
  maxTcPerRequirement?: number;
}

const EXPECTED_RESULT_MAX_LEN = 200;
const PRECONDITION_MAX_LEN = 200;

function lastFeatureSegment(featurePath: string): string {
  const parts = featurePath.split(">").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : featurePath.trim() || "기능";
}

function splitDescriptionLines(description: string): string[] {
  if (!description?.trim()) return [];
  return description
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-*•\d.)]+/, "").trim())
    .filter((l) => l.length > 2);
}

/** 로그인·메뉴/화면 진입 등 Feature·Scenario로 유추 가능한 반복 접근 — Steps 대신 Precondition으로 보냄 */
function isRoutineAccessSpecLine(line: string): boolean {
  const s = line.trim();
  if (s.length < 3) return false;
  if (/저장|삭제|제출|검색|필터|승인|반려|업로드|결제|입력|수정|등록|다운로드/.test(s)) return false;

  if (/(?:^|[\s,.])(?:로그인|로그\s*아웃|로그아웃)(?:\s|$|[,.])/.test(s)) return true;
  if (/메뉴(?:\s*에서|\s*로|\s*를)?\s*(?:이동|진입|선택|클릭)/.test(s)) return true;
  if (/(?:화면|페이지|화면으로)\s*(?:까지\s*)?(?:이동|진입)/.test(s)) return true;
  if (/접속\s*후|서비스\s*접속|앱\s*실행/.test(s)) return true;
  // 순수 메뉴 경로 한 줄 (예: 관리 > 회원 > 목록)
  if (/^[\w가-힣0-9\s>·\-–—]+$/.test(s) && />/.test(s) && s.length <= 120) return true;

  return false;
}

/** 스펙 줄을 Steps용 / Precondition 보강용으로 분리 */
function partitionSpecLinesForSteps(description: string, maxStepLines: number): {
  stepLines: string[];
  navigationLines: string[];
} {
  const lines = splitDescriptionLines(description);
  const navigationLines: string[] = [];
  const contentLines: string[] = [];
  for (const line of lines) {
    if (isRoutineAccessSpecLine(line)) navigationLines.push(line);
    else contentLines.push(line);
  }
  return {
    stepLines: contentLines.slice(0, maxStepLines),
    navigationLines,
  };
}

/** 스펙(기능 설명)에서 절차에 넣을 줄만 추출 (최대 maxLines) — Expected 등 비절차 필드용 */
function extractSpecStepLines(description: string, maxLines: number): string[] {
  const lines = splitDescriptionLines(description);
  return lines.slice(0, maxLines);
}

function compactPreconditionChunk(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** Precondition: 서술문 대신 짧은 전제 정보(역할·화면·상태 키워드) */
function buildPreconditionForTestPoint(item: ChecklistItem, navigationFromSpec: string[]): string {
  const base = item.precondition?.trim() ?? "";
  const nav = navigationFromSpec
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2);

  const chunks: string[] = [];
  if (base) chunks.push(compactPreconditionChunk(base, 100));
  if (nav.length) chunks.push(compactPreconditionChunk(nav.join(" · "), 80));
  if (chunks.length === 0) {
    chunks.push("권한계정·대상화면");
  }
  return compactPreconditionChunk(chunks.join(" | "), PRECONDITION_MAX_LEN);
}

function buildExpectedFromSpec(intent: string, description: string): string {
  const specBits = extractSpecStepLines(description, 2);
  if (specBits.length === 0) return intent;
  const quoted = specBits.map((s) => `「${s.length > 80 ? `${s.slice(0, 77)}…` : s}」`).join(", ");
  const merged = `${intent} (${quoted} 기준으로 화면·데이터가 일치한다)`;
  return merged.length <= EXPECTED_RESULT_MAX_LEN
    ? merged
    : `${intent} (스펙 설명의 주요 항목이 반영된다)`;
}

export function isPipelineGlobalCommonTc(tc: TestCase): boolean {
  return (
    tc.Requirement_ID === GLOBAL_COMMON_REQUIREMENT_ID
    || (tc.Notes?.includes("공통 템플릿") ?? false)
    || tc.Feature.startsWith("프로젝트 공통")
  );
}

/**
 * 스킬 globalTemplates로 파이프라인당 1블록 TC 생성 (시트 상단용).
 */
export function buildGlobalTemplateTestCases(
  resolved: ResolvedSkill,
  config: GeneratorConfig,
  startCounter: number,
): { cases: TestCase[]; nextCounter: number } {
  const globals = resolved.globalTemplates ?? [];
  if (globals.length === 0) {
    return { cases: [], nextCounter: startCounter };
  }

  const domain = resolved.fallbackDomain;
  const featureLabel = `프로젝트 공통 (${resolved.name})`;
  const cases: TestCase[] = [];
  let n = startCounter;

  for (const tmpl of globals) {
    cases.push({
      TC_ID: `TC-${String(n++).padStart(4, "0")}`,
      Feature: featureLabel,
      Requirement_ID: GLOBAL_COMMON_REQUIREMENT_ID,
      Scenario: tmpl.scenarioSuffix,
      Precondition: tmpl.precondition,
      Test_Steps: tmpl.steps,
      Test_Data: "",
      Expected_Result: tmpl.expectedResult,
      Priority: determinePriority(domain, tmpl.type, resolved.priorityRules),
      Severity: determineSeverity(domain, tmpl.type, resolved.severityRules),
      Type: tmpl.type,
      Environment: config.environmentDefault,
      Owner: config.ownerDefault,
      Status: "Draft",
      Automation_Candidate: "N",
      Traceability: "R0",
      Notes: "공통 템플릿(1회)",
    });
  }

  return { cases, nextCounter: n };
}

/** 글로벌 선행 + tail TC_ID를 1부터 연속 재부여 */
export function prependGlobalTemplatesAndRenumber(
  tailCases: TestCase[],
  resolved: ResolvedSkill,
  config: GeneratorConfig,
): TestCase[] {
  const { cases: globals } = buildGlobalTemplateTestCases(resolved, config, 1);
  // 입력 배열과 동일 참조를 반환하면 호출부가 tail을 비우는 순간 결과까지 사라지므로 복사본 반환
  if (globals.length === 0) return [...tailCases];
  const combined = [...globals, ...tailCases];
  combined.forEach((tc, i) => {
    tc.TC_ID = `TC-${String(i + 1).padStart(4, "0")}`;
  });
  return combined;
}

/** 병합 등으로 순서가 섞인 뒤에도 공통 TC를 상단에 두고 TC_ID 재부여 */
export function sortGlobalCommonTcFirstAndRenumber(tcs: TestCase[]): TestCase[] {
  const globals = tcs.filter(isPipelineGlobalCommonTc);
  const rest = tcs.filter((tc) => !isPipelineGlobalCommonTc(tc));
  const merged = [...globals, ...rest];
  merged.forEach((tc, i) => {
    tc.TC_ID = `TC-${String(i + 1).padStart(4, "0")}`;
  });
  return merged;
}

function formatTraceability(row: number): string {
  return `R${row}`;
}

function determinePriority(
  domain: string,
  type: TcType,
  rules: ResolvedPriorityRule[],
): Priority {
  for (const rule of rules) {
    if (rule.domain === domain && rule.types.includes(type)) {
      return rule.priority;
    }
  }
  if (type === "Negative" || type === "Boundary") return "P1";
  return "P2";
}

function determineSeverity(
  domain: string,
  type: TcType,
  rules: ResolvedSeverityRule[],
): Severity {
  if (type === "Security") return "S1";
  for (const rule of rules) {
    if (rule.domain === domain && rule.types.includes(type)) {
      return rule.severity;
    }
  }
  if (type === "Functional" || type === "Negative") return "S2";
  return "S3";
}

function emptyDomainTypeCounts(): Record<TcType, number> {
  return Object.fromEntries(TC_TYPES.map((t) => [t, 0])) as Record<TcType, number>;
}

export function generateTestCases(
  checklist: ChecklistItem[],
  config: GeneratorConfig,
  resolved: ResolvedSkill,
): TestCase[] {
  const testCases: TestCase[] = [];
  const { cases: globalCases, nextCounter } = buildGlobalTemplateTestCases(resolved, config, 1);
  testCases.push(...globalCases);
  let tcCounter = nextCounter;

  const domainCounts = Object.fromEntries(
    resolved.domainOrder.map((d) => [d, emptyDomainTypeCounts()]),
  ) as Record<string, Record<TcType, number>>;

  for (const item of checklist) {
    const templates = resolved.templates[item.domain] ?? [];
    const applicableTemplates = config.maxTcPerRequirement
      ? templates.slice(0, config.maxTcPerRequirement)
      : templates;

    for (const tmpl of applicableTemplates) {
      const tcId = `TC-${String(tcCounter++).padStart(4, "0")}`;

      testCases.push({
        TC_ID: tcId,
        Feature: item.feature,
        Requirement_ID: item.requirementId,
        Scenario: tmpl.scenarioSuffix,
        Precondition: tmpl.precondition,
        Test_Steps: tmpl.steps,
        Test_Data: "",
        Expected_Result: tmpl.expectedResult,
        Priority: determinePriority(item.domain, tmpl.type, resolved.priorityRules),
        Severity: determineSeverity(item.domain, tmpl.type, resolved.severityRules),
        Type: tmpl.type,
        Environment: config.environmentDefault,
        Owner: config.ownerDefault,
        Status: "Draft",
        Automation_Candidate: "N",
        Traceability: formatTraceability(item.sourceRow),
      });

      const dc = domainCounts[item.domain] ?? (domainCounts[item.domain] = emptyDomainTypeCounts());
      dc[tmpl.type]++;
    }

    item.covered = true;
  }

  ensureDomainMinSets(testCases, domainCounts, checklist, config, resolved, tcCounter);

  return deduplicateTestCases(testCases);
}

function ensureDomainMinSets(
  testCases: TestCase[],
  counts: Record<string, Record<TcType, number>>,
  checklist: ChecklistItem[],
  config: GeneratorConfig,
  resolved: ResolvedSkill,
  startId: number,
) {
  let tcCounter = startId;
  const minSetTemplateSigs = new Set<string>();

  for (const domain of resolved.domainOrder) {
    const minSet = resolved.domainMinSets[domain];
    if (!minSet) continue;

    const representative = checklist.find((c) => c.domain === domain);
    if (!representative) continue;

    const templates: TcTemplate[] = resolved.templates[domain] ?? [];
    const domainCountsFor = counts[domain] ?? (counts[domain] = emptyDomainTypeCounts());

    for (const [type, minCount] of Object.entries(minSet)) {
      const current = domainCountsFor[type as TcType];
      if (current >= minCount) continue;

      const gap = minCount - current;
      const matchingTemplates = templates.filter((t) => t.type === type);
      let filled = 0;
      let ti = 0;

      while (filled < gap && ti < matchingTemplates.length) {
        const tmpl = matchingTemplates[ti++]!;
        const sig = `${normalize(tmpl.scenarioSuffix)}|${tmpl.type}`;
        if (minSetTemplateSigs.has(sig)) continue;
        minSetTemplateSigs.add(sig);

        const tcId = `TC-${String(tcCounter++).padStart(4, "0")}`;

        testCases.push({
          TC_ID: tcId,
          Feature: representative.feature,
          Requirement_ID: representative.requirementId,
          Scenario: `${tmpl.scenarioSuffix} (도메인 최소세트 보완)`,
          Precondition: tmpl.precondition,
          Test_Steps: tmpl.steps,
          Test_Data: "",
          Expected_Result: tmpl.expectedResult,
          Priority: determinePriority(domain, tmpl.type, resolved.priorityRules),
          Severity: determineSeverity(domain, tmpl.type, resolved.severityRules),
          Type: tmpl.type,
          Environment: config.environmentDefault,
          Owner: config.ownerDefault,
          Status: "Draft",
          Automation_Candidate: "N",
          Traceability: formatTraceability(representative.sourceRow),
          Notes: "도메인 최소세트 보완 TC",
        });

        domainCountsFor[type as TcType]++;
        filled++;
      }
    }
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function deduplicateTestCases(testCases: TestCase[]): TestCase[] {
  const seen = new Set<string>();
  return testCases.filter((tc) => {
    const key = `${normalize(tc.Feature)}|${normalize(tc.Scenario)}|${tc.Type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildScenarioFromTestPoint(item: ChecklistItem, tp: TestPoint): string {
  const name = lastFeatureSegment(item.feature);
  return `「${name}」 ${tp.intent}`;
}

function baseActionLabelsForPointType(tp: TestPoint): string[] {
  switch (tp.pointType) {
    case "정상조회": return ["조회 실행", "목록/상세 데이터 확인"];
    case "빈결과": return ["데이터 없는 조건 설정", "조회 실행", "빈 상태 메시지 확인"];
    case "필터정렬": return ["필터/정렬 조건 설정", "적용", "결과 정합성 확인"];
    case "페이지네이션": return ["첫 페이지 확인", "다음 페이지 이동", "마지막 페이지 확인"];
    case "정상등록": return ["유효 데이터 입력", "저장", "결과 확인"];
    case "필수값누락": return ["필수 필드 비움", "저장 시도", "오류 메시지 확인"];
    case "중복등록": return ["동일 데이터로 등록 시도", "중복 처리 결과 확인"];
    case "입력경계값": return ["최소 길이 입력", "최대 길이 입력", "경계 초과 입력", "결과 확인"];
    case "정상수정": return ["데이터 변경", "저장", "변경 반영 확인"];
    case "필수값검증": return ["필수 필드 비움", "저장 시도", "오류 확인"];
    case "취소재진입": return ["수정 중 취소", "재진입", "원래 값 유지 확인"];
    case "정상삭제": return ["대상 선택", "삭제 실행", "목록에서 제거 확인"];
    case "삭제확인": return ["삭제 버튼 클릭", "확인 다이얼로그 표시 확인", "확인/취소 동작 검증"];
    case "참조무결성": return ["참조 중인 데이터 삭제 시도", "차단 또는 경고 확인"];
    case "유효전이": return ["현재 상태 확인", "허용된 상태로 전이 실행", "전이 결과 확인"];
    case "비허용전이": return ["현재 상태 확인", "비허용 상태로 전이 시도", "차단 확인"];
    case "전이후반영": return ["상태 전이 실행", "UI 반영 확인", "데이터 반영 확인"];
    case "승인처리": return ["승인 대상 선택", "승인 실행", "상태 변경 및 후속 처리 확인"];
    case "반려처리": return ["반려 대상 선택", "반려 사유 입력", "반려 실행", "상태 변경 확인"];
    case "권한없는승인": return ["권한 없는 계정으로 로그인", "승인 시도", "차단 확인"];
    case "허용역할": return ["허용 역할로 로그인", "대상 기능 접근", "정상 동작 확인"];
    case "비허용역할": return ["비허용 역할로 로그인", "대상 기능 접근 시도", "차단 메시지 확인"];
    case "숨김차단": return ["권한 없는 계정으로 로그인", "메뉴/버튼 숨김 또는 비활성 확인"];
    case "정상업로드": return ["허용 형식 파일 선택", "업로드 실행", "성공 확인"];
    case "비허용파일": return ["비허용 형식 또는 초과 크기 파일 선택", "업로드 시도", "거부 메시지 확인"];
    case "다운로드검증": return ["업로드된 파일 다운로드", "원본과 동일 여부 확인"];
    case "정상결제": return ["유효 결제수단 선택", "결제 실행", "승인 결과 확인"];
    case "결제실패": return ["실패 조건 설정 (잔액 부족 등)", "결제 시도", "오류 메시지 확인"];
    case "환불처리": return ["환불 요청", "환불 처리 확인", "금액 반환 확인"];
    case "금액경계값": return ["최소 금액 결제", "최대 금액 결제", "경계 초과 결제 시도"];
    case "중복결제방지": return ["동일 요청으로 결제 2회 시도", "중복 차단 확인"];
    case "정상실행": return ["배치 예약 설정", "예약 시간 도래", "실행 결과 확인"];
    case "실패재시도": return ["배치 실행 실패 유도", "재시도 또는 알림 확인"];
    case "중복실행방지": return ["동일 배치 중복 실행 시도", "방지 동작 확인"];
    case "정상연동": return ["외부 시스템 호출 실행", "응답 및 데이터 반영 확인"];
    case "연동실패": return ["외부 시스템 장애 상황 설정", "호출 실행", "오류 처리 확인"];
    case "데이터정합성": return ["연동 실행", "내부-외부 데이터 비교"];
    default: return [tp.intent];
  }
}

function buildStepsFromTestPoint(tp: TestPoint, specStepLines: string[]): string {
  const base = baseActionLabelsForPointType(tp);
  const parts: string[] = [];
  let n = 1;
  for (const s of specStepLines) {
    parts.push(`${n++}. (스펙) ${s}`);
  }
  for (const s of base) {
    parts.push(`${n++}. ${s}`);
  }
  return parts.join("\n");
}

export function generateTestCasesFromTestPoints(
  checklist: ChecklistItem[],
  config: GeneratorConfig,
  resolved: ResolvedSkill,
): TestCase[] {
  const testPointMap = deriveTestPointsForChecklist(checklist, true);
  const testCases: TestCase[] = [];
  const { cases: globalCases, nextCounter } = buildGlobalTemplateTestCases(resolved, config, 1);
  testCases.push(...globalCases);
  let tcCounter = nextCounter;

  for (const item of checklist) {
    const points = testPointMap.get(item.id) ?? [];

    for (const tp of points) {
      const { stepLines, navigationLines } = partitionSpecLinesForSteps(item.description, 4);
      testCases.push({
        TC_ID: `TC-${String(tcCounter++).padStart(4, "0")}`,
        Feature: item.feature,
        Requirement_ID: item.requirementId,
        Scenario: buildScenarioFromTestPoint(item, tp),
        Precondition: buildPreconditionForTestPoint(item, navigationLines),
        Test_Steps: buildStepsFromTestPoint(tp, stepLines),
        Test_Data: "",
        Expected_Result: buildExpectedFromSpec(tp.intent, item.description),
        Priority: determinePriority(item.domain, tp.suggestedTcType, resolved.priorityRules),
        Severity: determineSeverity(item.domain, tp.suggestedTcType, resolved.severityRules),
        Type: tp.suggestedTcType,
        Environment: config.environmentDefault,
        Owner: config.ownerDefault,
        Status: "Draft",
        Automation_Candidate: "N",
        Traceability: formatTraceability(item.sourceRow),
      });
    }

    item.covered = true;
  }

  return deduplicateTestCases(testCases);
}
