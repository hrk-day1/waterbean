import type { TestCase } from "../../types/tc.js";

export function buildMergePrompt(testCases: TestCase[], domain: string): string {
  const tcJson = testCases.map((tc) => ({
    TC_ID: tc.TC_ID,
    Feature: tc.Feature,
    Requirement_ID: tc.Requirement_ID,
    Scenario: tc.Scenario,
    Precondition: tc.Precondition,
    Test_Steps: tc.Test_Steps,
    Test_Data: tc.Test_Data,
    Expected_Result: tc.Expected_Result,
    Priority: tc.Priority,
    Severity: tc.Severity,
    Type: tc.Type,
    Environment: tc.Environment,
    Owner: tc.Owner,
    Status: tc.Status,
    Automation_Candidate: tc.Automation_Candidate,
    Traceability: tc.Traceability,
    Notes: tc.Notes,
  }));

  return `당신은 시니어 QA 엔지니어입니다. "${domain}" 도메인의 테스트 케이스 목록에서 **의미적으로 동일하거나 거의 동일한 TC**를 병합해 중복을 줄이세요.

## 병합 기준 (보수적 — 오병합 방지)
1. **동일 Type**인 TC끼리만 병합합니다. Type이 다르면 절대 병합하지 마세요.
2. **Scenario의 핵심 의도가 동일**해야 합니다. 세부 데이터·경계값만 다른 경우 병합 대상입니다.
3. 의심스러우면 **병합하지 마세요**. 커버리지 손실보다 약간의 중복이 낫습니다.

## 병합 규칙
- **Requirement_ID**: 원본 TC들의 ID를 쉼표로 합칩니다. 예: "REQ-001, REQ-003"
- **Scenario**: 병합 대상 TC들을 대표하는 한국어 시나리오를 재작성합니다.
- **Priority**: 원본 중 가장 높은 값 유지 (P0 > P1 > P2).
- **Severity**: 원본 중 가장 높은 값 유지 (S1 > S2 > S3).
- **Precondition**: 병합 후에도 **짧게** 유지합니다(역할·화면·상태 키워드 한 줄, ~80자 권장). 장문 서술은 피합니다.
- **Test_Steps / Test_Data / Expected_Result**: 핵심을 통합해 한국어로 재작성합니다.
- **Traceability**: 원본 행 번호를 나열 (쉼표 구분). 예: "R2, R5"
- **Notes**: 병합된 원본 TC_ID 목록을 추가합니다. 예: "MERGED_FROM: TC-0001, TC-0003"
- **Environment, Owner, Status, Automation_Candidate**: 첫 번째 원본 값 유지.
- **Feature**: 동일하면 유지, 다르면 대표 Feature를 선택합니다.

## 병합 불가 TC
병합 대상이 없는 TC는 **모든 필드를 그대로** 출력에 포함하세요. 누락하면 커버리지가 깨집니다.

## 입력 TC 목록
${JSON.stringify(tcJson, null, 2)}

## 출력 형식
위와 동일한 필드 구조의 JSON 배열을 반환하세요. TC_ID는 원본 값 그대로 유지하세요 (호출 측에서 재부여).
유효한 JSON 배열만 반환하세요. 마크다운 펜스나 설명은 포함하지 마세요.`;
}
