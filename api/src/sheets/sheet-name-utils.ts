/** Google Sheets 탭 제목에 부적합한 문자를 치환하고 길이를 제한합니다. */
const INVALID = /[/\\?*[\]:]/g;

export function sanitizeSheetTitleSegment(raw: string): string {
  const trimmed = raw.trim().replace(INVALID, "_").replace(/\s+/g, " ");
  if (trimmed.length === 0) return "Sheet";
  const maxBody = 80 - 3;
  return trimmed.length > maxBody ? trimmed.slice(0, maxBody) : trimmed;
}

export function buildSuggestedTcSheetName(sourceSheetName: string): string {
  const safe = sanitizeSheetTitleSegment(sourceSheetName);
  return `TC_${safe}`;
}
