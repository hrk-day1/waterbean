import crypto from "node:crypto";
import { z } from "zod";
import type { TestCase } from "../types/tc.js";
import { TC_TYPES } from "../types/tc.js";
import { generateJson } from "../llm/gemini-client.js";
import { buildMergePrompt } from "../llm/prompts/merge-prompt.js";
import type { Agent } from "./registry.js";
import type { AgentResult, SubAgentConfig } from "./types.js";
import type { eventBus } from "./event-bus.js";

export interface MergeInput {
  testCases: TestCase[];
}

const MergedTcSchema = z.array(
  z.object({
    TC_ID: z.string(),
    Feature: z.string(),
    Requirement_ID: z.string(),
    Scenario: z.string(),
    Precondition: z.string(),
    Test_Steps: z.string(),
    Test_Data: z.string(),
    Expected_Result: z.string(),
    Priority: z.enum(["P0", "P1", "P2"]),
    Severity: z.enum(["S1", "S2", "S3"]),
    Type: z.enum(TC_TYPES as unknown as [string, ...string[]]),
    Environment: z.string(),
    Owner: z.string(),
    Status: z.string(),
    Automation_Candidate: z.string(),
    Traceability: z.string(),
    Notes: z.string().optional(),
  }),
);

// TODO: 환경변수에서 가져오도록 수정
const MERGE_CHUNK_SIZE = process.env.LLM_MERGE_CHUNK_SIZE ? parseInt(process.env.LLM_MERGE_CHUNK_SIZE) : 20;

function groupTcsByDomain(testCases: TestCase[]): Map<string, TestCase[]> {
  const groups = new Map<string, TestCase[]>();
  for (const tc of testCases) {
    const domain = tc.Feature.split(/[\s_-]/)[0] ?? "Unknown";
    const list = groups.get(domain) ?? [];
    list.push(tc);
    groups.set(domain, list);
  }
  return groups;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

export class LlmMergeAgent implements Agent<MergeInput, TestCase[]> {
  readonly type = "merge" as const;

  async run(
    input: MergeInput,
    bus: typeof eventBus,
    config: SubAgentConfig,
  ): Promise<AgentResult<TestCase[]>> {
    const agentId = `merge-llm-${crypto.randomUUID().slice(0, 6)}`;
    const start = Date.now();
    const originalCount = input.testCases.length;

    bus.emit(config.pipelineId, {
      agentId, agentType: "merge", status: "running", progress: 0,
      message: `TC 병합 시작 (${originalCount}건)...`,
      timestamp: new Date().toISOString(),
    });

    try {
      const domainGroups = groupTcsByDomain(input.testCases);
      const mergedAll: TestCase[] = [];
      let completedDomains = 0;
      const totalDomains = domainGroups.size;

      for (const [domain, domainTcs] of domainGroups) {
        const chunks = chunkArray(domainTcs, MERGE_CHUNK_SIZE);

        for (const chunk of chunks) {
          if (chunk.length <= 1) {
            mergedAll.push(...chunk);
            continue;
          }

          const prompt = buildMergePrompt(chunk, domain);
          const { data: merged } = await generateJson(prompt, MergedTcSchema);
          const mergedChunk = merged as TestCase[];
          if (mergedChunk.length > chunk.length) {
            // 병합 단계는 원본 대비 감소/유지되어야 한다는 보수적 가드
            console.warn(
              `[llm-merge] abnormal growth detected (${domain}): ${chunk.length} -> ${mergedChunk.length}, keep original chunk`,
            );
            mergedAll.push(...chunk);
            continue;
          }
          mergedAll.push(...mergedChunk);
        }

        completedDomains++;
        const progress = Math.round((completedDomains / totalDomains) * 90);
        bus.emit(config.pipelineId, {
          agentId, agentType: "merge", status: "running", progress,
          message: `${domain} 도메인 병합 완료`,
          timestamp: new Date().toISOString(),
        });
      }

      let counter = 1;
      for (const tc of mergedAll) {
        tc.TC_ID = `TC-${String(counter++).padStart(4, "0")}`;
      }

      const removed = originalCount - mergedAll.length;
      bus.emit(config.pipelineId, {
        agentId, agentType: "merge", status: "completed", progress: 100,
        message: `병합 완료: ${originalCount}건 → ${mergedAll.length}건 (${removed}건 병합됨)`,
        timestamp: new Date().toISOString(),
      });

      return {
        agentId, agentType: "merge", status: "completed",
        data: mergedAll, durationMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn(`[llm-merge] failed, keeping original TCs: ${message}`);

      bus.emit(config.pipelineId, {
        agentId, agentType: "merge", status: "completed", progress: 100,
        message: `병합 실패, 원본 ${originalCount}건 유지`,
        timestamp: new Date().toISOString(),
      });

      return {
        agentId, agentType: "merge", status: "completed",
        data: input.testCases, durationMs: Date.now() - start,
      };
    }
  }
}
