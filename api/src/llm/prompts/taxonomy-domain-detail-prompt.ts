import type { SkillManifest } from "../../skills/types.js";
import { TC_TYPES } from "../../types/tc.js";

const KEYWORD_REFILL_SCHEMA_HINT = `{ "keywords": ["새키워드1", "새키워드2", ...] }`;

export function buildKeywordRefillPrompt(
  domainId: string,
  domainOrder: readonly string[],
  currentKeywords: readonly string[],
  excludedKeywords: readonly string[],
  minRequired: number,
  summary?: string,
): string {
  const deficit = minRequired - currentKeywords.length;
  const summaryLine = summary ? `\n이 도메인 설명: ${summary}` : "";

  return `당신은 시니어 QA 아키텍트입니다. 도메인 "${domainId}"의 키워드가 ${currentKeywords.length}개로 최소 ${minRequired}개에 미달합니다. **최소 ${deficit}개 이상**의 새로운 키워드를 추가해 주세요.

## 전체 도메인 순서
${domainOrder.join(" → ")}

## 지금 보정할 도메인
**${domainId}**${summaryLine}

## 현재 보유 키워드
${JSON.stringify(currentKeywords)}

## 사용 금지 키워드 (다른 도메인이 이미 사용 중)
${JSON.stringify(excludedKeywords.slice(0, 80))}

## 규칙
- 위 사용 금지 목록과 동일한 키워드(대소문자/공백 무시)를 절대 넣지 마세요.
- 현재 보유 키워드와 중복되지 않는 새 키워드만 출력하세요.
- 이 도메인에 특화된 구체어를 우선하세요.
- 자연어는 한국어로 작성하세요.

## 출력 형식
유효한 JSON 객체 하나만 반환하세요 (마크다운 펜스 금지):
${KEYWORD_REFILL_SCHEMA_HINT}`;
}

export function buildTaxonomyDomainDetailPrompt(
  headers: string[],
  sampleRows: string[][],
  sourceSheetName: string,
  baseSkill: SkillManifest,
  domainId: string,
  domainOrder: readonly string[],
  summary?: string,
): string {
  const rowsPreview = sampleRows
    .slice(0, 30)
    .map((row, i) => `  행 ${i + 1}: ${JSON.stringify(row)}`)
    .join("\n");

  const orderLine = domainOrder.join(" → ");
  const summaryBlock =
    summary && summary.trim().length > 0
      ? `\n## 이번 도메인 뼈대 설명 (1단계에서 확정)\n${summary.trim()}\n`
      : "";

  return `당신은 시니어 QA 아키텍트입니다. 아래 시트 샘플과 전체 도메인 순서를 참고하여 **단 하나의 도메인**에 대해서만 keywords, minSets(선택), templates를 채우세요.

## 언어 규칙
- keywords, 템플릿의 scenarioSuffix, precondition, steps, expectedResult 등 **자연어는 반드시 한국어**로 작성하세요.

## 베이스 스킬 (참고용 메타)
- id: ${baseSkill.id}
- name: ${baseSkill.name}
- description: ${baseSkill.description}

## 전체 도메인 순서 (맥락용)
${orderLine}

## 지금 채울 도메인 id (반드시 이 값과 동일해야 함)
**${domainId}**
${summaryBlock}
## 시트: "${sourceSheetName}"

### 헤더
${JSON.stringify(headers)}

### 샘플 행 (최대 30건)
${rowsPreview}

## 작업
1. **id** 필드는 반드시 **"${domainId}"** 와 정확히 동일하게 출력하세요.
2. **keywords**: 이 도메인으로 분류할 때 쓸 검색 키워드 (한글·영문 혼용 가능, **1~40개**).
   - 다른 도메인과 **중복되지 않는 키워드만** 넣으세요. 대소문자 차이/앞뒤 공백만 다른 경우도 중복으로 간주합니다.
   - 공통 단어(예: 로그인, 버튼, 화면, 오류)만 단독으로 나열하지 말고, 이 도메인에 특화된 구체어를 우선하세요.
3. **minSets** (선택): TC Type별 최소 개수. 키는 반드시 다음 중에서만: ${JSON.stringify([...TC_TYPES])}. 값은 0~25 정수.
4. **templates**: 이 도메인용 Few-Shot TC 템플릿 **1~12개**. type은 위 TC Type 중 하나.

## 출력 형식
유효한 JSON 객체 하나만 반환하세요 (마크다운 펜스 금지):
{
  "domain": {
    "id": "${domainId}",
    "keywords": ["키워드1"],
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
}`;
}
