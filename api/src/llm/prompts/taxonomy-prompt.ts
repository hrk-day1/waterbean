import type { SkillManifest } from "../../skills/types.js";
import { TC_TYPES } from "../../types/tc.js";

export function buildTaxonomyPrompt(
  headers: string[],
  sampleRows: string[][],
  sourceSheetName: string,
  baseSkill: SkillManifest,
): string {

  const rowsPreview = sampleRows
    .slice(0, 30)
    .map((row, i) => `  행 ${i + 1}: ${JSON.stringify(row)}`)
    .join("\n");

  return `당신은 시니어 QA 아키텍트입니다. 아래 스프레드시트 샘플을 분석하여 **이 제품/문서에 맞는 테스트 도메인 분류 체계(Taxonomy)**를 설계하세요.

## 언어 규칙
- keywords, 템플릿의 scenarioSuffix, precondition, steps, expectedResult 등 **자연어는 반드시 한국어**로 작성하세요.
- domain id는 영문 slug만 사용합니다 (아래 형식).

## 베이스 스킬 (참고용 메타)
- id: ${baseSkill.id}
- name: ${baseSkill.name}
- description: ${baseSkill.description}

## 시트: "${sourceSheetName}"

### 헤더
${JSON.stringify(headers)}

### 샘플 행 (최대 30건)
${rowsPreview}

## 작업
1. 기능·요구사항을 **3~12개**의 논리적 도메인으로 나눕니다 (너무 촘촘하거나 한두 개로 뭉치지 마세요).
2. 각 도메인에 대해:
   - **id**: 영문으로 시작, 이후 영숫자·언더스코어·하이픈만, 최대 32자 (예: UserAuth, Billing, ContentMgmt)
   - **keywords**: 해당 도메인으로 분류할 때 쓸 검색 키워드 (한글·영문 혼용 가능, 1~40개)
   - **minSets**: TC Type별 최소 개수 (객체). 키는 반드시 다음 중에서만: ${JSON.stringify([...TC_TYPES])}. 값은 0~25 정수. 생략 가능한 타입은 0으로 두어도 됩니다.
   - **templates**: 해당 도메인용 Few-Shot TC 템플릿 **1~12개**. type은 위 TC Type 중 하나. 시나리오·단계·기대결과는 한국어.

## 출력 형식
유효한 JSON 객체 하나만 반환하세요 (마크다운 펜스 금지):
{
  "domains": [
    {
      "id": "DomainSlug",
      "keywords": ["키워드1", "keyword2"],
      "minSets": { "Functional": 2, "Negative": 1 },
      "templates": [
        {
          "type": "Functional",
          "scenarioSuffix": "...",
          "precondition": "...",
          "steps": "...",
          "expectedResult": "..."
        }
      ]
    }
  ]
}`;
}
