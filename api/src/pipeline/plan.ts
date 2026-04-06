import type { ChecklistItem, FeatureType } from "../types/tc.js";
import { enrichChecklistWithSpecRisk } from "./spec-risk.js";
import { FEATURE_TYPES } from "../types/tc.js";
import type { ResolvedSkill } from "../skills/resolved-skill.js";


/**
 * 시트 헤더 셀을 컬럼 매칭용으로 정규화한다.
 * (NBSP·전각 공백·연속 공백·호환 문자 등으로 같은 의미의 헤더가 달라 보이는 경우)
 */
export function normalizeSheetHeaderCell(raw: string): string {
  const unifiedSpaces = raw
    .normalize("NFKC")
    .replace(/[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return unifiedSpaces.toLowerCase();
}

/** 기능 목록 시트에서 TC 소스로 인정하는 열(헤더 정규화 후 매칭). */
const FEATURE_LIST_HEADER: Record<string, RegExp> = {
  category1: /^대\s*분\s*류$/,
  category2: /^중\s*분\s*류$/,
  category3: /^소\s*분\s*류$/,
  feature: /^(기능\s*명|기능명|feature|module|menu|메뉴|모듈|서비스)$/i,
  /** 일반 '설명' 단독은 제외 — 의견/비고 열 오인식 방지 */
  featureDescription: /^(기능\s*설\s*명|기능설명|기능\s*개\s*요|기능\s*내\s*용)$/,
};

const REQ_ID_HEADER =
  /^(requirement[\s_]*id|req[\s_]*id|ticket|요구\s*사항\s*id|요건\s*번\s*호|요구\s*사항\s*번\s*호|번\s*호|id)$/i;

/** 명시적 사전조건만 — 다른 열을 precondition으로 쓰지 않음 */
const PRECONDITION_HEADER = /^(precondition|given|사전\s*조건|전\s*제)$/;

/** 헤더 행 탐지용(요구사항 ID·사전조건 등 부가 열 포함) */
const HEADER_ROW_SIGNAL_PATTERNS: RegExp[] = [
  ...Object.values(FEATURE_LIST_HEADER),
  REQ_ID_HEADER,
  PRECONDITION_HEADER,
  /^시나\s*리\s*오$/,
  /^id$/i,
];

/** 읽기 전용·수정 불가 문구가 있으면 쓰기 유형(등록/수정/삭제/파일처리)을 infer에서 제거한다. */
const READONLY_HINT =
  /수정\s*불가|수정\s*가능\s*항목\s*없음|수정\s*가능\s*없음|수정\s*항목\s*없음|읽기\s*전용|조회\s*전용|편집\s*불가|열람\s*전용|조회만\s*가능/i;

function normalizeTextForReadonlyCheck(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * 기능명·기능설명에 읽기 전용·수정 불가 힌트가 있으면 true.
 * `inferFeatureTypes`와 동일한 `READONLY_HINT`를 사용한다(테스트 포인트 필터 등).
 */
export function isReadOnlyFeatureSpec(feature: string, description: string): boolean {
  return READONLY_HINT.test(normalizeTextForReadonlyCheck(`${feature} ${description}`));
}

const WRITE_FEATURE_TYPES: ReadonlySet<FeatureType> = new Set([
  "등록",
  "수정",
  "삭제",
  "파일처리",
]);

/** 구독/결제 해지 등 — 레코드 삭제 TC로 가지 않게 삭제 키워드에서 제외, 상태전이로 흡수 */
const CANCEL_HIRE_CONTEXT = /갱신\s*해지|구독\s*해지|결제\s*해지|멤버십\s*해지|해지\s*처리|해지\s*버튼|해지\s*확인/i;

const FEATURE_TYPE_KEYWORDS: ReadonlyMap<FeatureType, RegExp> = new Map<FeatureType, RegExp>([
  ["조회", /조회|검색|목록|리스트|상세|보기|view|list|search|detail|select|필터|정렬/i],
  ["등록", /등록|생성|추가|작성|신규|create|add|insert|new|write/i],
  ["수정", /수정|변경|편집|업데이트|갱신|update|edit|modify|change/i],
  ["삭제", /삭제|제거|취소등록|remove|delete|drop/i],
  [
    "상태전이",
    /상태\s*변경|상태\s*전이|전환|활성화|비활성|공개|비공개|예약|노출|숨김|승인.*취소|취소.*환불|구독\s*해지|갱신\s*해지|결제\s*해지|멤버십\s*해지|해지\s*처리|해지\s*버튼|해지\s*확인/i,
  ],
  ["승인반려", /승인|반려|거절|심사|검수|요청.*처리|approve|reject|review/i],
  ["권한제어", /권한|역할|role|permission|접근\s*제어|읽기전용|관리자|운영자/i],
  ["파일처리", /파일|업로드|다운로드|첨부|이미지|미디어|썸네일|upload|download|attach/i],
  ["결제금액", /결제|환불|정산|과금|금액|가격|billing|pay|refund|price|invoice/i],
  ["스케줄배치", /스케줄|예약\s*발송|배치|cron|자동\s*실행|정기|반복|schedule|batch/i],
  ["외부연동", /연동|api\s*호출|webhook|외부|third.?party|sso|oauth|pg|알림\s*발송/i],
]);

const FEATURE_TYPE_SET = new Set<string>(FEATURE_TYPES);

export type PaymentPointMode = "display" | "transaction";

/**
 * 결제 관련 기능에 대해 테스트 포인트를 PG/실결제(transaction) vs 화면 표시(display) 중 어디에 둘지 판별한다.
 */
export function inferPaymentPointMode(text: string): PaymentPointMode {
  const t = text;
  const transactionSignals =
    /PG|웹훅|멱등|결제\s*승인|결제\s*수단|카드\s*결제|포트원|토스페이먼츠|\b토스\b|잔액\s*부족|결제\s*취소|결제\s*실패|환불\s*요청|payment\s*intent|capture/i.test(
      t,
    );
  if (transactionSignals) return "transaction";

  const displaySignals =
    /결제\s*정보|기본\s*정보|상세\s*페이지|상세\s*화면|결제\s*상품\s*상세|청구|영수증|표시\s*영역|조회\s*중심|정보\s*영역/i.test(
      t,
    );
  if (displaySignals) return "display";

  return "transaction";
}

export function inferFeatureTypes(text: string): FeatureType[] {
  const matched: FeatureType[] = [];
  for (const [ft, re] of FEATURE_TYPE_KEYWORDS) {
    if (re.test(text)) matched.push(ft);
  }

  let result: FeatureType[] = matched.length > 0 ? matched : ["조회"];

  if (isReadOnlyFeatureSpec("", text)) {
    result = result.filter((ft) => !WRITE_FEATURE_TYPES.has(ft));
    if (result.length === 0) result = ["조회"];
  }

  if (CANCEL_HIRE_CONTEXT.test(text)) {
    result = result.filter((ft) => ft !== "수정");
    if (result.length === 0) result = ["조회"];
  }

  return result;
}

export function isValidFeatureType(value: string): value is FeatureType {
  return FEATURE_TYPE_SET.has(value);
}

export function buildKeywordPatterns(
  resolved: ResolvedSkill,
): Map<string, RegExp> {
  const map = new Map<string, RegExp>();
  for (const domain of resolved.domainOrder) {
    const words = resolved.domainKeywords[domain];
    if (words?.length) {
      map.set(domain, new RegExp(words.join("|"), "i"));
    }
  }
  return map;
}

export function tryInferDomain(
  text: string,
  patterns: Map<string, RegExp>,
  resolved: ResolvedSkill,
): string | null {
  for (const domain of resolved.domainOrder) {
    const re = patterns.get(domain);
    if (re?.test(text)) return domain;
  }
  return null;
}

function inferDomain(
  text: string,
  patterns: Map<string, RegExp>,
  resolved: ResolvedSkill,
): string {
  return tryInferDomain(text, patterns, resolved) ?? resolved.fallbackDomain;
}

function findColumnIndex(headers: string[], pattern: RegExp): number {
  return headers.findIndex((h) => pattern.test(normalizeSheetHeaderCell(h ?? "")));
}

function isHeaderRow(row: string[]): boolean {
  if (!row || row.length < 2) return false;
  const filled = row.filter((c) => c?.trim());
  /** 중·소분류 없이 대분류+기능명+기능설명(3열) 또는 기능명+기능설명(2열)만 있는 시트도 허용 */
  if (filled.length < 2) return false;

  let matches = 0;
  for (const pattern of HEADER_ROW_SIGNAL_PATTERNS) {
    if (row.some((c) => pattern.test(normalizeSheetHeaderCell(c ?? "")))) matches++;
  }
  return matches >= 2;
}

/** strict 매칭 실패 시 보조(표기 변형 대응) */
function looseResolveFeatureColumns(headers: string[]): {
  cat1: number;
  cat2: number;
  cat3: number;
  feature: number;
  featureDesc: number;
} {
  const norm = (h: string) => normalizeSheetHeaderCell(h ?? "");

  const cat1 = headers.findIndex((h) => norm(h) === "대분류" || /^대\s*분류$/.test(norm(h)));
  const cat2 = headers.findIndex((h) => norm(h) === "중분류" || /^중\s*분류$/.test(norm(h)));
  const cat3 = headers.findIndex((h) => norm(h) === "소분류" || /^소\s*분류$/.test(norm(h)));

  let feature = -1;
  for (let i = 0; i < headers.length; i++) {
    const t = norm(headers[i]!);
    if (!t) continue;
    if (/기능/.test(t) && /명/.test(t) && !/설명/.test(t)) {
      feature = i;
      break;
    }
  }

  let featureDesc = -1;
  for (let i = 0; i < headers.length; i++) {
    const t = norm(headers[i]!);
    if (!t) continue;
    if ((/기능/.test(t) && /설명/.test(t)) || t === "description") {
      featureDesc = i;
      break;
    }
  }

  return { cat1, cat2, cat3, feature, featureDesc };
}

export interface SourceSheetColumnIndices {
  cat1: number;
  cat2: number;
  cat3: number;
  feature: number;
  featureDesc: number;
  reqId: number;
  precondition: number;
}

/**
 * 헤더 행을 분석해 TC 입력에 사용할 열 인덱스를 구한다.
 * TC 소스는 기능명·기능설명(및 있으면 대분류)이며, **중분류·소분류 열이 없으면 cat2/cat3는 -1**로 두고 빈 값으로 처리한다.
 * 그 외 열은 매핑하지 않는다.
 */
export function resolveSourceSheetColumns(headers: string[]): SourceSheetColumnIndices {
  let cat1 = findColumnIndex(headers, FEATURE_LIST_HEADER.category1);
  let cat2 = findColumnIndex(headers, FEATURE_LIST_HEADER.category2);
  let cat3 = findColumnIndex(headers, FEATURE_LIST_HEADER.category3);
  let feature = findColumnIndex(headers, FEATURE_LIST_HEADER.feature);
  let featureDesc = findColumnIndex(headers, FEATURE_LIST_HEADER.featureDescription);

  if (feature < 0 || featureDesc < 0) {
    const loose = looseResolveFeatureColumns(headers);
    if (feature < 0 && loose.feature >= 0) feature = loose.feature;
    if (featureDesc < 0 && loose.featureDesc >= 0) featureDesc = loose.featureDesc;
    if (cat1 < 0 && loose.cat1 >= 0) cat1 = loose.cat1;
    if (cat2 < 0 && loose.cat2 >= 0) cat2 = loose.cat2;
    if (cat3 < 0 && loose.cat3 >= 0) cat3 = loose.cat3;
  }

  return {
    cat1,
    cat2,
    cat3,
    feature,
    featureDesc,
    reqId: findColumnIndex(headers, REQ_ID_HEADER),
    precondition: findColumnIndex(headers, PRECONDITION_HEADER),
  };
}

const TC_SOURCE_LABELS = ["대분류", "중분류", "소분류", "기능명", "기능설명"] as const;

export type TcSourceFieldRow = Record<(typeof TC_SOURCE_LABELS)[number], string>;

/** checklist / LLM plan에 넘길 필드만 추출한다. 중·소분류 열이 없으면 해당 키는 빈 문자열. */
export function projectRowToTcSourceFields(
  row: string[],
  idx: Pick<SourceSheetColumnIndices, "cat1" | "cat2" | "cat3" | "feature" | "featureDesc">,
): TcSourceFieldRow {
  const pick = (i: number) => (i >= 0 ? (row[i]?.trim() ?? "") : "");
  return {
    대분류: pick(idx.cat1),
    중분류: pick(idx.cat2),
    소분류: pick(idx.cat3),
    기능명: pick(idx.feature),
    기능설명: pick(idx.featureDesc),
  };
}

function isSectionDivider(row: string[]): boolean {
  const filled = row.filter((c) => c?.trim());
  if (filled.length > 2) return false;
  const text = filled.join(" ");
  return /^\d+\.\s/.test(text) || /^[A-Z]{2,}/.test(text);
}

interface SheetParseResult {
  headers: string[];
  dataRows: string[][];
  headerRowIndex: number;
}

export function detectHeaderAndData(allRows: string[][]): SheetParseResult {
  for (let i = 0; i < Math.min(allRows.length, 10); i++) {
    if (isHeaderRow(allRows[i])) {
      return {
        headers: allRows[i].map((h) => h?.trim() ?? ""),
        dataRows: allRows.slice(i + 1),
        headerRowIndex: i,
      };
    }
  }

  return {
    headers: allRows[0]?.map((h) => h?.trim() ?? "") ?? [],
    dataRows: allRows.slice(1),
    headerRowIndex: 0,
  };
}

function buildFeatureName(
  row: string[],
  indices: { cat1: number; cat2: number; cat3: number; feature: number },
): string {
  const pick = (idx: number) => (idx >= 0 ? (row[idx]?.trim() ?? "") : "");
  const seq = [
    pick(indices.cat1),
    pick(indices.cat2),
    pick(indices.cat3),
    pick(indices.feature),
  ];
  const parts: string[] = [];
  for (const s of seq) {
    if (!s) continue;
    if (parts.length > 0 && parts[parts.length - 1] === s) continue;
    parts.push(s);
  }
  return parts.join(" > ") || "UNKNOWN_FEATURE";
}

function buildCategoryPath(
  row: string[],
  indices: { cat1: number; cat2: number; cat3: number },
): string {
  const parts: string[] = [];
  const cat1 = indices.cat1 >= 0 ? row[indices.cat1]?.trim() : "";
  const cat2 = indices.cat2 >= 0 ? row[indices.cat2]?.trim() : "";
  const cat3 = indices.cat3 >= 0 ? row[indices.cat3]?.trim() : "";
  if (cat1) parts.push(cat1);
  if (cat2 && cat2 !== cat1) parts.push(cat2);
  if (cat3 && cat3 !== cat2) parts.push(cat3);
  return parts.join(" > ") || undefined as unknown as string;
}

export function buildChecklist(
  headers: string[],
  rows: string[][],
  sourceSheetName: string,
  headerRowIndex: number,
  resolved: ResolvedSkill,
): ChecklistItem[] {
  const patterns = buildKeywordPatterns(resolved);

  const col = resolveSourceSheetColumns(headers);
  if (col.feature < 0) {
    console.warn(
      "[plan] 헤더에 '기능명'에 해당하는 열이 없습니다. 행 스킵이 늘 수 있습니다.",
    );
  }
  if (col.featureDesc < 0) {
    console.warn("[plan] 헤더에 '기능 설명'에 해당하는 열이 없습니다. description은 비어 있을 수 있습니다.");
  }
  const optNote =
    col.cat2 < 0 && col.cat3 < 0
      ? " (중·소분류 열 없음)"
      : col.cat2 < 0
        ? " (중분류 열 없음)"
        : col.cat3 < 0
          ? " (소분류 열 없음)"
          : "";
  console.log(
    `[plan] TC 소스 열 매핑${optNote}: 대분류=${col.cat1}, 중분류=${col.cat2}, 소분류=${col.cat3}, 기능명=${col.feature}, 기능설명=${col.featureDesc}, 요구ID=${col.reqId}, 사전조건=${col.precondition}`,
  );

  const indices = {
    feature: col.feature,
    cat1: col.cat1,
    cat2: col.cat2,
    cat3: col.cat3,
  };

  const checklist: ChecklistItem[] = [];
  let lastCat1 = "";
  let lastCat2 = "";
  let lastCat3 = "";

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((cell) => !cell?.trim())) continue;
    if (isSectionDivider(row)) continue;

    if (indices.cat1 >= 0 && row[indices.cat1]?.trim()) lastCat1 = row[indices.cat1].trim();
    if (indices.cat2 >= 0 && row[indices.cat2]?.trim()) lastCat2 = row[indices.cat2].trim();
    if (indices.cat3 >= 0 && row[indices.cat3]?.trim()) lastCat3 = row[indices.cat3].trim();

    const filledRow = [...row];
    if (indices.cat1 >= 0 && !filledRow[indices.cat1]?.trim()) filledRow[indices.cat1] = lastCat1;
    if (indices.cat2 >= 0 && !filledRow[indices.cat2]?.trim()) filledRow[indices.cat2] = lastCat2;
    if (indices.cat3 >= 0 && !filledRow[indices.cat3]?.trim()) filledRow[indices.cat3] = lastCat3;

    const featureDescIdx = col.featureDesc;
    const featureIdx = col.feature;
    const featureDescription =
      featureDescIdx >= 0 ? (filledRow[featureDescIdx]?.trim() || "") : "";
    const featureRaw = featureIdx >= 0 ? (filledRow[featureIdx]?.trim() || "") : "";

    if (!featureDescription && !featureRaw) continue;

    const rowNum = i + headerRowIndex + 2;
    const feature = buildFeatureName(filledRow, {
      cat1: indices.cat1,
      cat2: indices.cat2,
      cat3: indices.cat3,
      feature: indices.feature,
    });

    const reqId = col.reqId >= 0
      ? (filledRow[col.reqId]?.trim() || `AUTO-${rowNum}`)
      : `AUTO-${rowNum}`;

    const precondition = col.precondition >= 0
      ? (filledRow[col.precondition]?.trim() || "")
      : "";

    const combinedText = `${feature} ${featureDescription} ${precondition}`;
    const domain = inferDomain(combinedText, patterns, resolved);

    const categoryPath = buildCategoryPath(filledRow, {
      cat1: indices.cat1,
      cat2: indices.cat2,
      cat3: indices.cat3,
    });
    const featureTypes = inferFeatureTypes(combinedText);

    checklist.push({
      id: `CL-${String(rowNum).padStart(4, "0")}`,
      requirementId: reqId,
      feature,
      domain,
      description: featureDescription || `${feature} 기능 검증`,
      sourceRow: rowNum,
      sourceSheet: sourceSheetName,
      covered: false,
      featureTypes,
      precondition: precondition || undefined,
      categoryPath: categoryPath || undefined,
    });
  }

  if (checklist.length > 0) {
    const ftStats = new Map<string, number>();
    for (const item of checklist) {
      for (const ft of item.featureTypes ?? []) {
        ftStats.set(ft, (ftStats.get(ft) ?? 0) + 1);
      }
    }
    const statsStr = [...ftStats.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([ft, count]) => `${ft}:${count}`)
      .join(", ");
    console.log(`[plan] feature-type stats: ${statsStr} (total ${checklist.length} items)`);
  }

  return enrichChecklistWithSpecRisk(checklist);
}
