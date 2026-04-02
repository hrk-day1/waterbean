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
      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();
      const usage = extractUsage(response);
      console.log(`[llm] tokens: prompt=${usage.promptTokens} completion=${usage.completionTokens}`);
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
    firstParsed = JSON.parse(jsonStr);
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
    secondParsed = JSON.parse(repairJson);
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
