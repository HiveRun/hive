import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type SavedFastWorkers = {
  updatedAt: string;
  workers: number;
};

const modulePath = fileURLToPath(import.meta.url);
const moduleDir = dirname(modulePath);
const e2eRoot = join(moduleDir, "..", "..");
const repoRoot = join(e2eRoot, "..", "..");
const FAST_WORKERS_FILE = join(repoRoot, "tmp", "e2e-fast-workers.json");

export function getFastWorkersFilePath(): string {
  return FAST_WORKERS_FILE;
}

export async function readSavedFastWorkers(): Promise<number | null> {
  try {
    const content = await readFile(FAST_WORKERS_FILE, "utf8");
    const parsed = JSON.parse(content) as Partial<SavedFastWorkers>;
    const workers = Number(parsed.workers);
    if (!Number.isFinite(workers) || workers < 1) {
      return null;
    }

    return Math.floor(workers);
  } catch {
    return null;
  }
}

export async function writeSavedFastWorkers(workers: number): Promise<void> {
  const normalizedWorkers = Math.max(1, Math.floor(workers));
  const payload: SavedFastWorkers = {
    updatedAt: new Date().toISOString(),
    workers: normalizedWorkers,
  };

  await mkdir(dirname(FAST_WORKERS_FILE), { recursive: true });
  await writeFile(
    FAST_WORKERS_FILE,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
}
