import type { ChecklistItem, Domain } from "../types/tc.js";
import { DOMAINS } from "../types/tc.js";
import type { SkillManifest } from "../skills/types.js";

const HEADER_CANDIDATES: Record<string, RegExp> = {
  feature: /^(feature|module|menu|기능명|기능|모듈|서비스|메뉴)$/i,
  category1: /^(대분류)$/i,
  category2: /^(중분류)$/i,
  category3: /^(소분류)$/i,
  reqId: /^(requirement_id|req_id|ticket|id|요구사항id|요건번호|번호)$/i,
  scenario: /^(requirement|story|description|시나리오|설명|요구사항|상세|내용|기능\s*설명)$/i,
  precondition: /^(precondition|given|사전조건|전제)$/i,
};

function buildKeywordPatterns(
  domainKeywords: Record<Domain, string[]>,
): Map<Domain, RegExp> {
  const map = new Map<Domain, RegExp>();
  for (const domain of DOMAINS) {
    const words = domainKeywords[domain];
    if (words?.length) {
      map.set(domain, new RegExp(words.join("|"), "i"));
    }
  }
  return map;
}

function inferDomain(
  text: string,
  patterns: Map<Domain, RegExp>,
): Domain {
  for (const domain of DOMAINS) {
    const re = patterns.get(domain);
    if (re?.test(text)) return domain;
  }
  return "Admin";
}

function findColumnIndex(headers: string[], pattern: RegExp): number {
  return headers.findIndex((h) => pattern.test(h.trim()));
}

function isHeaderRow(row: string[]): boolean {
  if (!row || row.length < 3) return false;
  const filled = row.filter((c) => c?.trim());
  if (filled.length < 3) return false;

  let matches = 0;
  for (const pattern of Object.values(HEADER_CANDIDATES)) {
    if (row.some((c) => pattern.test(c?.trim() ?? ""))) matches++;
  }
  return matches >= 2;
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
  const parts: string[] = [];
  const cat2 = indices.cat2 >= 0 ? row[indices.cat2]?.trim() : "";
  const cat3 = indices.cat3 >= 0 ? row[indices.cat3]?.trim() : "";
  const feat = indices.feature >= 0 ? row[indices.feature]?.trim() : "";
  const cat1 = indices.cat1 >= 0 ? row[indices.cat1]?.trim() : "";

  if (cat2) parts.push(cat2);
  if (cat3 && cat3 !== cat2) parts.push(cat3);
  if (feat && feat !== cat3 && feat !== cat2) parts.push(feat);

  if (parts.length === 0 && cat1) parts.push(cat1);
  return parts.join(" > ") || "UNKNOWN_FEATURE";
}

export function buildChecklist(
  headers: string[],
  rows: string[][],
  sourceSheetName: string,
  headerRowIndex: number,
  skill: SkillManifest,
): ChecklistItem[] {
  const patterns = buildKeywordPatterns(skill.domainKeywords);

  const indices = {
    feature: findColumnIndex(headers, HEADER_CANDIDATES.feature),
    cat1: findColumnIndex(headers, HEADER_CANDIDATES.category1),
    cat2: findColumnIndex(headers, HEADER_CANDIDATES.category2),
    cat3: findColumnIndex(headers, HEADER_CANDIDATES.category3),
    reqId: findColumnIndex(headers, HEADER_CANDIDATES.reqId),
    scenario: findColumnIndex(headers, HEADER_CANDIDATES.scenario),
    precondition: findColumnIndex(headers, HEADER_CANDIDATES.precondition),
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

    const scenarioIdx = indices.scenario;
    const featureIdx = indices.feature;
    const scenario = scenarioIdx >= 0 ? (filledRow[scenarioIdx]?.trim() || "") : "";
    const featureRaw = featureIdx >= 0 ? (filledRow[featureIdx]?.trim() || "") : "";

    if (!scenario && !featureRaw) continue;

    const rowNum = i + headerRowIndex + 2;
    const feature = buildFeatureName(filledRow, {
      cat1: indices.cat1,
      cat2: indices.cat2,
      cat3: indices.cat3,
      feature: indices.feature,
    });

    const reqId = indices.reqId >= 0
      ? (filledRow[indices.reqId]?.trim() || `AUTO-${rowNum}`)
      : `AUTO-${rowNum}`;

    const precondition = indices.precondition >= 0
      ? (filledRow[indices.precondition]?.trim() || "")
      : "";

    const combinedText = `${feature} ${scenario} ${precondition}`;
    const domain = inferDomain(combinedText, patterns);

    checklist.push({
      id: `CL-${String(rowNum).padStart(4, "0")}`,
      requirementId: reqId,
      feature,
      domain,
      description: scenario || `${feature} 기능 검증`,
      sourceRow: rowNum,
      sourceSheet: sourceSheetName,
      covered: false,
    });
  }

  return checklist;
}
