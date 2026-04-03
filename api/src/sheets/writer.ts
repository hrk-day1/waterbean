import { getSheetsClient } from "../config/sheets.js";
import { TC_COLUMNS, type TestCase } from "../types/tc.js";

const BATCH_SIZE = 200;

export async function createSheet(
  spreadsheetId: string,
  title: string,
  rowCount = 3000,
) {
  const sheets = await getSheetsClient();

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title,
                gridProperties: { rowCount, columnCount: TC_COLUMNS.length },
              },
            },
          },
        ],
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("already exists")) {
      const timestamped = `${title}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
      return createSheet(spreadsheetId, timestamped, rowCount);
    }
    throw err;
  }

  return title;
}

export async function writeHeaders(spreadsheetId: string, sheetName: string) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[...TC_COLUMNS]] },
  });
}

export async function clearSheetData(
  spreadsheetId: string,
  sheetName: string,
) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}!A2:ZZ`,
  });
}

export async function writeTestCases(
  spreadsheetId: string,
  sheetName: string,
  testCases: TestCase[],
) {
  const sheets = await getSheetsClient();
  const rows = testCases.map((tc) => TC_COLUMNS.map((col) => tc[col] ?? ""));

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:Q`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: batch },
    });
  }
}
