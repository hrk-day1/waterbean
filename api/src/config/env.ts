import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

export const env = {
  port: Number(process.env.PORT) || 4000,
  saKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || "../sa.json",

  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
  llmMaxTokens: Number(process.env.LLM_MAX_TOKENS) || 8192,
  llmTemperature: Number(process.env.LLM_TEMPERATURE) || 1.0,
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 30_000,
  llmPlanChunkSize: Number(process.env.LLM_PLAN_CHUNK_SIZE) || 10,
  /** Plan 청크 LLM 호출 동시성 (1~8, 기본 3) */
  llmPlanConcurrency: Math.min(
    8,
    Math.max(1, Number(process.env.LLM_PLAN_CONCURRENCY) || 3),
  ),
  llmGenBatchSize: Number(process.env.LLM_GEN_BATCH_SIZE) || 20,
  /** 설정 시 Plan/Generator 입출력 JSON을 이 디렉터리 하위 `{pipelineId}/`에 저장 */
  pipelineDebugDir: (process.env.PIPELINE_DEBUG_DIR ?? "").trim(),
} as const;
