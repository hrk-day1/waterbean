import crypto from "node:crypto";
import { z } from "zod";
import type { ChecklistItem, TestCase } from "../types/tc.js";
import { TC_TYPES } from "../types/tc.js";
import { generateJson } from "../llm/gemini-client.js";
import { buildGeneratorPrompt } from "../llm/prompts/generator-prompt.js";
import { expandKeys, TC_KEY_MAP } from "../llm/key-mapping.js";
import {
  generateTestCasesFromTestPoints,
  prependGlobalTemplatesAndRenumber,
} from "../pipeline/generator.js";
import { deriveTestPointsForChecklist } from "../pipeline/test-points.js";
import type { Agent } from "./registry.js";
import type { AgentResult, SubAgentConfig } from "./types.js";
import type { eventBus } from "./event-bus.js";
import type { GeneratorInput } from "./deterministic-generator-agent.js";

const m = TC_KEY_MAP;
const CompactTestCaseSchema = z.array(
  z.object({
    [m.TC_ID]: z.string(),
    [m.Feature]: z.string(),
    [m.Requirement_ID]: z.string(),
    [m.Scenario]: z.string(),
    [m.Precondition]: z.string(),
    [m.Test_Steps]: z.string(),
    [m.Test_Data]: z.string(),
    [m.Expected_Result]: z.string(),
    [m.Priority]: z.enum(["P0", "P1", "P2"]),
    [m.Severity]: z.enum(["S1", "S2", "S3"]),
    [m.Type]: z.enum(TC_TYPES as unknown as [string, ...string[]]),
    [m.Environment]: z.string(),
    [m.Owner]: z.string(),
    [m.Status]: z.string(),
    [m.Automation_Candidate]: z.string(),
    [m.Traceability]: z.string(),
    [m.Notes]: z.string().optional(),
  }),
);

function groupByDomain(items: ChecklistItem[]): Map<string, ChecklistItem[]> {
  const groups = new Map<string, ChecklistItem[]>();
  for (const item of items) {
    const list = groups.get(item.domain) ?? [];
    list.push(item);
    groups.set(item.domain, list);
  }
  return groups;
}

// TODO: 환경변수에서 가져오도록 수정
const CHUNK_SIZE = process.env.LLM_GEN_CHUNK_SIZE ? parseInt(process.env.LLM_GEN_CHUNK_SIZE) : 5;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function splitRequirementIds(raw: string): string[] {
  return raw.split(",").map((id) => id.trim()).filter(Boolean);
}

function normalizeScenario(scenario: string): string {
  return scenario.toLowerCase().replace(/\s+/g, " ").trim();
}

export class LlmGeneratorAgent implements Agent<GeneratorInput, TestCase[]> {
  readonly type = "generator" as const;

  async run(
    input: GeneratorInput,
    bus: typeof eventBus,
    config: SubAgentConfig,
  ): Promise<AgentResult<TestCase[]>> {
    const agentId = `gen-llm-${crypto.randomUUID().slice(0, 6)}`;
    const start = Date.now();

    bus.emit(config.pipelineId, {
      agentId, agentType: "generator", status: "running", progress: 0,
      message: `LLM TC 생성 시작 (${input.checklist.length}건)...`,
      timestamp: new Date().toISOString(),
    });

    try {
      const testPointMap = deriveTestPointsForChecklist(input.checklist, true);
      const domainGroups = groupByDomain(input.checklist);
      const allTcs: TestCase[] = [];
      let tcCounter = 1;
      let completedDomains = 0;
      const totalDomains = domainGroups.size;

      const domainPromises = [...domainGroups.entries()].map(
        async ([domain, items]) => {
          const chunks = chunkArray(items, CHUNK_SIZE);
          const domainTcs: TestCase[] = [];
          const reqCount = new Map<string, number>();
          const seenScenario = new Set<string>();
          const maxPerReq = input.config.maxTcPerRequirement ?? 2;
          const domainReqIds = new Set(items.map((item) => item.requirementId));
          let droppedByCap = 0;
          let droppedByDup = 0;

          let chunkIndex = 0;
          for (const chunk of chunks) {
            chunkIndex++;
            const prompt = buildGeneratorPrompt(
              chunk, domain, input.resolvedSkill, input.config, tcCounter,
              testPointMap,
            );

            const { data: compactTcs, usage: chunkUsage } = await generateJson(
              prompt,
              CompactTestCaseSchema,
            );
            console.log(
              `[llm-gen] domain=${domain} chunk=${chunkIndex}/${chunks.length} checklistItems=${chunk.length} roundTripMs=${chunkUsage.roundTripMs ?? "?"} totalTok=${chunkUsage.totalTokens} (prompt=${chunkUsage.promptTokens} completion=${chunkUsage.completionTokens})`,
            );
            const generatedTcs = expandKeys<TestCase>(compactTcs, TC_KEY_MAP);
            const acceptedTcs: TestCase[] = [];

            for (const tc of generatedTcs) {
              const reqIds = splitRequirementIds(tc.Requirement_ID)
                .filter((reqId) => domainReqIds.has(reqId));
              const scopedReqIds = reqIds.length ? reqIds : splitRequirementIds(tc.Requirement_ID);
              const scenarioKey = normalizeScenario(tc.Scenario);

              const isDuplicate = scopedReqIds.some((reqId) =>
                seenScenario.has(`${reqId}|${scenarioKey}`),
              );
              if (isDuplicate) {
                droppedByDup++;
                continue;
              }

              const overCap = scopedReqIds.some((reqId) =>
                (reqCount.get(reqId) ?? 0) >= maxPerReq,
              );
              if (overCap) {
                droppedByCap++;
                continue;
              }

              for (const reqId of scopedReqIds) {
                reqCount.set(reqId, (reqCount.get(reqId) ?? 0) + 1);
                seenScenario.add(`${reqId}|${scenarioKey}`);
              }

              tc.TC_ID = `TC-${String(tcCounter++).padStart(4, "0")}`;
              acceptedTcs.push(tc);
            }

            domainTcs.push(...acceptedTcs);
          }

          completedDomains++;
          const progress = Math.round((completedDomains / totalDomains) * 90);

          bus.emit(config.pipelineId, {
            agentId, agentType: "generator", status: "running", progress,
            message: `${domain} 도메인 완료 (${domainTcs.length}건, cap제외 ${droppedByCap}, 중복제외 ${droppedByDup})`,
            timestamp: new Date().toISOString(),
          });

          return domainTcs;
        },
      );

      const results = await Promise.all(domainPromises);
      let finalCounter = 1;
      for (const domainTcs of results) {
        for (const tc of domainTcs) {
          tc.TC_ID = `TC-${String(finalCounter++).padStart(4, "0")}`;
          allTcs.push(tc);
        }
      }

      const withGlobals = prependGlobalTemplatesAndRenumber(
        allTcs,
        input.resolvedSkill,
        input.config,
      );
      allTcs.length = 0;
      allTcs.push(...withGlobals);

      bus.emit(config.pipelineId, {
        agentId, agentType: "generator", status: "completed", progress: 100,
        message: `LLM TC ${allTcs.length}건 생성 완료`,
        timestamp: new Date().toISOString(),
      });

      return {
        agentId, agentType: "generator", status: "completed",
        data: allTcs, durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn(`[llm-gen] failed, falling back to deterministic: ${message}`);

      bus.emit(config.pipelineId, {
        agentId, agentType: "generator", status: "running", progress: 50,
        message: "LLM 실패, test point 기반 폴백 실행 중...",
        timestamp: new Date().toISOString(),
      });

      try {
        const testCases = generateTestCasesFromTestPoints(input.checklist, input.config, input.resolvedSkill);

        bus.emit(config.pipelineId, {
          agentId, agentType: "generator", status: "completed", progress: 100,
          message: `폴백 TC ${testCases.length}건 생성 완료`,
          timestamp: new Date().toISOString(),
        });

        return {
          agentId, agentType: "generator", status: "completed",
          data: testCases, durationMs: Date.now() - start,
        };
      } catch (fbErr) {
        const fbMsg = fbErr instanceof Error ? fbErr.message : "Unknown error";
        bus.emit(config.pipelineId, {
          agentId, agentType: "generator", status: "failed", progress: 0,
          message: fbMsg, timestamp: new Date().toISOString(),
        });
        return {
          agentId, agentType: "generator", status: "failed",
          data: null, error: fbMsg, durationMs: Date.now() - start,
        };
      }
    }
  }
}
