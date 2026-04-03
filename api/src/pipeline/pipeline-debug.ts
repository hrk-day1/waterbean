import fs from "node:fs/promises";
import path from "node:path";

/** env `PIPELINE_DEBUG_DIR` — 비어 있으면 스냅샷 비활성 */
export function resolvePipelineDebugRoot(dirFromEnv: string): string {
  const t = dirFromEnv.trim();
  if (!t) return "";
  return path.isAbsolute(t) ? t : path.resolve(process.cwd(), t);
}

export async function writePipelineDebugJson(
  rootDir: string,
  pipelineId: string,
  relativePath: string,
  data: unknown,
): Promise<void> {
  if (!rootDir) return;
  const safeId = pipelineId.replace(/[/\\]/g, "_");
  const file = path.join(rootDir, safeId, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  console.log(`[pipeline-debug] wrote ${path.relative(process.cwd(), file) || file}`);
}
