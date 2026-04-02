import { getSheetsClient } from "../config/sheets.js";

export function parseSpreadsheetUrl(url: string) {
  const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const gidMatch = url.match(/gid=(\d+)/);
  if (!idMatch) throw new Error(`Invalid spreadsheet URL: ${url}`);
  return {
    spreadsheetId: idMatch[1],
    gid: gidMatch?.[1],
  };
}

export async function getSheetMetadata(spreadsheetId: string) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  return res.data.sheets ?? [];
}

export async function findSheetName(
  spreadsheetId: string,
  opts: { sheetName?: string; gid?: string },
): Promise<string> {
  const allSheets = await getSheetMetadata(spreadsheetId);

  if (opts.sheetName) {
    const found = allSheets.find(
      (s) => s.properties?.title === opts.sheetName,
    );
    if (found) return found.properties!.title!;
  }

  if (opts.gid) {
    const gidNum = Number(opts.gid);
    const found = allSheets.find(
      (s) => s.properties?.sheetId === gidNum,
    );
    if (found) return found.properties!.title!;
  }

  if (allSheets.length > 0) return allSheets[0].properties!.title!;
  throw new Error("No sheets found in spreadsheet");
}

export async function readSheetValues(
  spreadsheetId: string,
  range: string,
): Promise<string[][]> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  return (res.data.values as string[][] | undefined) ?? [];
}
