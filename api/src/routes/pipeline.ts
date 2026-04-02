import { Router } from "express";
import { z } from "zod";
import { runPipeline } from "../pipeline/runner.js";
import { runFork } from "../pipeline/fork-runner.js";
import { listSkills } from "../skills/registry.js";

export const pipelineRouter = Router();

const RunRequestSchema = z.object({
  spreadsheetUrl: z.string().url(),
  sourceSheetName: z.string().optional(),
  sourceGid: z.string().optional(),
  targetSheetName: z.string().default("QA_TC_Master"),
  domainScope: z.enum(["ALL", "AUTH", "PAY", "CONTENT", "MEMBERSHIP", "COMMUNITY", "CREATOR", "ADMIN"]).default("ALL"),
  ownerDefault: z.string().default("TBD"),
  environmentDefault: z.string().default("WEB-CHROME"),
  maxTcPerRequirement: z.number().int().positive().optional(),
  maxFallbackRounds: z.number().int().min(0).max(5).default(2),
  skillId: z.string().default("default"),
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
    res.status(500).json({ error: message });
  }
});

const ForkVariantSchema = z.object({
  label: z.string().min(1),
  skillId: z.string().default("default"),
  domainScope: z.enum(["ALL", "AUTH", "PAY", "CONTENT", "MEMBERSHIP", "COMMUNITY", "CREATOR", "ADMIN"]).default("ALL"),
  maxFallbackRounds: z.number().int().min(0).max(5).default(2),
});

const ForkRequestSchema = z.object({
  spreadsheetUrl: z.string().url(),
  baseSheetName: z.string().default("QA_TC_Fork"),
  ownerDefault: z.string().default("TBD"),
  environmentDefault: z.string().default("WEB-CHROME"),
  maxTcPerRequirement: z.number().int().positive().optional(),
  variants: z.array(ForkVariantSchema).min(2).max(5),
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
