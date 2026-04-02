import fs from "node:fs";
import path from "node:path";
import type { SkillManifest } from "./types.js";

const PRESETS_DIR = path.resolve(import.meta.dirname, "presets");

const cache = new Map<string, SkillManifest>();

function loadFromDisk(id: string): SkillManifest | null {
  const filePath = path.join(PRESETS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as SkillManifest;
}

export function getSkill(id: string): SkillManifest {
  const cached = cache.get(id);
  if (cached) return cached;

  const skill = loadFromDisk(id);
  if (!skill) throw new Error(`Skill '${id}' not found`);

  cache.set(id, skill);
  return skill;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
}

export function listSkills(): SkillSummary[] {
  const files = fs.readdirSync(PRESETS_DIR).filter((f) => f.endsWith(".json"));

  return files.map((f) => {
    const id = f.replace(/\.json$/, "");
    const skill = getSkill(id);
    return { id: skill.id, name: skill.name, description: skill.description };
  });
}

export function clearCache() {
  cache.clear();
}
