import type { ResolvedSkill } from "../../skills/resolved-skill.js";
import type { TcSourceFieldRow } from "../../pipeline/plan.js";
import { FEATURE_TYPES } from "../../types/tc.js";
import { PLAN_KEY_MAP, keyMappingTable } from "../key-mapping.js";

/**
 * 청크마다 동일하게 붙는 공통 프롬프트(규칙·도메인·출력 스키마).
 * LLM plan 병렬 청크 호출 시 1회만 생성해 재사용한다.
 */
export function buildPlanPromptPrefix(resolved: ResolvedSkill): string {
  const domainKeywordsSection = resolved.domainOrder
    .map((d) => `  - ${d}: ${(resolved.domainKeywords[d] ?? []).join(", ")}`)
    .join("\n");

  return `당신은 시니어 QA 분석가입니다. 스프레드시트 데이터를 분석해 구조화된 체크리스트를 작성하세요.

## 언어 규칙
- description, feature 등 자연어는 **한국어**. 필드 축약 키·domain 값은 지시에 따름.
- featureTypes는 아래 허용 목록의 한국어 값만 사용.

## 작업
1. **입력은 이미 아래 필드만 추출된 값입니다:** 대분류, 중분류, 소분류, 기능명, 기능설명. (비고·의견·확인필요·담당자 등 다른 열은 포함되지 않음) **중분류·소분류 열이 원본 시트에 없으면 빈 문자열로 옵니다.**
2. 행마다 도메인 분류 후 ChecklistItem 생성.
3. 분류·기능명은 ">" 로 feature에 합침 (예: "대분류 > 기능명" 또는 "대분류 > 중분류 > 소분류 > 기능명"). **빈 분류는 생략.**
4. **description**은 **기능설명** 필드만 사용. 다른 텍스트를 임의로 추가하지 않음.
5. 요구사항 ID 열이 이번 입력에 없음 → requirementId는 항상 "AUTO-{행번호}".
6. featureTypes는 의미에 맞게 1개 이상(복수 가능).
7. **precondition은 비움(생략).** 이 프롬프트에는 사전조건 열이 없음.
8. categoryPath는 대분류 > 중분류 > 소분류 중 **값이 있는 것만** 이어 붙임(중·소 열이 없거나 비어 있으면 생략).

## 기능 유형 (featureTypes)
허용: ${JSON.stringify([...FEATURE_TYPES])}
기준: 조회=목록·상세·검색·필터 | 등록=추가·작성 | 수정=편집 | 삭제=제거·해지 | 상태전이=공개/활성 등 전환 | 승인반려 | 권한제어 | 파일처리 | 결제금액 | 스케줄배치 | 외부연동

## 도메인 키워드
${domainKeywordsSection}
미매칭 시 "${resolved.fallbackDomain}".

아래 "데이터 행" 블록은 **이번 요청 배치에 해당하는 행만** 포함합니다. 해당 행만 JSON 배열로 출력하세요.
`;
}

export function buildPlanPromptChunkBody(
  sourceSheetName: string,
  rows: { sourceRow: number; fields: TcSourceFieldRow }[],
): string {
  const rowsPreview = rows
    .map((r) => `  행 ${r.sourceRow}: ${JSON.stringify(r.fields)}`)
    .join("\n");

  return `## 시트: "${sourceSheetName}"
### 데이터 행 (TC 소스 필드만: 대분류, 중분류, 소분류, 기능명, 기능설명)
${rowsPreview}
`;
}

export function buildPlanPromptSuffix(
  resolved: ResolvedSkill,
  sourceSheetName: string,
): string {
  return `## 출력 형식
축약 키 사용. 매핑: ${keyMappingTable(PLAN_KEY_MAP)}
- ${PLAN_KEY_MAP.id}: "CL-XXXX"
- ${PLAN_KEY_MAP.requirementId}: string
- ${PLAN_KEY_MAP.feature}: string (한국어)
- ${PLAN_KEY_MAP.domain}: ${JSON.stringify([...resolved.domainOrder])} 중 하나
- ${PLAN_KEY_MAP.description}: **반드시 하나의 문자열**. 여러 줄 설명은 \\n으로 이어 붙임. **JSON 배열 금지**(잘못된 예: ["줄1","줄2"])
- ${PLAN_KEY_MAP.sourceRow}: 위 "행 N:" 번호 그대로
- ${PLAN_KEY_MAP.sourceSheet}: "${sourceSheetName}"
- ${PLAN_KEY_MAP.covered}: false
- ${PLAN_KEY_MAP.featureTypes}: optional, **반드시 문자열 배열** (예: ["조회"]). 단일 문자열 "조회"만 쓰지 말 것
- ${PLAN_KEY_MAP.precondition}: 생략(이 입력에는 사전조건 없음)
- ${PLAN_KEY_MAP.categoryPath}: optional

유효한 JSON 배열만. 마크다운 펜스·설명 금지.`;
}

export function buildPlanPrompt(
  sourceSheetName: string,
  resolved: ResolvedSkill,
  rows: { sourceRow: number; fields: TcSourceFieldRow }[],
): string {
  return (
    buildPlanPromptPrefix(resolved)
    + buildPlanPromptChunkBody(sourceSheetName, rows)
    + buildPlanPromptSuffix(resolved, sourceSheetName)
  );
}
