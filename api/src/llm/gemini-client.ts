import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";
import { z, type ZodSchema } from "zod";
import { env } from "../config/env.js";

const MAX_RETRIES = 2;
const SELF_REPAIR_RETRIES = 1;

/** Max chars per log block (env `LLM_JSON_LOG_CHARS`, default 65536). */
export function getLlmJsonLogCharLimit(): number {
  const n = Number(process.env.LLM_JSON_LOG_CHARS);
  return Number.isFinite(n) && n > 0 ? n : 65_536;
}

function truncateForLog(s: string): string {
  const limit = getLlmJsonLogCharLimit();
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}\n... [truncated, ${s.length - limit} more chars]`;
}

/** Thrown when `JSON.parse` fails on LLM output; orchestrator/UI can show `formatLlmJsonFailureForUi`. */
export class LlmJsonParseError extends Error {
  readonly rawModelText: string;
  readonly extractedJson: string;

  constructor(message: string, rawModelText: string, extractedJson: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "LlmJsonParseError";
    this.rawModelText = rawModelText;
    this.extractedJson = extractedJson;
  }
}

function parseJsonErrorPosition(message: string): number | null {
  const m = message.match(/position (\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Compact log for API result / UI (capped). */
export function formatLlmJsonFailureForUi(err: LlmJsonParseError, maxTotal = 24_000): string {
  const parts: string[] = [];
  parts.push(`${err.name}: ${err.message}\n`);

  const pos = parseJsonErrorPosition(err.message);
  const ex = err.extractedJson;
  if (pos !== null && ex.length > 0) {
    const lo = Math.max(0, pos - 400);
    const hi = Math.min(ex.length, pos + 400);
    parts.push("--- Around error (extracted) ---\n");
    parts.push(ex.slice(lo, hi));
    parts.push("\n\n");
  }

  parts.push(`--- Extracted full (${ex.length} chars) ---\n`);
  if (ex.length <= 14_000) {
    parts.push(ex);
  } else {
    parts.push(`${ex.slice(0, 9000)}\n... [${ex.length - 13_000} chars omitted] ...\n${ex.slice(-4000)}`);
  }
  parts.push("\n\n");

  const raw = err.rawModelText;
  parts.push(`--- Raw model (${raw.length} chars, head/tail) ---\n`);
  if (raw.length <= 10_000) {
    parts.push(raw);
  } else {
    parts.push(`${raw.slice(0, 6000)}\n... [middle omitted] ...\n${raw.slice(-4000)}`);
  }

  let out = parts.join("");
  if (out.length > maxTotal) {
    out = `${out.slice(0, maxTotal)}\n...[capped at ${maxTotal} chars]`;
  }
  return out;
}

function logLlmJsonFailure(context: string, rawResponse: string, extracted: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write("\n[llm] ========== JSON PARSE / EXTRACT FAILURE ==========\n");
  process.stderr.write(`[llm] ${context} — ${msg}\n`);
  process.stderr.write(`[llm] raw model text (${rawResponse.length} chars):\n`);
  process.stderr.write(`${truncateForLog(rawResponse)}\n`);
  process.stderr.write(`[llm] extracted for JSON.parse (${extracted.length} chars):\n`);
  process.stderr.write(`${truncateForLog(extracted)}\n`);
  process.stderr.write("[llm] ========== END LLM JSON FAILURE ==========\n\n");
}

let _client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!_client) {
    if (!env.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }
    _client = new GoogleGenerativeAI(env.geminiApiKey);
  }
  return _client;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** API 요청부터 응답 본문 수신까지 (ms) */
  roundTripMs?: number;
}

export interface LlmResponse<T> {
  data: T;
  usage: LlmUsage;
}

function buildConfig(overrides?: Partial<GenerationConfig>): GenerationConfig {
  return {
    temperature: env.llmTemperature,
    maxOutputTokens: env.llmMaxTokens,
    ...overrides,
  };
}

function extractUsage(response: unknown): LlmUsage {
  const meta = (response as { usageMetadata?: Record<string, number> })?.usageMetadata;
  return {
    promptTokens: meta?.promptTokenCount ?? 0,
    completionTokens: meta?.candidatesTokenCount ?? 0,
    totalTokens: meta?.totalTokenCount ?? 0,
  };
}

async function callWithRetry(
  prompt: string,
  config: GenerationConfig,
  retries = MAX_RETRIES,
): Promise<{ text: string; usage: LlmUsage }> {
  const model = getClient().getGenerativeModel({
    model: env.geminiModel,
    generationConfig: config,
  });

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const sentAt = new Date().toISOString();
      const t0 = Date.now();
      console.log(
        `[llm] 요청 전송 sentAt=${sentAt} promptChars=${prompt.length} attempt=${attempt + 1}/${retries + 1}`,
      );
      const result = await model.generateContent(prompt);
      const roundTripMs = Date.now() - t0;
      const receivedAt = new Date().toISOString();
      const response = result.response;
      const text = response.text();
      const usage = { ...extractUsage(response), roundTripMs };
      console.log(
        `[llm] 응답 수신 receivedAt=${receivedAt} roundTripMs=${roundTripMs} promptTok=${usage.promptTokens} completionTok=${usage.completionTokens}`,
      );
      return { text, usage };
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number })?.status;

      if (status === 429) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`[llm] rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${retries + 1})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (attempt < retries) {
        console.warn(`[llm] error (attempt ${attempt + 1}/${retries + 1}):`, err);
        continue;
      }
    }
  }

  throw lastError;
}

/** Map Unicode typographic quotes to ASCII so JSON.parse / brace balancing work. */
function normalizeTypographicQuotesToAscii(text: string): string {
  return text
    .replaceAll("\u201c", '"')
    .replaceAll("\u201d", '"')
    .replaceAll("\u2018", "'")
    .replaceAll("\u2019", "'");
}

/** Strip markdown fences; handle truncated output (no closing ```). */
function stripMarkdownFence(raw: string): string {
  let s = raw.trim();
  if (!s.startsWith("```")) return s;

  s = s.replace(/^```(?:json)?\s*/i, "");
  const close = s.lastIndexOf("```");
  if (close >= 0) {
    s = s.slice(0, close).trim();
  }
  return s;
}

/**
 * Find first top-level JSON object or array (handles leading/trailing prose).
 * Respects strings and escapes so braces inside values are ignored.
 */
function extractBalancedJsonFragment(text: string): string | null {
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  let start = -1;
  if (startObj >= 0 && (startArr < 0 || startObj <= startArr)) {
    start = startObj;
  } else if (startArr >= 0) {
    start = startArr;
  } else {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i]!;

    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (c === "{" || c === "[") {
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function extractJson(raw: string): string {
  const normalized = normalizeTypographicQuotesToAscii(raw);
  const unfenced = stripMarkdownFence(normalized);
  const balanced = extractBalancedJsonFragment(unfenced);
  return balanced ?? unfenced.trim();
}

/**
 * LLM이 배열 대신 `{ "0": ..., "1": ... }` 형태의 숫자 키 객체를 반환하거나,
 * 값이 JSON 문자열(`"{ ... }"`)로 감싸진 경우를 정상 배열로 변환한다.
 */
function normalizeIndexedObject(parsed: unknown): unknown {
  if (Array.isArray(parsed) || typeof parsed !== "object" || parsed === null) {
    return parsed;
  }

  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return parsed;

  const allNumeric = keys.every((k) => /^\d+$/.test(k));
  if (!allNumeric) return parsed;

  const sorted = keys.sort((a, b) => Number(a) - Number(b));
  return sorted.map((k) => {
    const v = obj[k];
    if (typeof v === "string") {
      try { return JSON.parse(v); } catch { return v; }
    }
    return v;
  });
}

/**
 * LLM이 배열 원소를 객체가 아니라 JSON 직렬화 문자열(`"{\"k\":...}"`)로 넣는 경우를 객체로 풀어준다.
 */
function normalizeArrayStringElements(parsed: unknown): unknown {
  if (!Array.isArray(parsed)) return parsed;
  return parsed.map((item) => {
    if (typeof item !== "string") return item;
    const t = item.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) return item;
    try {
      return normalizeIndexedObject(JSON.parse(item));
    } catch {
      return item;
    }
  });
}

/**
 * Zod 스키마가 string을 기대하는 위치에 LLM이 배열 또는 객체를 넣은 경우 문자열로 변환한다.
 * - 배열 → 원소를 줄바꿈("\n")으로 join
 * - 객체 → "key: value" 형태로 줄바꿈 join
 * 재귀적으로 중첩 객체/배열에도 적용한다.
 */
function coerceNonStringFieldsToString(data: unknown): unknown {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map((item) => coerceNonStringFieldsToString(item));
  }

  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        const hasObject = value.some(
          (v) => typeof v === "object" && v !== null && !Array.isArray(v),
        );
        if (hasObject) {
          result[key] = value.map((item) => coerceNonStringFieldsToString(item));
        } else {
          result[key] = value.map((v) => String(v)).join("\n");
        }
      } else if (typeof value === "object" && value !== null) {
        const inner = value as Record<string, unknown>;
        const allPrimitiveValues = Object.values(inner).every(
          (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
        );
        if (allPrimitiveValues) {
          result[key] = Object.entries(inner)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join("\n");
        } else {
          result[key] = coerceNonStringFieldsToString(value);
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return data;
}

function normalizeLlmParsedJson(parsed: unknown): unknown {
  const indexed = normalizeIndexedObject(parsed);
  const stringElements = normalizeArrayStringElements(indexed);
  return coerceNonStringFieldsToString(stringElements);
}

export async function generateText(
  prompt: string,
  configOverrides?: Partial<GenerationConfig>,
): Promise<LlmResponse<string>> {
  const config = buildConfig(configOverrides);
  const { text, usage } = await callWithRetry(prompt, config);
  return { data: text, usage };
}

export async function generateJson<T>(
  prompt: string,
  schema: ZodSchema<T>,
  configOverrides?: Partial<GenerationConfig>,
): Promise<LlmResponse<T>> {
  const config = buildConfig({
    temperature: 0.3,
    ...configOverrides,
  });

  const { text, usage } = await callWithRetry(prompt, config);
  const jsonStr = extractJson(text);

  let firstParsed: unknown;
  try {
    firstParsed = normalizeLlmParsedJson(JSON.parse(jsonStr));
  } catch (parseErr) {
    logLlmJsonFailure("generateJson JSON.parse (primary)", text, jsonStr, parseErr);
    throw new LlmJsonParseError(
      parseErr instanceof Error ? parseErr.message : String(parseErr),
      text,
      jsonStr,
      parseErr,
    );
  }

  const firstParse = schema.safeParse(firstParsed);
  if (firstParse.success) {
    return { data: firstParse.data, usage };
  }

  const repairPrompt = [
    "The previous response had validation errors. Fix the JSON to match the schema.",
    "",
    "IMPORTANT RULES:",
    '- All fields typed as "string" MUST be plain strings, NOT arrays or objects.',
    '  - WRONG: "ts": ["step1", "step2"]  →  RIGHT: "ts": "step1\\nstep2"',
    '  - WRONG: "td": {"key": "val"}     →  RIGHT: "td": "key: val"',
    "- Each array element must be a JSON object, NOT a stringified JSON string.",
    '  - WRONG: ["{\\"ti\\":\\"TC-0001\\"}"]  →  RIGHT: [{"ti":"TC-0001"}]',
    "",
    "Validation errors:",
    JSON.stringify(firstParse.error.flatten(), null, 2),
    "",
    "Original response:",
    jsonStr,
    "",
    "Return ONLY valid JSON, no markdown fences or explanations.",
  ].join("\n");

  const repair = await callWithRetry(repairPrompt, config, SELF_REPAIR_RETRIES);
  const repairJson = extractJson(repair.text);

  let secondParsed: unknown;
  try {
    secondParsed = normalizeLlmParsedJson(JSON.parse(repairJson));
  } catch (parseErr) {
    logLlmJsonFailure("generateJson JSON.parse (repair)", repair.text, repairJson, parseErr);
    throw new LlmJsonParseError(
      parseErr instanceof Error ? parseErr.message : String(parseErr),
      repair.text,
      repairJson,
      parseErr,
    );
  }

  const secondParse = schema.safeParse(secondParsed);

  const totalUsage: LlmUsage = {
    promptTokens: usage.promptTokens + repair.usage.promptTokens,
    completionTokens: usage.completionTokens + repair.usage.completionTokens,
    totalTokens: usage.totalTokens + repair.usage.totalTokens,
    roundTripMs: (usage.roundTripMs ?? 0) + (repair.usage.roundTripMs ?? 0),
  };

  if (secondParse.success) {
    return { data: secondParse.data, usage: totalUsage };
  }

  logLlmJsonFailure(
    "generateJson Zod failed after repair (see flatten below)",
    repair.text,
    repairJson,
    secondParse.error,
  );
  console.error(
    `[llm] zod flatten (repair):\n${JSON.stringify(secondParse.error.flatten(), null, 2)}`,
  );

  throw new Error(
    `LLM JSON self-repair failed: ${JSON.stringify(secondParse.error.flatten())}`,
  );
}
