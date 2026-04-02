import type { SkillManifest } from "../../skills/types.js";

export function buildTaxonomySkeletonPrompt(
  headers: string[],
  sampleRows: string[][],
  sourceSheetName: string,
  baseSkill: SkillManifest,
): string {
  const rowsPreview = sampleRows
    .slice(0, 30)
    .map((row, i) => `  행 ${i + 1}: ${JSON.stringify(row)}`)
    .join("\n");

  return `당신은 시니어 QA 아키텍트입니다. 아래 스프레드시트 샘플만 보고 **테스트 도메인 분류의 뼈대(식별자와 짧은 범위 설명)**만 설계하세요. 키워드·템플릿·minSets는 이 단계에서 출력하지 마세요 (다음 단계에서 도메인별로 채웁니다).

## 언어 규칙
- summary 등 자연어는 **한국어**로 작성하세요.
- domain id는 영문 slug만 사용합니다.

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
   - 도메인 경계는 최대한 상호 배타적으로 설계하여, 다음 단계 키워드가 도메인 간에 겹치지 않도록 하세요.
2. 각 도메인에 대해:
   - **id**: 영문으로 시작, 이후 영숫자·언더스코어·하이픈만, 최대 32자 (예: UserAuth, Billing, ContentMgmt)
   - **summary** (선택): 이 도메인이 다루는 범위를 **한 줄**로 (200자 이내). 다음 단계에서 템플릿을 쓸 때 힌트로 사용됩니다.

## 출력 형식
유효한 JSON 객체 하나만 반환하세요 (마크다운 펜스 금지):
{
  "domains": [
    { "id": "DomainSlug", "summary": "한 줄 범위 설명 (선택)" }
  ]
}`;
}
