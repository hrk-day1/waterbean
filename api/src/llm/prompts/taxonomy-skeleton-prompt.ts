import type { SkillManifest } from "../../skills/types.js";
import type { ResolvedSkill } from "../../skills/resolved-skill.js";
import { TC_TYPES } from "../../types/tc.js";

export function buildHybridTaxonomyPrompt(
  presetResolved: ResolvedSkill,
  unclassifiedRows: string[][],
  headers: string[],
  sourceSheetName: string,
): string {
  const existingDomains = presetResolved.domainOrder
    .map((d) => {
      const kw = presetResolved.domainKeywords[d] ?? [];
      return `  - ${d}: [${kw.slice(0, 8).join(", ")}${kw.length > 8 ? "..." : ""}]`;
    })
    .join("\n");

  const rowsPreview = unclassifiedRows
    .slice(0, 30)
    .map((row, i) => `  행 ${i + 1}: ${JSON.stringify(row)}`)
    .join("\n");

  return `당신은 시니어 QA 아키텍트입니다. 기존 도메인 분류 체계가 있지만 아래 행들은 어떤 도메인에도 매칭되지 않았습니다. 이 미분류 행들을 처리하세요.

## 언어 규칙
- summary, keywords, 템플릿의 자연어는 **한국어**로 작성하세요.
- domain id는 영문 slug만 사용합니다.

## 시트: "${sourceSheetName}"

### 헤더
${JSON.stringify(headers)}

## 기존 도메인과 키워드
${existingDomains}

## 미분류 행 (${unclassifiedRows.length}건)
${rowsPreview}

## 작업
1. 각 미분류 행을 분석하여, **기존 도메인 중 하나에 매핑 가능한지** 먼저 판단하세요.
   - 매핑 가능하면 해당 도메인에 추가할 키워드를 제안하세요.
2. 기존 도메인에 매핑이 불가한 행이 있으면, **새 도메인을 생성**하세요.
   - 새 도메인 id는 기존 도메인 id와 겹치면 안 됩니다.
   - 새 도메인에는 keywords, minSets를 함께 제공하세요.
   - templates는 선택사항입니다. 제공하면 정책 힌트로 활용됩니다.
3. 새 도메인은 최소 3건 이상의 행이 연관될 때만 생성하세요. 1~2건이면 가장 유사한 기존 도메인에 매핑하세요.

## 출력 형식
유효한 JSON 객체 하나만 반환하세요 (마크다운 펜스 금지):
{
  "reclassified": [
    { "rowIndex": 0, "domain": "기존도메인ID", "suggestedKeywords": ["추가키워드1"] }
  ],
  "newDomains": [
    {
      "id": "NewDomainSlug",
      "summary": "한 줄 범위 설명",
      "keywords": ["키워드1"],
      "minSets": { "Functional": 2, "Negative": 1 }
    }
  ]
}

- reclassified: 기존 도메인으로 재매핑한 항목. rowIndex는 위 미분류 행 목록의 0-based 인덱스.
- newDomains: 새로 생성이 필요한 도메인. 없으면 빈 배열.
- templates의 type은 반드시 다음 중 하나: ${JSON.stringify([...TC_TYPES])}`;
}

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
