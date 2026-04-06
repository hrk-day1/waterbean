import type { ChecklistItem, TestCase } from "../types/tc.js";

function isBlank(s: string | undefined): boolean {
  return s == null || String(s).trim() === "";
}

/** Traceability "R12" / "R 12" → 원본 시트 행 번호 */
export function parseTraceabilitySourceRow(traceability: string): number | null {
  const m = String(traceability ?? "").trim().match(/^R\s*(\d+)$/i);
  return m ? parseInt(m[1]!, 10) : null;
}

function splitRequirementIds(raw: string): string[] {
  return raw.split(",").map((id) => id.trim()).filter(Boolean);
}

export interface TcEnrichDefaults {
  ownerDefault: string;
  environmentDefault: string;
}

/**
 * LLM이 생략한 Feature·Environment·Owner(및 빈 Status/Automation_Candidate)를
 * 체크리스트·파이프라인 기본값으로 채운다. Evaluator/시트 기록 전에 호출한다.
 */
export function enrichTestCasesFromChecklist(
  tcs: TestCase[],
  checklist: ChecklistItem[],
  defaults: TcEnrichDefaults,
): TestCase[] {
  const byRow = new Map<number, ChecklistItem>();
  const dupRowWarned = new Set<number>();
  for (const item of checklist) {
    const r = item.sourceRow;
    if (!byRow.has(r)) {
      byRow.set(r, item);
    } else if (!dupRowWarned.has(r)) {
      console.warn(`[tc-enrich] duplicate checklist sourceRow ${r}, keeping first item`);
      dupRowWarned.add(r);
    }
  }

  const byReqId = new Map<string, ChecklistItem>();
  for (const item of checklist) {
    if (!byReqId.has(item.requirementId)) {
      byReqId.set(item.requirementId, item);
    }
  }

  return tcs.map((tc) => {
    let feature = tc.Feature;
    if (isBlank(feature)) {
      const row = parseTraceabilitySourceRow(tc.Traceability);
      if (row != null) {
        const hit = byRow.get(row);
        if (hit) feature = hit.feature;
      }
      if (isBlank(feature)) {
        for (const rid of splitRequirementIds(tc.Requirement_ID)) {
          const hit = byReqId.get(rid);
          if (hit) {
            feature = hit.feature;
            break;
          }
        }
      }
      if (isBlank(feature)) {
        feature = "UNKNOWN_FEATURE";
      }
    }

    const environment = isBlank(tc.Environment) ? defaults.environmentDefault : tc.Environment;
    const owner = isBlank(tc.Owner) ? defaults.ownerDefault : tc.Owner;
    const status = isBlank(tc.Status) ? "Draft" : tc.Status;
    const automationCandidate = isBlank(tc.Automation_Candidate) ? "N" : tc.Automation_Candidate;

    return {
      ...tc,
      Feature: feature!,
      Environment: environment,
      Owner: owner,
      Status: status,
      Automation_Candidate: automationCandidate,
    };
  });
}
