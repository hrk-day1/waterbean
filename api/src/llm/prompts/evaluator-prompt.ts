import type { ChecklistItem, TestCase } from "../../types/tc.js";
import type { EvaluationIssue } from "../../types/pipeline.js";
import type { ResolvedSkill } from "../../skills/resolved-skill.js";
import { TC_TYPES } from "../../types/tc.js";
import { deriveTestPoints } from "../../pipeline/test-points.js";
import { TC_KEY_MAP, keyMappingTable, compactFieldList } from "../key-mapping.js";

export function buildRepairPrompt(
  issues: EvaluationIssue[],
  uncoveredItems: ChecklistItem[],
  existingTcs: TestCase[],
  resolved: ResolvedSkill,
  config: { ownerDefault: string; environmentDefault: string },
  nextTcId: number,
): string {
  const issuesSummary = issues
    .slice(0, 30)
    .map((i) => `  - [${i.type}] ${i.message}`)
    .join("\n");

  const missingPointIssues = issues.filter((i) => i.type === "test_point_missing");

  const uncoveredWithPoints = uncoveredItems.slice(0, 20).map((c) => {
    const points = deriveTestPoints(c, true);
    return {
      requirementId: c.requirementId,
      feature: c.feature,
      domain: c.domain,
      description: c.description,
      featureTypes: c.featureTypes ?? [],
      precondition: c.precondition ?? "",
      sourceRow: c.sourceRow,
      sourceSheet: c.sourceSheet,
      missingTestPoints: points.map((p) => ({
        pointType: p.pointType,
        intent: p.intent,
        suggestedTcType: p.suggestedTcType,
      })),
    };
  });

  const tcSample = existingTcs.slice(0, 5).map((tc) => ({
    TC_ID: tc.TC_ID,
    Feature: tc.Feature,
    Type: tc.Type,
    Priority: tc.Priority,
    Severity: tc.Severity,
  }));

  const missingPointsSummary = missingPointIssues.length > 0
    ? `\n## 누락된 필수 테스트 포인트 (${missingPointIssues.length}건)\n${missingPointIssues.slice(0, 20).map((i) => `  - ${i.message}`).join("\n")}`
    : "";

  return `당신은 시니어 QA 엔지니어입니다. 아래 평가 결과를 바탕으로 빠진 테스트 관점을 보완하세요.

## 언어 규칙
- Scenario, Precondition, Test_Steps, Test_Data, Expected_Result, Notes(작성 시), repairNotes 등 **자연어 필드는 반드시 한국어**로 작성하세요.
- TC_ID, Feature, Requirement_ID, Type, Priority, Severity 등 고정 필드는 영문 규격을 유지합니다.

## 발견된 평가 이슈
${issuesSummary}
${missingPointsSummary}

## 미커버 체크리스트 항목 (누락 테스트 포인트 포함)
${JSON.stringify(uncoveredWithPoints, null, 2)}

## 기존 TC 샘플 (스타일 참고용)
${JSON.stringify(tcSample, null, 2)}

## 허용 값
- Type: ${JSON.stringify([...TC_TYPES])}
- Priority: ["P0", "P1", "P2"]
- Severity: ["S1", "S2", "S3"]

## 작업
1. 미커버 체크리스트 항목의 **누락된 테스트 포인트**를 각각 커버하는 새 TC를 생성하세요.
2. 각 테스트 포인트의 intent를 반영하여 구체적인 Test_Steps와 Expected_Result를 작성하세요.
3. 기능의 featureTypes와 precondition을 참고하여 실무에서 바로 실행 가능한 TC를 만드세요. **Precondition**은 짧은 전제 키워드만(한 줄·~80자 권장, 장문 서술 금지).
4. TC_ID 형식: "TC-XXXX", TC-${String(nextTcId).padStart(4, "0")}부터 시작합니다.
5. Environment: "${config.environmentDefault}", Owner: "${config.ownerDefault}", Status: "Draft", Automation_Candidate: "N".
6. Traceability: "R{sourceRow}".
7. Notes(${TC_KEY_MAP.Notes})는 특이사항이 있을 때만 작성하고, 없으면 생략하세요.

## 출력 시 생략 가능한 축약 키 (completion 토큰 절약)
- **f(Feature), ev(Environment), ow(Owner)** 는 ntc 항목에서 **생략 가능**합니다. 서버가 체크리스트 **tr·ri** 및 기본값(Environment "${config.environmentDefault}", Owner "${config.ownerDefault}")으로 채웁니다.
- **tr(Traceability)는 반드시 포함**하세요. f 생략 시 tr로 Feature를 복원합니다.
- **st, ac** 생략 시 서버가 Draft / N.
- **ti(TC_ID)는 반드시 포함**하세요.

## 출력 형식
토큰 절약을 위해 **축약 키**를 사용하세요.
키 매핑: ${keyMappingTable(TC_KEY_MAP)}

아래 형식의 JSON 객체를 반환하세요:
{
  "ntc": [ ... 축약 키를 사용한 TestCase 객체 배열 ... ],
  "rn": "수정 내용 요약 (한국어)"
}

TC 축약 키: ${compactFieldList(TC_KEY_MAP)}

유효한 JSON만 반환하세요. 마크다운 펜스나 설명은 포함하지 마세요.`;
}
