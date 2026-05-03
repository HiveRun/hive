import { rm } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { finishRuntimeRun } from "./artifacts";
import { createFixtureWorkspace } from "./fixture-workspace";
import { parseSpecArg, resolveRuntimePaths } from "./paths";
import { runPlaywrightSuite } from "./playwright";
import {
  createManagedProcessStopper,
  type ManagedProcess,
  readProcessTable,
  runCommand,
  runCommandCapture,
  startManagedProcess,
  stopManagedProcesses,
  terminateProcessIds,
} from "./process";
import { createRuntimeContext } from "./runtime-context";
import { startWebE2eServer } from "./server";
import { waitForHttpOk } from "./wait";

const KEEP_ARTIFACTS = process.env.HIVE_E2E_KEEP_ARTIFACTS === "1";
const CLEANUP_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 180_000;
const OPENCODE_TERMINATE_WAIT_MS = 1000;
const WEB_READY_PATH = "/";
const SECONDARY_WORKSPACE_NAME = "workspace-secondary";

type WorkspaceMode = "fixture" | "clone";

const WORKSPACE_MODE_ENV = "HIVE_E2E_WORKSPACE_MODE";
const WORKSPACE_SOURCE_ENV = "HIVE_E2E_WORKSPACE_SOURCE";
const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "fixture";

const { e2eRoot, repoRoot, serverRoot, stableArtifactsDir } =
  resolveRuntimePaths(import.meta.url);
const webRoot = join(repoRoot, "apps", "web");
const e2eRunsRoot = join(repoRoot, "tmp", "e2e-runs");
const useSharedHiveHome = process.env.HIVE_E2E_SHARED_HOME === "1";
const sharedHiveHomePath = join(repoRoot, "tmp", "e2e-shared", "hive-home");
const stopManagedProcess = createManagedProcessStopper({
  cleanupTimeoutMs: CLEANUP_TIMEOUT_MS,
  warnOnMissingLogs: true,
});

async function run() {
  const spec = parseSpecArg(process.argv.slice(2));
  const workspaceMode = resolveWorkspaceMode();
  const workspaceRootName = workspaceMode === "clone" ? "hive" : "workspace";
  const context = await createRuntimeContext({
    hiveHomePath: useSharedHiveHome ? sharedHiveHomePath : undefined,
    repoRoot,
    workspaceName: workspaceRootName,
  });
  const secondaryWorkspaceRoot = join(
    context.runRoot,
    SECONDARY_WORKSPACE_NAME
  );
  const managedProcesses: ManagedProcess[] = [];
  let runSucceeded = false;

  try {
    await cleanupOrphanedOpencodeProcesses({
      currentPid: process.pid,
      e2eRunsRoot,
      preserveRunRoot: context.runRoot,
    });

    if (useSharedHiveHome) {
      process.stdout.write(`Using shared E2E HIVE_HOME: ${context.hiveHome}\n`);
    }

    if (workspaceMode === "clone") {
      const workspaceSource = resolveWorkspaceSource();
      process.stdout.write(
        `Preparing cloned E2E workspace from ${workspaceSource}\n`
      );
      await createClonedWorkspace({
        sourceRoot: workspaceSource,
        workspaceRoot: context.workspaceRoot,
      });
      await createWebFixtureWorkspace(secondaryWorkspaceRoot);
    } else {
      await createWebFixtureWorkspace(context.workspaceRoot);
      await createWebFixtureWorkspace(secondaryWorkspaceRoot);
    }

    const server = await startWebE2eServer({
      context,
      logsDir: context.logsDir,
      serverRoot,
      stopProcess: stopManagedProcess,
    });
    managedProcesses.push(server);

    const web = startManagedProcess({
      command: "bun",
      args: [
        "run",
        "dev:e2e",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        String(context.webPort),
      ],
      cwd: webRoot,
      env: {
        ...process.env,
        PORT: String(context.webPort),
        VITE_API_URL: context.apiUrl,
        VITE_DISABLE_DEVTOOLS: "true",
      },
      logsDir: context.logsDir,
      name: "web",
    });
    managedProcesses.push(web);

    await waitForHttpOk(`${context.webUrl}${WEB_READY_PATH}`, {
      timeoutMs: STARTUP_TIMEOUT_MS,
    });

    await runPlaywrightSuite({
      context,
      e2eRoot,
      extraEnv: {
        HIVE_E2E_BASE_URL: context.webUrl,
        HIVE_E2E_SECOND_WORKSPACE_PATH: secondaryWorkspaceRoot,
      },
      label: "Playwright suite",
      spec,
    });

    runSucceeded = true;
    process.stdout.write("E2E suite passed.\n");
  } finally {
    await stopManagedProcesses(managedProcesses, stopManagedProcess);

    await cleanupOpencodeProcessesForRunRoot(context.runRoot);

    await finishRuntimeRun({
      artifactsDir: context.artifactsDir,
      keepArtifacts: KEEP_ARTIFACTS,
      reportsLabel: "E2E reports",
      runRoot: context.runRoot,
      runSucceeded,
      runArtifactsLabel: "E2E run artifacts",
      stableArtifactsDir,
    });
  }
}

async function createWebFixtureWorkspace(workspaceRoot: string): Promise<void> {
  await createFixtureWorkspace({
    workspaceRoot,
    readmeTitle: "Hive E2E Workspace",
    commitMessage: "Initialize E2E workspace",
    includeServicesTemplate: true,
    includeSetupRetryTemplate: true,
  });
}

async function cleanupOrphanedOpencodeProcesses(options: {
  currentPid: number;
  e2eRunsRoot: string;
  preserveRunRoot: string;
}): Promise<void> {
  const processTable = readProcessTable();
  const concurrentRunnerPids = processTable
    .filter(
      (entry) =>
        entry.pid !== options.currentPid &&
        entry.args.includes("src/runtime/e2e-runner.ts")
    )
    .map((entry) => entry.pid);

  if (concurrentRunnerPids.length > 0) {
    process.stdout.write(
      `Skipping stale opencode cleanup while other e2e runners are active: ${concurrentRunnerPids.join(", ")}\n`
    );
    return;
  }

  const orphanedPids = processTable
    .filter(
      (entry) =>
        entry.args.includes("opencode") &&
        entry.args.includes(options.e2eRunsRoot) &&
        !entry.args.includes(options.preserveRunRoot)
    )
    .map((entry) => entry.pid);

  const terminated = await terminateProcessIds(orphanedPids, {
    terminateWaitMs: OPENCODE_TERMINATE_WAIT_MS,
  });
  if (terminated > 0) {
    process.stdout.write(
      `Cleaned ${String(terminated)} stale opencode process(es) from previous e2e runs\n`
    );
  }
}

async function cleanupOpencodeProcessesForRunRoot(
  runRoot: string
): Promise<void> {
  const runRootPids = readProcessTable()
    .filter(
      (entry) => entry.args.includes("opencode") && entry.args.includes(runRoot)
    )
    .map((entry) => entry.pid);

  const terminated = await terminateProcessIds(runRootPids, {
    terminateWaitMs: OPENCODE_TERMINATE_WAIT_MS,
  });
  if (terminated > 0) {
    process.stdout.write(
      `Cleaned ${String(terminated)} opencode process(es) for run ${runRoot}\n`
    );
  }
}

async function createClonedWorkspace(options: {
  sourceRoot: string;
  workspaceRoot: string;
}): Promise<void> {
  await rm(options.workspaceRoot, { recursive: true, force: true });

  const branch = await resolveSourceBranch(options.sourceRoot);
  const cloneArgs = [
    "clone",
    "--no-hardlinks",
    ...(branch ? ["--branch", branch, "--single-branch"] : []),
    options.sourceRoot,
    options.workspaceRoot,
  ];

  await runCommand("git", cloneArgs, {
    cwd: repoRoot,
    label: "Clone fixture workspace",
  });
}

async function resolveSourceBranch(sourceRoot: string): Promise<string | null> {
  try {
    const branch = await runCommandCapture(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      {
        cwd: sourceRoot,
        label: "Resolve source workspace branch",
      }
    );

    if (!branch || branch === "HEAD") {
      return null;
    }

    return branch;
  } catch {
    return null;
  }
}

function resolveWorkspaceMode(): WorkspaceMode {
  const configured = process.env[WORKSPACE_MODE_ENV]?.trim().toLowerCase();
  if (!configured) {
    return DEFAULT_WORKSPACE_MODE;
  }

  if (configured === "fixture" || configured === "clone") {
    return configured;
  }

  throw new Error(
    `${WORKSPACE_MODE_ENV} must be either 'fixture' or 'clone' (received '${configured}')`
  );
}

function resolveWorkspaceSource(): string {
  const configured = process.env[WORKSPACE_SOURCE_ENV]?.trim();
  if (!configured) {
    return repoRoot;
  }

  return resolvePath(configured);
}

run().catch((error) => {
  process.stderr.write(
    `E2E runner failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
