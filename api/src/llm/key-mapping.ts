/**
 * LLM 출력 JSON 키 축약/복원 매핑.
 * 프롬프트에서 축약 키로 출력을 요청하고, 파싱 후 원래 키로 복원한다.
 */

export type KeyMap = Record<string, string>;

export const PLAN_KEY_MAP: KeyMap = {
  id: "i",
  requirementId: "ri",
  feature: "f",
  domain: "d",
  description: "ds",
  sourceRow: "sr",
  sourceSheet: "ss",
  covered: "cv",
  featureTypes: "ft",
  precondition: "pc",
  categoryPath: "cp",
};

export const TC_KEY_MAP: KeyMap = {
  TC_ID: "ti",
  Feature: "f",
  Requirement_ID: "ri",
  Scenario: "sc",
  Precondition: "pc",
  Test_Steps: "ts",
  Test_Data: "td",
  Expected_Result: "er",
  Priority: "pr",
  Severity: "sv",
  Type: "tp",
  Environment: "ev",
  Owner: "ow",
  Status: "st",
  Automation_Candidate: "ac",
  Traceability: "tr",
  Notes: "n",
};

function invertMap(map: KeyMap): KeyMap {
  const inv: KeyMap = {};
  for (const [full, short] of Object.entries(map)) {
    inv[short] = full;
  }
  return inv;
}

/**
 * 축약 키로 된 객체 배열을 원래 키로 복원한다.
 */
export function expandKeys<T>(
  compactArray: Record<string, unknown>[],
  keyMap: KeyMap,
): T[] {
  const inv = invertMap(keyMap);
  return compactArray.map((item) => {
    const expanded: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      expanded[inv[key] ?? key] = value;
    }
    return expanded as T;
  });
}

/**
 * 프롬프트에 삽입할 축약 키 필드 목록 문자열을 생성한다.
 * 예: "ti, f, ri, sc, pc, ts, td, er, pr, sv, tp, ev, ow, st, ac, tr, n"
 */
export function compactFieldList(keyMap: KeyMap): string {
  return Object.values(keyMap).join(", ");
}

/**
 * 프롬프트에 삽입할 키 매핑 표를 생성한다.
 * 예: "ti = TC_ID, f = Feature, ri = Requirement_ID, ..."
 */
export function keyMappingTable(keyMap: KeyMap): string {
  return Object.entries(keyMap)
    .map(([full, short]) => `${short} = ${full}`)
    .join(", ");
}
