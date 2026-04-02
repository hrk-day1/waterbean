import type { PipelineConfig, PipelineResult } from "../types/pipeline.js";
import { parseSpreadsheetUrl, findSheetName, readSheetValues } from "../sheets/reader.js";
import { createSheet, writeHeaders, writeTestCases } from "../sheets/writer.js";
import { buildChecklist, detectHeaderAndData } from "./plan.js";
import { generateTestCases } from "./generator.js";
import { evaluate } from "./evaluator.js";
import { getSkill } from "../skills/registry.js";

export async function runPipeline(config: PipelineConfig): Promise<PipelineResult> {
  const skill = getSkill(config.skillId);
  const { spreadsheetId, gid } = parseSpreadsheetUrl(config.spreadsheetUrl);

  const sourceSheetName = await findSheetName(spreadsheetId, {
    sheetName: config.sourceSheetName,
    gid: config.sourceGid ?? gid ?? undefined,
  });

  const raw = await readSheetValues(spreadsheetId, `'${sourceSheetName}'!A1:ZZ`);
  if (raw.length < 2) {
    throw new Error(`Source sheet '${sourceSheetName}' has no data rows`);
  }

  const { headers, dataRows, headerRowIndex } = detectHeaderAndData(raw);
  console.log(`[runner] skill=${skill.id}, header at row ${headerRowIndex + 1}: [${headers.filter(Boolean).join(", ")}]`);

  const fullChecklist = buildChecklist(headers, dataRows, sourceSheetName, headerRowIndex, skill);

  const scopedChecklist =
    config.domainScope === "ALL"
      ? fullChecklist
      : fullChecklist.filter(
          (c) => c.domain.toUpperCase() === config.domainScope,
        );

  if (scopedChecklist.length === 0) {
    throw new Error(`No checklist items match domain scope '${config.domainScope}'`);
  }

  let allTestCases = generateTestCases(scopedChecklist, {
    ownerDefault: config.ownerDefault,
    environmentDefault: config.environmentDefault,
    maxTcPerRequirement: config.maxTcPerRequirement,
  }, skill);

  let round = 1;
  let evalResult = evaluate(scopedChecklist, allTestCases, skill);

  while (!evalResult.passed && evalResult.uncoveredItems.length > 0 && round <= config.maxFallbackRounds) {
    console.log(`[runner] fallback round ${round}: ${evalResult.uncoveredItems.length} uncovered items`);

    const extraTCs = generateTestCases(evalResult.uncoveredItems, {
      ownerDefault: config.ownerDefault,
      environmentDefault: config.environmentDefault,
      maxTcPerRequirement: config.maxTcPerRequirement,
    }, skill);

    allTestCases = [...allTestCases, ...extraTCs];
    evalResult = evaluate(scopedChecklist, allTestCases, skill);
    round++;
  }

  const sheetName = await createSheet(spreadsheetId, config.targetSheetName);
  await writeHeaders(spreadsheetId, sheetName);
  await writeTestCases(spreadsheetId, sheetName, allTestCases);

  console.log(`[runner] wrote ${allTestCases.length} TCs to '${sheetName}' after ${round} round(s)`);

  return {
    success: evalResult.passed,
    sheetName,
    rounds: round,
    stats: evalResult.stats,
    evaluationIssues: evalResult.issues,
  };
}
