import type { ChecklistItem, SpecRiskTier, TcType } from "../types/tc.js";

export type { SpecRiskTier };

/** 기능명·설명·사전조건을 합쳐 리스크 판별용 문자열을 만든다. */
export function combinedTextForRisk(
  item: Pick<ChecklistItem, "feature" | "description" | "precondition">,
): string {
  const p = item.precondition?.trim() ?? "";
  return `${item.feature} ${item.description} ${p}`.replace(/\s+/g, " ").trim();
}

/**
 * 행이 고위험으로 분류되는지 판별한다.
 * 과탐을 줄이려면 패턴은 보수적으로 유지한다(일반 조회·단순 읽기 전용만 있는 행은 제외).
 */
const HIGH_TIER_PATTERNS: readonly RegExp[] = [
  /거래\s*내역|구매\s*내역|판매\s*(된|수|이력)|이미\s*판매/i,
  /VAT|부가세|과세|판매가|공급가|가격\s*정보|금액\s*정보|\b0\s*원|0원/i,
  /환불|PG|웹훅|멱등|payment\s*intent/i,
  /가입\s*인원|인원\s*제한|제한\s*필요\s*명수|제한\s*명수|제한\s*명\b/i,
  /가격.*변경\s*불가|변경\s*불가.*가격|구성.*변경|거래\s*기록/i,
  /리워드|D&D|드래그\s*앤\s*드롭|드래그\s*앤\s*drop|항목\s*별로\s*리워드/i,
];

export function inferSpecRiskTier(combinedText: string): SpecRiskTier {
  if (!combinedText.trim()) return "standard";
  for (const re of HIGH_TIER_PATTERNS) {
    if (re.test(combinedText)) return "high";
  }
  return "standard";
}

export interface HighRiskExtraTemplate {
  pointType: string;
  intent: string;
  suggestedTcType: TcType;
  required: boolean;
}

interface ExtraRule {
  pattern: RegExp;
  templates: readonly HighRiskExtraTemplate[];
}

/** 고위험 행에만 추가되며, 패턴이 스펙 본문과 맞을 때만 삽입한다. */
const EXTRA_RULES: readonly ExtraRule[] = [
  {
    pattern: /거래\s*내역|판매\s*(된|수)|구매\s*내역|이미\s*판매|거래\s*기록/i,
    templates: [
      {
        pointType: "거래이력제약",
        intent:
          "거래·판매 이력이 있는 경우 스펙에 따른 필드 비활성·저장 차단·안내 문구가 적용된다",
        suggestedTcType: "Negative",
        required: true,
      },
    ],
  },
  {
    pattern: /VAT|부가세|공급가|판매가|과세|0\s*원\s*입력|0원\s*입력|0원.*불가/i,
    templates: [
      {
        pointType: "금액과세검증",
        intent: "스펙의 금액·과세·0원 불가 등 규칙이 입력·저장·표시에 반영된다",
        suggestedTcType: "Boundary",
        required: false,
      },
    ],
  },
  {
    pattern: /가입\s*인원|인원\s*제한|제한\s*필요\s*명수|제한\s*명수|이미\s*판매\s*된\s*개수|판매\s*된\s*개수/i,
    templates: [
      {
        pointType: "인원제한하한",
        intent: "가입 인원 제한 값이 스펙(판매 수 대비 하한 등)에 맞게 검증된다",
        suggestedTcType: "Negative",
        required: false,
      },
    ],
  },
  {
    pattern: /리워드|D&D|드래그\s*앤|순서\s*변경/i,
    templates: [
      {
        pointType: "리워드순서",
        intent: "리워드 항목 추가·순서 변경(D&D)이 스펙대로 동작하고 저장 시 반영된다",
        suggestedTcType: "Functional",
        required: false,
      },
    ],
  },
];

const MAX_EXTRA_TEMPLATES = 4;

export function deriveHighRiskExtraTemplates(combinedText: string): HighRiskExtraTemplate[] {
  const out: HighRiskExtraTemplate[] = [];
  const seen = new Set<string>();
  for (const rule of EXTRA_RULES) {
    if (!rule.pattern.test(combinedText)) continue;
    for (const t of rule.templates) {
      const key = `${t.pointType}|${t.suggestedTcType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
      if (out.length >= MAX_EXTRA_TEMPLATES) return out;
    }
  }
  return out;
}

export function enrichChecklistWithSpecRisk(items: ChecklistItem[]): ChecklistItem[] {
  return items.map((item) => ({
    ...item,
    specRiskTier: inferSpecRiskTier(combinedTextForRisk(item)),
  }));
}
