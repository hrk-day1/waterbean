import type { ChecklistItem, TestPoint } from "../../types/tc.js";
import type { ResolvedSkill } from "../../skills/resolved-skill.js";
import type { PolicyHint } from "../../skills/types.js";
import { TC_TYPES } from "../../types/tc.js";
import { TC_KEY_MAP, keyMappingTable, compactFieldList } from "../key-mapping.js";

/** 기능명·설명·테스트 포인트에 없는 결제·연동 시나리오를 임의 추가하지 않도록 공통 주입 */
const SHEET_GROUNDING_RULES = `
## 기능목록 근거
테스트 포인트·기능 설명·기능명에 **나오지 않은** 결제 승인·환불·웹훅·배치·외부 PG·권한 분기·운영 콘솔 전용 흐름을 **임의로 추가하지 말 것**. 스펙에 드러난 범위 안에서만 Steps·Expected를 구체화한다.
`;

function buildOmittableCompactKeysSection(config: {
  environmentDefault: string;
  ownerDefault: string;
}): string {
  return `
## 출력 시 생략 가능한 축약 키 (completion 토큰 절약)
- **f(Feature), ev(Environment), ow(Owner)** 는 JSON에서 **생략해도 됩니다.** 서버가 체크리스트의 **tr(Traceability)**·**ri(Requirement_ID)** 및 기본값(Environment "${config.environmentDefault}", Owner "${config.ownerDefault}")으로 채웁니다.
- **tr는 반드시 포함**하세요 (형식: "R{원본행번호}"). f를 생략할 때 tr로 기능 경로(Feature)를 복원합니다.
- **st(Status), ac(Automation_Candidate)** 도 생략 가능하며, 생략 시 서버가 Draft / N 으로 둡니다.
- **ti(TC_ID)는 반드시 포함**하세요.`;
}

interface ChecklistWithTestPoints {
  item: ChecklistItem;
  testPoints: TestPoint[];
}

export interface GeneratorPromptConfig {
  ownerDefault: string;
  environmentDefault: string;
  maxTcPerRequirement?: number;
  highRiskMaxTcPerRequirement?: number;
}

function formatTestPointsForPrompt(entries: ChecklistWithTestPoints[]): string {
  return entries.map((e) => {
    const risk = e.item.specRiskTier === "high" ? "높음 (금전·거래·규제 근거 스펙 — 단계·데이터·Expected 상세)" : "일반";
    const tpList = e.testPoints
      .map((tp) => `    - [${tp.pointType}] ${tp.intent} (Type: ${tp.suggestedTcType}, required: ${tp.required})`)
      .join("\n");
    return `  기능: "${e.item.feature}"
  요구사항ID: ${e.item.requirementId}
  스펙 리스크: ${risk}
  설명: ${e.item.description}
  기능유형: ${(e.item.featureTypes ?? []).join(", ") || "미분류"}
  사전조건(짧게): ${e.item.precondition || "없음"}
  원본: R${e.item.sourceRow}
  테스트 포인트:
${tpList}`;
  }).join("\n\n");
}

export function buildGeneratorPrompt(
  checklist: ChecklistItem[],
  domain: string,
  resolved: ResolvedSkill,
  config: GeneratorPromptConfig,
  startTcId: number,
  testPointMap?: Map<string, TestPoint[]>,
): string {
  const entries: ChecklistWithTestPoints[] = checklist.map((item) => ({
    item,
    testPoints: testPointMap?.get(item.id) ?? [],
  }));

  const hasTestPoints = entries.some((e) => e.testPoints.length > 0);

  if (hasTestPoints) {
    return buildFeatureDrivenPrompt(entries, domain, config, startTcId, resolved.policyHints ?? []);
  }

  return buildLegacyPrompt(checklist, domain, resolved, config, startTcId);
}

function formatPolicyHints(hints: PolicyHint[], domain: string): string {
  const relevant = hints.filter((h) => h.domain === domain || h.domain === "_common");
  if (relevant.length === 0) return "";

  const lines = relevant
    .map((h) => `  - [${h.riskLevel ?? "medium"}] ${h.hint}`)
    .join("\n");
  return `\n## 도메인 정책 힌트 (${domain})\n아래 리스크 관점을 TC 작성 시 참고하세요. 해당되는 기능이 있으면 Test_Steps나 Expected_Result에 반영하세요.\n${lines}\n`;
}

function buildFeatureDrivenPrompt(
  entries: ChecklistWithTestPoints[],
  domain: string,
  config: GeneratorPromptConfig,
  startTcId: number,
  policyHints: PolicyHint[] = [],
): string {
  const policySection = formatPolicyHints(policyHints, domain);
  const baseCap = config.maxTcPerRequirement ?? 2;
  const highCap = config.highRiskMaxTcPerRequirement ?? Math.max(baseCap, 6);
  const hasHigh = entries.some((e) => e.item.specRiskTier === "high");
  const highDetailRules = hasHigh
    ? `
4b. **스펙 리스크: 높음** 항목: Test_Steps는 **4~8단계**로 쪼개고, **Test_Data**에 구체적인 값·상태(금액, 인원, 판매 여부 등)를 명시하세요. Expected_Result는 스펙 불릿을 **번호 목록(1. 2. 3.)**으로 나누어 관찰 가능한 결과를 적으세요(한 줄에 한 가지 검증).
`
    : "";

  return `당신은 시니어 QA 엔지니어입니다. "${domain}" 도메인의 기능별 테스트 포인트를 기반으로 실무용 테스트 케이스를 생성하세요.

## 언어 규칙
- Scenario, Precondition, Test_Steps, Test_Data, Expected_Result, Notes(작성 시) 등 **자연어 필드는 반드시 한국어**로 작성하세요.
- TC_ID, Feature, Requirement_ID, Type, Priority, Severity 등 고정 필드는 영문 규격을 유지합니다.

## 허용 TC Type
${JSON.stringify([...TC_TYPES])}
${policySection}
## 기능별 테스트 포인트
아래 각 기능의 테스트 포인트를 기반으로 TC를 생성하세요.
각 테스트 포인트가 하나의 TC가 됩니다. 포인트의 intent를 반영하여 구체적인 Test_Steps와 Expected_Result를 작성하세요.

${formatTestPointsForPrompt(entries)}
${SHEET_GROUNDING_RULES}
## 규칙
1. 각 테스트 포인트당 **정확히 1건**의 TC를 생성하세요.
2. TC_ID는 "TC-XXXX" 형식이며 TC-${String(startTcId).padStart(4, "0")}부터 시작합니다.
3. Scenario: **Feature 컬럼과 동일한 기능명/경로를 다시 넣지 마세요.** intent만 반복하지 말고, 검증 초점이 **설명(스펙)**의 어떤 내용과 연결되는지 한국어 **한 문장**으로 쓰세요.
4. **설명**에 나온 UI 요소·필드·상태·예외 문구를 Test_Steps에 구체적으로 녹이세요. **스펙 리스크: 일반**은 **2~4단계**, **스펙 리스크: 높음**은 **4~8단계**를 목표로 하세요. **로그인, 메뉴/탭 이동, 단순 화면 진입**은 Test_Steps에 반복하지 말고 **Precondition**에만 두세요.
${highDetailRules}
5. **Precondition**: **짧게**만 씁니다(문장 서술 금지 권장). 역할·계정·초기 화면 상태를 **키워드·슬래시·구분자**로 한 줄에 (~80자내 권장). 예: \`운영자 / 멤버십상품추가 화면\`, \`권한O·데이터 있음\`
6. Expected_Result: 측정 가능한 관찰 결과(화면·데이터·메시지)로 쓰고, 테스트 포인트 intent를 검증 가능하게 구체화하세요. **Scenario와 동일 문장을 복붙하지 마세요.** 나쁜 예: "정상 조회 시 올바른 결과"만 반복 / 좋은 예: 스펙에 적힌 필드명·조건을 Expected에 명시.
7. Priority는 P0/P1/P2, Severity는 S1/S2/S3 중 하나입니다.
8. Environment: "${config.environmentDefault}", Owner: "${config.ownerDefault}", Status: "Draft", Automation_Candidate: "N".
9. Traceability는 "R{sourceRow}" 형식으로 원본 행 번호만 참조하세요.
10. 이미 의미가 같은 시나리오를 표현만 바꿔 중복 생성하지 마세요.
11. **Requirement_ID당 TC 상한**: 스펙 리스크 **일반** 행은 해당 ID당 최대 **${baseCap}**건, **높음** 행이 포함된 Requirement_ID는 최대 **${highCap}**건까지 허용합니다(동일 ID에 높음·일반 행이 섞이면 **${highCap}** 기준).
12. Notes(${TC_KEY_MAP.Notes})는 기본적으로 생략하세요. 특이사항(예: 가정/제약/추가 확인 필요)이 있을 때만 작성하세요.
${buildOmittableCompactKeysSection(config)}
## 출력 형식
토큰 절약을 위해 **축약 키**를 사용하세요.
키 매핑: ${keyMappingTable(TC_KEY_MAP)}

아래 축약 키를 가진 JSON 배열을 반환하세요:
${compactFieldList(TC_KEY_MAP)}

유효한 JSON 배열만 반환하세요. 마크다운 펜스나 설명은 포함하지 마세요.`;
}

function buildLegacyPrompt(
  checklist: ChecklistItem[],
  domain: string,
  resolved: ResolvedSkill,
  config: GeneratorPromptConfig,
  startTcId: number,
): string {
  const baseCap = config.maxTcPerRequirement ?? 2;
  const highCap = config.highRiskMaxTcPerRequirement ?? Math.max(baseCap, 6);
  const hasHigh = checklist.some((c) => c.specRiskTier === "high");
  const checklistJson = checklist.map((c) => ({
    requirementId: c.requirementId,
    feature: c.feature,
    description: c.description,
    featureTypes: c.featureTypes ?? [],
    sourceRow: c.sourceRow,
    sourceSheet: c.sourceSheet,
  }));

  return `당신은 시니어 QA 엔지니어입니다. "${domain}" 도메인에 대한 테스트 케이스를 생성하세요.

## 언어 규칙
- Scenario, Precondition, Test_Steps, Test_Data, Expected_Result, Notes(작성 시) 등 **자연어 필드는 반드시 한국어**로 작성하세요.
- TC_ID, Feature, Requirement_ID, Type, Priority, Severity 등 고정 필드는 영문 규격을 유지합니다.

## 허용 TC Type
${JSON.stringify([...TC_TYPES])}

## 커버해야 할 체크리스트 항목
${JSON.stringify(checklistJson, null, 2)}
${SHEET_GROUNDING_RULES}
## 규칙
1. 위 체크리스트 항목을 **모두** 커버하는 TC를 생성하세요.
2. 각 항목의 featureTypes(기능 유형)를 참고하여 해당 기능에 적합한 테스트 시나리오를 작성하세요.
3. TC_ID는 "TC-XXXX" 형식이며 TC-${String(startTcId).padStart(4, "0")}부터 시작합니다.
4. Scenario: **Feature와 중복되는 기능명 접두어를 붙이지 마세요.** intent만 반복하지 말고, **description(스펙)**과 연결되는 검증 초점을 한국어 한 문장으로 쓰세요.
5. Test_Steps: 실무에서 바로 실행 가능한 구체적 절차. **description**의 UI·필드·상태·예외를 반영하세요. 로그인·메뉴 이동·단순 진입은 Feature로 유추되면 **Precondition**에만 두고 Steps에서 반복하지 마세요.
6. **Precondition**: **짧게**만(키워드·한 줄, ~80자 권장). 문장형 장문 금지. 예: \`크리에이터권한 / 상품추가 화면\`
7. Expected_Result: 화면·데이터·메시지 등 관찰 가능한 결과로 쓰고, **Scenario와 동일 문장 복붙 금지.** 스펙의 필드명·조건을 구체화하세요.
8. Priority는 P0/P1/P2, Severity는 S1/S2/S3 중 하나입니다.
9. Environment: "${config.environmentDefault}", Owner: "${config.ownerDefault}", Status: "Draft", Automation_Candidate: "N".
10. Traceability는 "R{sourceRow}" 형식으로 원본 행 번호만 참조하세요.
11. 한 Requirement_ID에 대해 생성할 TC는 최대 **${baseCap}**건입니다.${
    hasHigh
      ? ` 체크리스트에 **스펙 리스크가 높은** 항목(featureTypes·description 기준)이 있으면, 해당 Requirement_ID는 최대 **${highCap}**건까지 허용합니다.`
      : ""
  }
12. 이미 의미가 같은 시나리오를 표현만 바꿔 중복 생성하지 마세요.
13. Notes(${TC_KEY_MAP.Notes})는 기본적으로 생략하세요. 특이사항이 있는 경우에만 작성하세요.
${buildOmittableCompactKeysSection(config)}
## 출력 형식
토큰 절약을 위해 **축약 키**를 사용하세요.
키 매핑: ${keyMappingTable(TC_KEY_MAP)}

아래 축약 키를 가진 JSON 배열을 반환하세요:
${compactFieldList(TC_KEY_MAP)}

유효한 JSON 배열만 반환하세요. 마크다운 펜스나 설명은 포함하지 마세요.`;
}
