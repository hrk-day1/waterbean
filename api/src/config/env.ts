import dotenv from "dotenv";
import path from "node:path";
import type { DomainMinSetFillMode, EvaluatorGateMode } from "../types/pipeline.js";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

function parseDomainMinSetFill(raw: string | undefined): DomainMinSetFillMode | undefined {
  if (!raw?.trim()) return undefined;
  const v = raw.trim().toLowerCase().replace(/-/g, "_");
  if (v === "round_robin" || v === "representative" || v === "off") return v as DomainMinSetFillMode;
  return undefined;
}

function parseEvaluatorGate(raw: string | undefined): EvaluatorGateMode | undefined {
  if (!raw?.trim()) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "off" || v === "warn" || v === "block") return v;
  return undefined;
}

function parseListenPort(): number {
  const fromApi = Number(process.env.API_PORT);
  if (Number.isFinite(fromApi) && fromApi > 0) return fromApi;
  const legacy = Number(process.env.PORT);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return 4000;
}

export const env = {
  port: parseListenPort(),
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
  /** API `domainMinSetFill` 미지정 시 사용. round_robin | representative | off */
  domainMinSetFillDefault: parseDomainMinSetFill(process.env.PIPELINE_DOMAIN_MINSET_FILL),
  /** API `evalSpecGrounding` 미지정 시 사용. off | warn | block */
  evalSpecGroundingDefault: parseEvaluatorGate(process.env.PIPELINE_EVAL_SPEC_GROUNDING),
  /** API `evalTraceability` 미지정 시 사용. off | warn | block */
  evalTraceabilityDefault: parseEvaluatorGate(process.env.PIPELINE_EVAL_TRACEABILITY),
  /** specRiskTier high 행의 요구사항당 TC 상한 기본값 */
  highRiskMaxTcPerRequirementDefault: Math.max(
    2,
    Number(process.env.PIPELINE_HIGH_RISK_MAX_TC_PER_REQUIREMENT) || 6,
  ),
} as const;
