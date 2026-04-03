import type { EvaluationIssue } from "../../types/pipeline.js";
import type { ResolvedSkill } from "../../skills/resolved-skill.js";

export function buildTaxonomyEvalPrompt(
  resolved: ResolvedSkill,
  headers: string[],
  sampleRows: string[][],
  ruleIssues: EvaluationIssue[],
): string {
  const domainSummary = resolved.domainOrder
    .map((d) => {
      const kw = resolved.domainKeywords[d] ?? [];
      const tpl = resolved.templates[d] ?? [];
      const mins = resolved.domainMinSets[d] ?? {};
      return `  - ${d}: 키워드 ${kw.length}개 [${kw.slice(0, 5).join(", ")}${kw.length > 5 ? "..." : ""}], 템플릿 ${tpl.length}개, minSets=${JSON.stringify(mins)}`;
    })
    .join("\n");

  const rowsPreview = sampleRows
    .slice(0, 15)
    .map((row, i) => `  행 ${i + 1}: ${JSON.stringify(row)}`)
    .join("\n");

  const existingIssues =
    ruleIssues.length > 0
      ? ruleIssues.map((i) => `  - [${i.type}] ${i.message}`).join("\n")
      : "  (규칙 검증 이슈 없음)";

  return `당신은 시니어 QA 아키텍트입니다. Taxonomy(도메인 분류 체계) 결과를 원본 데이터와 비교하여 품질을 평가하세요.

## 원본 시트 헤더
${JSON.stringify(headers)}

## 원본 시트 샘플 (최대 15행)
${rowsPreview}

## Taxonomy 결과 (${resolved.domainOrder.length}개 도메인)
${domainSummary}

## 규칙 기반 검증에서 발견된 이슈
${existingIssues}

## 평가 기준
1. **도메인 적절성**: 원본 데이터의 기능/요구사항이 도메인 분류에 잘 매핑되는가?
2. **누락 도메인**: 원본 데이터에 있지만 어떤 도메인에도 포함되지 않는 기능 영역이 있는가?
3. **키워드 매칭**: 각 도메인의 키워드가 실제 원본 데이터와 매칭될 수 있는가?
4. **도메인 과잉**: 불필요하게 세분화되었거나 병합해야 할 도메인이 있는가?

## 출력 형식
유효한 JSON 객체 하나만 반환하세요 (마크다운 펜스 금지):
{
  "passed": true/false,
  "issues": [
    {
      "type": "taxonomy_llm",
      "message": "이슈 설명 (한국어)",
      "severity": "error" | "warning"
    }
  ],
  "suggestions": ["개선 제안 한 줄", "또 다른 제안"]
}

- **suggestions**는 **문자열 배열만** 허용. 각 원소는 한 줄 이상 가능한 평문 문자열.
- **금지**: 단일 긴 문자열 하나만 넣기(\`"suggestions": "문단..."\`). **금지**: \`[{"suggestion":"..."}]\` 형태의 객체 배열.
- passed가 false인 경우: 도메인 재생성이 필요한 심각한 문제가 있을 때만
- severity가 "warning"인 이슈는 passed를 false로 만들지 않습니다
- issues와 suggestions는 한국어로 작성하세요`;
}
