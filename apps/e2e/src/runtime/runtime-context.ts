import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { findAvailablePort } from "./wait";

type CreateRuntimeContextOptions = {
  hiveHomePath?: string;
  repoRoot: string;
  workspaceName?: string;
};

export type RuntimeContext = {
  runId: string;
  runRoot: string;
  workspaceRoot: string;
  hiveHome: string;
  dbPath: string;
  logsDir: string;
  artifactsDir: string;
  apiPort: number;
  webPort: number;
  apiUrl: string;
  webUrl: string;
};

const RUNS_DIRECTORY = ["tmp", "e2e-runs"] as const;

export async function createRuntimeContext(
  options: CreateRuntimeContextOptions
): Promise<RuntimeContext> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
  const runRoot = join(options.repoRoot, ...RUNS_DIRECTORY, runId);
  const workspaceRoot = join(runRoot, options.workspaceName ?? "workspace");
  const hiveHome = options.hiveHomePath ?? join(runRoot, "hive-home");
  const dbPath = join(runRoot, "e2e.db");
  const logsDir = join(runRoot, "logs");
  const artifactsDir = join(runRoot, "artifacts");

  const [apiPort, webPort] = await Promise.all([
    findAvailablePort(),
    findAvailablePort(),
  ]);

  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;

  await Promise.all([
    mkdir(resolve(workspaceRoot), { recursive: true }),
    mkdir(resolve(hiveHome), { recursive: true }),
    mkdir(resolve(logsDir), { recursive: true }),
    mkdir(resolve(artifactsDir), { recursive: true }),
  ]);

  return {
    runId,
    runRoot,
    workspaceRoot,
    hiveHome,
    dbPath,
    logsDir,
    artifactsDir,
    apiPort,
    webPort,
    apiUrl,
    webUrl,
  };
}
