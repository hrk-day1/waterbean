import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { runPipeline } from "../pipeline/runner.js";
import { runFork } from "../pipeline/fork-runner.js";
import { listSkills } from "../skills/registry.js";
import { orchestrate } from "../agents/orchestrator.js";
import { eventBus } from "../agents/event-bus.js";
import { getExecution } from "../agents/store.js";
import { listAgents } from "../agents/registry.js";
import { formatLlmJsonFailureForUi, LlmJsonParseError } from "../llm/gemini-client.js";

export const pipelineRouter = Router();

const RunRequestSchema = z
  .object({
    spreadsheetUrl: z.string().url(),
    sourceSheetName: z.string().optional(),
    sourceGid: z.string().optional(),
    targetSheetName: z.string().default("QA_TC_Master"),
    domainMode: z.enum(["preset", "discovered"]).default("preset"),
    domainScope: z
      .enum(["ALL", "AUTH", "PAY", "CONTENT", "MEMBERSHIP", "COMMUNITY", "CREATOR", "ADMIN"])
      .default("ALL"),
    ownerDefault: z.string().default("TBD"),
    environmentDefault: z.string().default("WEB-CHROME"),
    maxTcPerRequirement: z.number().int().positive().optional(),
    highRiskMaxTcPerRequirement: z.number().int().positive().optional(),
    maxFallbackRounds: z.number().int().min(0).max(5).default(2),
    skillId: z.string().default("default"),
    implementation: z.enum(["deterministic", "llm"]).default("llm"),
    maxLlmRounds: z.number().int().min(0).max(5).default(3),
    mergeSimilarTestCases: z.boolean().default(false),
    domainMinSetFill: z.enum(["round_robin", "representative", "off"]).optional(),
    evalSpecGrounding: z.enum(["off", "warn", "block"]).optional(),
    evalTraceability: z.enum(["off", "warn", "block"]).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.domainMode === "discovered" && val.domainScope !== "ALL") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "domainMode 'discovered'일 때 domainScope는 ALL만 허용됩니다.",
        path: ["domainScope"],
      });
    }
  });

pipelineRouter.get("/skills", (_req, res) => {
  const skills = listSkills();
  res.json(skills);
});

pipelineRouter.post("/run", async (req, res) => {
  const parsed = RunRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await runPipeline(parsed.data);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[pipeline] error:", err);
    const payload: { error: string; llmJsonFailureLog?: string } = { error: message };
    if (err instanceof LlmJsonParseError) {
      payload.llmJsonFailureLog = formatLlmJsonFailureForUi(err, 16_000);
    }
    res.status(500).json(payload);
  }
});

// --- Async execution ---
pipelineRouter.post("/run/async", (req, res) => {
  const parsed = RunRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const pipelineId = crypto.randomUUID().slice(0, 8);
  void orchestrate(parsed.data, { pipelineId }).catch((err) => {
    console.error("[pipeline/async] error:", err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    if (err instanceof LlmJsonParseError) {
      console.error(`[pipeline/async] LLM JSON detail:\n${formatLlmJsonFailureForUi(err, 32_000)}`);
    }
  });

  res.json({ pipelineId, status: "started" });
});

function attachProgressSse(res: Response, req: Request, channelId: string): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(`data: ${JSON.stringify({ type: "connected", channelId })}\n\n`);

  const unsubscribe = eventBus.subscribe(channelId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);

    const payload = event.payload as { pipelineFinished?: boolean } | undefined;
    if (payload?.pipelineFinished) {
      const exec = getExecution(channelId);
      res.write(`data: ${JSON.stringify({ type: "pipeline_complete", result: exec?.result })}\n\n`);
      res.end();
      unsubscribe();
    }
  });

  req.on("close", () => {
    unsubscribe();
  });
}

// --- SSE event stream ---
pipelineRouter.get("/run/:pipelineId/events", (req, res) => {
  attachProgressSse(res, req, req.params.pipelineId);
});

// --- Pipeline result ---
pipelineRouter.get("/run/:pipelineId/result", (req, res) => {
  const exec = getExecution(req.params.pipelineId);
  if (!exec) {
    res.status(404).json({ error: "Pipeline not found" });
    return;
  }
  if (!exec.completedAt) {
    res.status(202).json({ status: "running", agents: exec.agents });
    return;
  }
  res.json(exec.result);
});

// --- Agent states ---
pipelineRouter.get("/run/:pipelineId/agents", (req, res) => {
  const exec = getExecution(req.params.pipelineId);
  if (!exec) {
    res.status(404).json({ error: "Pipeline not found" });
    return;
  }
  res.json({ pipelineId: exec.pipelineId, agents: exec.agents });
});

// --- Registered agents list ---
pipelineRouter.get("/agents", (_req, res) => {
  res.json(listAgents());
});

/** Phase C: 알림 연동 스켈레톤(실제 웹훅 전송 없음, 검증·로깅만). */
const NotifyRequestSchema = z.object({
  event: z.enum(["pipeline_completed", "ping"]),
  pipelineId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

pipelineRouter.post("/notify", (req, res) => {
  const parsed = NotifyRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  console.log("[pipeline/notify] skeleton accept:", JSON.stringify(parsed.data));
  res.json({
    accepted: true,
    delivered: false,
    message:
      "Phase C skeleton: outbound webhook not implemented. Subscribe via SSE or poll GET /pipeline/run/:id/result.",
  });
});

const ForkVariantSchema = z.object({
  label: z.string().min(1),
  skillId: z.string().default("default"),
  domainMode: z.enum(["preset", "discovered"]).default("preset"),
  domainScope: z.enum(["ALL", "AUTH", "PAY", "CONTENT", "MEMBERSHIP", "COMMUNITY", "CREATOR", "ADMIN"]).default("ALL"),
  maxFallbackRounds: z.number().int().min(0).max(5).default(2),
});

const ForkRequestSchema = z
  .object({
    spreadsheetUrl: z.string().url(),
    baseSheetName: z.string().default("QA_TC_Fork"),
    ownerDefault: z.string().default("TBD"),
    environmentDefault: z.string().default("WEB-CHROME"),
    maxTcPerRequirement: z.number().int().positive().optional(),
    highRiskMaxTcPerRequirement: z.number().int().positive().optional(),
    variants: z.array(ForkVariantSchema).min(2).max(5),
  })
  .superRefine((data, ctx) => {
    data.variants.forEach((v, i) => {
      if (v.domainMode === "discovered" && v.domainScope !== "ALL") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "domainMode 'discovered'일 때 domainScope는 ALL만 허용됩니다.",
          path: ["variants", i, "domainScope"],
        });
      }
    });
  });

pipelineRouter.post("/fork", async (req, res) => {
  const parsed = ForkRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await runFork(parsed.data);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[fork] error:", err);
    res.status(500).json({ error: message });
  }
});

pipelineRouter.post("/fork/async", (req, res) => {
  const parsed = ForkRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const forkId = crypto.randomUUID().slice(0, 8);
  void runFork(parsed.data, { forkId, emitProgress: true }).catch((err) => {
    console.error("[fork/async] error:", err);
  });

  res.json({ forkId, status: "started" });
});

pipelineRouter.get("/fork/:forkId/events", (req, res) => {
  attachProgressSse(res, req, req.params.forkId);
});

pipelineRouter.get("/fork/:forkId/result", (req, res) => {
  const exec = getExecution(req.params.forkId);
  if (!exec) {
    res.status(404).json({ error: "Fork run not found" });
    return;
  }
  if (!exec.completedAt) {
    res.status(202).json({ status: "running", agents: exec.agents });
    return;
  }
  res.json(exec.result);
});
