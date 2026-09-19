import { existsSync } from "node:fs";
import { join } from "node:path";
import { finishRuntimeRun } from "../../../e2e/src/runtime/artifacts";
import { collectRuntimeCleanupFailures } from "../../../e2e/src/runtime/cleanup";
import { throwRunAndCleanupErrors } from "../../../e2e/src/runtime/errors";
import { createFixtureWorkspace } from "../../../e2e/src/runtime/fixture-workspace";
import {
  type MockLlmServer,
  startMockLlmServer,
} from "../../../e2e/src/runtime/mock-llm-server";
import {
  parseSpecArg,
  resolveRuntimePaths,
} from "../../../e2e/src/runtime/paths";
import { runPlaywrightSuite } from "../../../e2e/src/runtime/playwright";
import {
  createManagedProcessStopper,
  type ManagedProcess,
  runCommand,
} from "../../../e2e/src/runtime/process";
import { createRuntimeContext } from "../../../e2e/src/runtime/runtime-context";
import {
  cleanupRegisteredOpencodeServices,
  startDesktopE2eServer,
} from "../../../e2e/src/runtime/server";
import { resolveOpencodeBinary } from "../../../server/src/agents/opencode-binary";

const KEEP_ARTIFACTS = process.env.HIVE_E2E_KEEP_ARTIFACTS === "1";
const CLEANUP_TIMEOUT_MS = 15_000;
const BUILD_TIMEOUT_MS = 900_000;

const { e2eRoot, repoRoot, serverRoot, stableArtifactsDir } =
  resolveRuntimePaths(import.meta.url);
const desktopRoot = join(repoRoot, "apps", "desktop-electron");
const desktopMainEntry = join(desktopRoot, "dist", "main.js");
const desktopRendererEntry = join(
  repoRoot,
  "apps",
  "web",
  "dist",
  "index.html"
);
const desktopRunsRoot = join(repoRoot, "tmp", "e2e-desktop-runs");
const stopManagedProcess = createManagedProcessStopper({
  cleanupTimeoutMs: CLEANUP_TIMEOUT_MS,
});

function resolvePackagedDesktopExecutable(): string {
  let candidates: string[];
  if (process.platform === "darwin") {
    candidates = [
      join(
        desktopRoot,
        "out",
        "mac",
        "Hive Desktop.app",
        "Contents",
        "MacOS",
        "Hive Desktop"
      ),
    ];
  } else if (process.platform === "win32") {
    candidates = [join(desktopRoot, "out", "win-unpacked", "Hive Desktop.exe")];
  } else {
    candidates = [join(desktopRoot, "out", "linux-unpacked", "hive-desktop")];
  }

  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(
      `Unable to locate packaged desktop executable. Checked: ${candidates.join(", ")}`
    );
  }

  return executable;
}

async function run() {
  const spec = parseSpecArg(process.argv.slice(2));
  const context = await createRuntimeContext({
    dbFileName: "e2e-desktop.db",
    includeWebPort: false,
    repoRoot,
    runsDirectory: ["tmp", "e2e-desktop-runs"],
  });
  const managedProcesses: ManagedProcess[] = [];
  let mockLlmServer: MockLlmServer | undefined;
  let runSucceeded = false;

  let runError: unknown;
  let cleanupError: unknown;
  try {
    await cleanupOrphanedOpencodeServices(context.runRoot);
    mockLlmServer = startMockLlmServer();
    await createDesktopFixtureWorkspace(
      context.workspaceRoot,
      mockLlmServer.baseUrl
    );

    const server = await startDesktopE2eServer({
      context,
      logsDir: context.logsDir,
      opencodeBinaryPath: resolveOpencodeBinary(),
      serverRoot,
      stopProcess: stopManagedProcess,
    });
    managedProcesses.push(server);

    process.stdout.write("Building desktop renderer assets...\n");
    await runCommand("bun", ["run", "build"], {
      cwd: join(repoRoot, "apps", "web"),
      label: "Build web app for desktop",
      env: {
        ...process.env,
        VITE_API_URL: context.apiUrl,
        VITE_APP_BASE: "./",
      },
      streamOutput: true,
      timeoutMs: BUILD_TIMEOUT_MS,
    });

    process.stdout.write("Packaging Electron desktop runtime...\n");
    await runCommand("bun", ["run", "package"], {
      cwd: desktopRoot,
      label: "Package desktop electron runtime",
      streamOutput: true,
      timeoutMs: BUILD_TIMEOUT_MS,
    });

    const desktopPackagedExecutable = resolvePackagedDesktopExecutable();

    await runPlaywrightSuite({
      context,
      e2eRoot,
      extraEnv: {
        HIVE_E2E_BUN_EXECUTABLE: process.execPath,
        HIVE_E2E_DESKTOP_MAIN_ENTRY: desktopMainEntry,
        HIVE_E2E_DESKTOP_PACKAGED_EXECUTABLE: desktopPackagedExecutable,
        HIVE_E2E_DESKTOP_RENDERER_ENTRY: desktopRendererEntry,
      },
      label: "Desktop Playwright suite",
      spec,
      streamOutput: true,
    });

    runSucceeded = true;
    process.stdout.write("Desktop E2E suite passed.\n");
  } catch (error) {
    runError = error;
  } finally {
    const cleanupFailures: unknown[] = [];
    await collectRuntimeCleanupFailures({
      context,
      failures: cleanupFailures,
      managedProcesses,
      mockLlmServer,
      stopProcess: stopManagedProcess,
    });

    try {
      await finishRuntimeRun({
        artifactsDir: context.artifactsDir,
        keepArtifacts: KEEP_ARTIFACTS,
        reportsLabel: "Desktop E2E reports",
        runRoot: context.runRoot,
        runSucceeded: runSucceeded && cleanupFailures.length === 0,
        runArtifactsLabel: "Desktop E2E run artifacts",
        stableArtifactsDir,
      });
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (cleanupFailures.length > 0) {
      cleanupError = new AggregateError(
        cleanupFailures,
        "Desktop E2E cleanup and artifact finalization failed"
      );
    }
  }
  throwRunAndCleanupErrors(
    runError,
    cleanupError,
    "Desktop E2E run and cleanup failed"
  );
}

async function cleanupOrphanedOpencodeServices(
  preserveRunRoot: string
): Promise<void> {
  const stopped = await cleanupRegisteredOpencodeServices({
    preserveRunRoot,
    runsRoot: desktopRunsRoot,
  });
  if (stopped > 0) {
    process.stdout.write(
      `Cleaned ${String(stopped)} stale opencode service(s) from previous desktop e2e runs\n`
    );
  }
}

async function createDesktopFixtureWorkspace(
  workspaceRoot: string,
  llmBaseUrl: string
): Promise<void> {
  await createFixtureWorkspace({
    workspaceRoot,
    readmeTitle: "Hive Desktop E2E Workspace",
    commitMessage: "Initialize desktop E2E workspace",
    llmBaseUrl,
  });
}

run().catch((error) => {
  process.stderr.write(
    `Desktop E2E runner failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
