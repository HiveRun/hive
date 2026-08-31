import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findAvailablePort, waitForHttpOk } from "../utils/wait";

const STARTUP_TIMEOUT_MS = 180_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;
const SIGNAL_TERM_EXIT_CODE = 143;

const modulePath = fileURLToPath(import.meta.url);
const moduleDir = dirname(modulePath);
const serverRoot = join(moduleDir, "..", "..", "..", "..");
const repoRoot = join(serverRoot, "..", "..");
const runsRoot = join(repoRoot, "tmp", "backend-e2e-runs");

export type BackendE2eRuntime = {
  runId: string;
  runRoot: string;
  workspaceRoot: string;
  secondaryWorkspaceRoot: string;
  hiveHome: string;
  dbPath: string;
  logsDir: string;
  apiPort: number;
  webPort: number;
  apiUrl: string;
};

type ManagedServer = {
  runtime: BackendE2eRuntime;
  child: ChildProcess;
  stdoutPath: string;
  stderrPath: string;
  processGroupId: number | null;
};

export async function startBackendE2eServer(): Promise<ManagedServer> {
  const runtime = await createRuntime();
  await createFixtureWorkspace(runtime.workspaceRoot);
  await createFixtureWorkspace(runtime.secondaryWorkspaceRoot);

  const stdoutPath = join(runtime.logsDir, "server.stdout.log");
  const stderrPath = join(runtime.logsDir, "server.stderr.log");
  const stdoutStream = createWriteStream(stdoutPath, { flags: "a" });
  const stderrStream = createWriteStream(stderrPath, { flags: "a" });

  const child = spawn("bun", ["run", "src/index.ts"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      DATABASE_URL: `file:${runtime.dbPath}`,
      HIVE_HOME: runtime.hiveHome,
      HIVE_WORKSPACE_ROOT: runtime.workspaceRoot,
      HIVE_BROWSE_ROOT: runtime.runRoot,
      HIVE_OPENCODE_START_TIMEOUT_MS: "120000",
      HOST: "127.0.0.1",
      PORT: String(runtime.apiPort),
      WEB_PORT: String(runtime.webPort),
      CORS_ORIGIN: "*",
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.pipe(stdoutStream);
  child.stderr?.pipe(stderrStream);

  await waitForHttpOk(`${runtime.apiUrl}/health`, {
    timeoutMs: STARTUP_TIMEOUT_MS,
    intervalMs: 500,
  });

  return {
    runtime,
    child,
    stdoutPath,
    stderrPath,
    processGroupId: process.platform !== "win32" ? (child.pid ?? null) : null,
  };
}

export async function stopBackendE2eServer(
  server: ManagedServer,
  keepArtifacts = false
): Promise<void> {
  await stopProcess(server.child, server.processGroupId);

  if (!keepArtifacts) {
    await rm(server.runtime.runRoot, { recursive: true, force: true });
  }
}

async function createRuntime(): Promise<BackendE2eRuntime> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
  const runRoot = join(runsRoot, runId);
  const workspaceRoot = join(runRoot, "workspace");
  const secondaryWorkspaceRoot = join(runRoot, "workspace-secondary");
  const hiveHome = join(runRoot, "hive-home");
  const dbPath = join(runRoot, "backend-e2e.db");
  const logsDir = join(runRoot, "logs");

  const [apiPort, webPort] = await Promise.all([
    findAvailablePort(),
    findAvailablePort(),
  ]);

  await Promise.all([
    mkdir(runRoot, { recursive: true }),
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(secondaryWorkspaceRoot, { recursive: true }),
    mkdir(hiveHome, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
  ]);

  return {
    runId,
    runRoot,
    workspaceRoot,
    secondaryWorkspaceRoot,
    hiveHome,
    dbPath,
    logsDir,
    apiPort,
    webPort,
    apiUrl: `http://127.0.0.1:${apiPort}`,
  };
}

async function createFixtureWorkspace(workspaceRoot: string): Promise<void> {
  await mkdir(workspaceRoot, { recursive: true });

  const hiveConfig = {
    opencode: {
      defaultModel: "big-pickle",
      defaultProvider: "opencode",
    },
    defaults: {
      templateId: "e2e-template",
      startMode: "plan",
    },
    templates: {
      "e2e-template": {
        id: "e2e-template",
        label: "E2E Template",
        type: "manual",
        agent: {
          modelId: "big-pickle",
          providerId: "opencode",
        },
      },
      "e2e-services-template": {
        id: "e2e-services-template",
        label: "E2E Services Template",
        type: "manual",
        services: {
          api: {
            type: "process",
            run: "tail -f /dev/null",
          },
          worker: {
            type: "process",
            run: "tail -f /dev/null",
          },
        },
      },
      "e2e-setup-retry-template": {
        id: "e2e-setup-retry-template",
        label: "E2E Setup Retry Template",
        type: "manual",
        setup: [
          'test -f .hive-setup-pass || { echo "marker missing: .hive-setup-pass" >&2; exit 37; }',
        ],
      },
    },
  };

  await writeFile(
    join(workspaceRoot, "hive.config.json"),
    `${JSON.stringify(hiveConfig, null, 2)}\n`,
    "utf8"
  );

  await writeFile(
    join(workspaceRoot, "@opencode.json"),
    `${JSON.stringify({ model: "opencode/big-pickle" }, null, 2)}\n`,
    "utf8"
  );

  await writeFile(
    join(workspaceRoot, "README.md"),
    "# Backend E2E Workspace\n"
  );
  await writeFile(join(workspaceRoot, ".hive-setup-pass"), "ok\n", "utf8");

  await runCommand("git", ["init"], workspaceRoot);
  await runCommand("git", ["add", "."], workspaceRoot);
  await runCommand(
    "git",
    [
      "-c",
      "user.name=Hive Backend E2E",
      "-c",
      "user.email=hive-backend-e2e@example.com",
      "commit",
      "-m",
      "Initialize backend e2e workspace",
    ],
    workspaceRoot
  );
}

export async function cloneWorkspace(
  sourceRoot: string,
  targetRoot: string
): Promise<void> {
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(dirname(targetRoot), { recursive: true });
  await cp(sourceRoot, targetRoot, { recursive: true });
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit ${String(code)}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
        )
      );
    });
  });
}

async function stopProcess(
  child: ChildProcess,
  processGroupId: number | null
): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      sendSignal(child, processGroupId, "SIGKILL");
    }, SHUTDOWN_TIMEOUT_MS);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    sendSignal(child, processGroupId, "SIGTERM");
  });

  if (
    child.exitCode !== null &&
    child.exitCode !== 0 &&
    child.exitCode !== SIGNAL_TERM_EXIT_CODE
  ) {
    throw new Error(
      `Server exited with unexpected code ${String(child.exitCode)}`
    );
  }
}

function sendSignal(
  child: ChildProcess,
  processGroupId: number | null,
  signal: NodeJS.Signals
): void {
  if (processGroupId) {
    try {
      process.kill(-processGroupId, signal);
      return;
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
  }

  try {
    child.kill(signal);
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
  }
}

function isMissingProcessError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ESRCH"
  );
}
