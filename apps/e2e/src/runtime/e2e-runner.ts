import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeContext, type RuntimeContext } from "./runtime-context";
import { waitForHttpOk } from "./wait";

const KEEP_ARTIFACTS = process.env.HIVE_E2E_KEEP_ARTIFACTS === "1";
const CLEANUP_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 180_000;
const SERVER_START_ATTEMPTS = 3;
const SERVER_RETRY_DELAY_MS = 1000;
const SIGTERM_EXIT_CODE = 143;
const OPENCODE_TERMINATE_WAIT_MS = 1000;
const SERVER_READY_PATH = "/health";
const WEB_READY_PATH = "/";
const PLAYWRIGHT_CONFIG_PATH = "playwright.config.ts";
const SECONDARY_WORKSPACE_NAME = "workspace-secondary";

type WorkspaceMode = "fixture" | "clone";

type RpcErrorRecord = {
  message?: string;
  shortMessage?: string;
};

type RpcResult<T> =
  | { success: true; data: T }
  | { success: false; errors?: RpcErrorRecord[] };

const WORKSPACE_MODE_ENV = "HIVE_E2E_WORKSPACE_MODE";
const WORKSPACE_SOURCE_ENV = "HIVE_E2E_WORKSPACE_SOURCE";
const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "clone";

type ManagedProcess = {
  name: string;
  child: ReturnType<typeof spawn>;
  stdoutPath: string;
  stderrPath: string;
  processGroupId: number | null;
};

type ParsedArgs = {
  spec?: string;
};

type CommandOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  label: string;
};

const modulePath = fileURLToPath(import.meta.url);
const moduleDir = dirname(modulePath);
const e2eRoot = join(moduleDir, "..", "..");
const stableArtifactsDir = join(e2eRoot, "reports", "latest");
const repoRoot = join(e2eRoot, "..", "..");
const serverElixirRoot = join(repoRoot, "apps", "hive_server_elixir");
const webRoot = join(repoRoot, "apps", "web");
const e2eRunsRoot = join(repoRoot, "tmp", "e2e-runs");
const useSharedHiveHome = process.env.HIVE_E2E_SHARED_HOME === "1";
const sharedHiveHomePath = join(repoRoot, "tmp", "e2e-shared", "hive-home");

type ProcessEntry = {
  pid: number;
  args: string;
};

async function run() {
  const args = parseArgs(process.argv.slice(2));
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
      await syncWorkingTreeChangesIntoClone({
        sourceRoot: workspaceSource,
        workspaceRoot: context.workspaceRoot,
      });
      await createClonedWorkspace({
        sourceRoot: workspaceSource,
        workspaceRoot: secondaryWorkspaceRoot,
      });
      await syncWorkingTreeChangesIntoClone({
        sourceRoot: workspaceSource,
        workspaceRoot: secondaryWorkspaceRoot,
      });
      await addCloneOnlyE2ETemplates(context.workspaceRoot);
      await addCloneOnlyE2ETemplates(secondaryWorkspaceRoot);
    } else {
      await createFixtureWorkspace(context.workspaceRoot);
      await createFixtureWorkspace(secondaryWorkspaceRoot);
    }

    const server = await startServerWithRetries({
      context,
      logsDir: context.logsDir,
    });
    managedProcesses.push(server);

    await registerWorkspace({
      apiUrl: context.apiUrl,
      path: context.workspaceRoot,
      activate: true,
    });

    await registerWorkspace({
      apiUrl: context.apiUrl,
      path: secondaryWorkspaceRoot,
      activate: false,
    });

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

    const playwrightArgs = [
      "playwright",
      "test",
      "--config",
      PLAYWRIGHT_CONFIG_PATH,
      ...(args.spec ? [args.spec] : []),
    ];

    await runCommand("bunx", playwrightArgs, {
      cwd: e2eRoot,
      env: {
        ...process.env,
        HIVE_E2E_BASE_URL: context.webUrl,
        HIVE_E2E_API_URL: context.apiUrl,
        HIVE_E2E_ARTIFACTS_DIR: context.artifactsDir,
        HIVE_E2E_WORKSPACE_PATH: context.workspaceRoot,
        HIVE_E2E_SECOND_WORKSPACE_PATH: secondaryWorkspaceRoot,
        HIVE_E2E_HIVE_HOME: context.hiveHome,
      },
      label: "Playwright suite",
    });

    runSucceeded = true;
    process.stdout.write("E2E suite passed.\n");
  } finally {
    await Promise.all(
      [...managedProcesses]
        .reverse()
        .map((managedProcess) => stopManagedProcess(managedProcess))
    );

    await cleanupOpencodeProcessesForRunRoot(context.runRoot);

    await publishArtifacts(context.artifactsDir, stableArtifactsDir);
    process.stdout.write(`E2E reports: ${stableArtifactsDir}\n`);

    if (!KEEP_ARTIFACTS && runSucceeded) {
      await rm(context.runRoot, { recursive: true, force: true });
    } else {
      process.stdout.write(`E2E run artifacts: ${context.runRoot}\n`);
    }
  }
}

async function publishArtifacts(
  sourceArtifactsDir: string,
  targetArtifactsDir: string
): Promise<void> {
  await rm(targetArtifactsDir, { recursive: true, force: true });
  await mkdir(targetArtifactsDir, { recursive: true });
  await cp(sourceArtifactsDir, targetArtifactsDir, { recursive: true });
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

  const terminated = await terminateProcessIds(orphanedPids);
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

  const terminated = await terminateProcessIds(runRootPids);
  if (terminated > 0) {
    process.stdout.write(
      `Cleaned ${String(terminated)} opencode process(es) for run ${runRoot}\n`
    );
  }
}

function readProcessTable(): ProcessEntry[] {
  let output = "";
  try {
    output = execFileSync("ps", ["-eo", "pid,args"], {
      encoding: "utf8",
    });
  } catch {
    return [];
  }

  const entries: ProcessEntry[] = [];
  for (const line of output.split("\n").slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const firstSpace = trimmed.indexOf(" ");
    if (firstSpace <= 0) {
      continue;
    }

    const pid = Number(trimmed.slice(0, firstSpace));
    const args = trimmed.slice(firstSpace + 1).trim();
    if (!(Number.isFinite(pid) && args)) {
      continue;
    }

    entries.push({ args, pid });
  }

  return entries;
}

async function terminateProcessIds(pids: number[]): Promise<number> {
  const uniquePids = [...new Set(pids)].filter((pid) => Number.isFinite(pid));
  if (uniquePids.length === 0) {
    return 0;
  }

  for (const pid of uniquePids) {
    sendSignalSafe(pid, "SIGTERM");
  }

  await wait(OPENCODE_TERMINATE_WAIT_MS);

  const stillRunning = new Set(readProcessTable().map((entry) => entry.pid));
  const remaining = uniquePids.filter((pid) => stillRunning.has(pid));

  for (const pid of remaining) {
    sendSignalSafe(pid, "SIGKILL");
  }

  return uniquePids.length;
}

function sendSignalSafe(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
  }
}

async function startServerWithRetries(options: {
  context: RuntimeContext;
  logsDir: string;
}): Promise<ManagedProcess> {
  const elixirEnv: NodeJS.ProcessEnv = {
    ...process.env,
    MIX_ENV: "prod",
    PHX_SERVER: "true",
    SECRET_KEY_BASE:
      "hive-e2e-secret-key-base-dev-only-0001-0002-0003-0004-0005-0006-0007",
    DATABASE_PATH: options.context.dbPath,
    HIVE_HOME: options.context.hiveHome,
    HIVE_WORKSPACE_ROOT: options.context.workspaceRoot,
    HIVE_BROWSE_ROOT: options.context.runRoot,
    HIVE_OPENCODE_START_TIMEOUT_MS: "120000",
    HOST: "127.0.0.1",
    PORT: String(options.context.apiPort),
    CORS_ORIGIN: options.context.webUrl,
  };

  const runtimeEnvOverrideArgs = [
    "env",
    `PORT=${String(options.context.apiPort)}`,
    `PHX_PORT=${String(options.context.apiPort)}`,
    `BACKEND_PORT=${String(options.context.apiPort)}`,
    `BACKEND_URL=${options.context.apiUrl}`,
    `VITE_API_URL=${options.context.apiUrl}`,
    `VITE_BACKEND_URL=${options.context.apiUrl}`,
    `FRONTEND_PORT=${String(options.context.webPort)}`,
    `FRONTEND_URL=${options.context.webUrl}`,
  ];

  await runCommand(
    "mise",
    ["x", "-C", ".", "--", ...runtimeEnvOverrideArgs, "mix", "ecto.migrate"],
    {
      cwd: serverElixirRoot,
      env: elixirEnv,
      label: "Migrate Elixir E2E database",
    }
  );

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= SERVER_START_ATTEMPTS; attempt += 1) {
    const server = startManagedProcess({
      command: "mise",
      args: [
        "x",
        "-C",
        ".",
        "--",
        ...runtimeEnvOverrideArgs,
        "mix",
        "phx.server",
      ],
      cwd: serverElixirRoot,
      env: elixirEnv,
      logsDir: options.logsDir,
      name: "server",
    });

    try {
      await waitForHttpOk(`${options.context.apiUrl}${SERVER_READY_PATH}`, {
        timeoutMs: STARTUP_TIMEOUT_MS,
      });
      return server;
    } catch (error) {
      await stopManagedProcess(server);

      lastError =
        error instanceof Error
          ? error
          : new Error(`Server startup attempt ${String(attempt)} failed`);

      if (attempt >= SERVER_START_ATTEMPTS) {
        break;
      }

      process.stderr.write(
        `Server startup attempt ${String(attempt)} failed, retrying...\n`
      );
      await wait(SERVER_RETRY_DELAY_MS);
    }
  }

  throw (
    lastError ?? new Error("Server failed to start and no error was captured")
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const specIndex = argv.indexOf("--spec");
  const spec = specIndex >= 0 ? argv[specIndex + 1] : undefined;
  return { spec };
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

  await writeFile(join(workspaceRoot, "README.md"), "# Hive E2E Workspace\n");

  await writeFile(join(workspaceRoot, ".hive-setup-pass"), "ok\n", "utf8");

  await runCommand("git", ["init"], {
    cwd: workspaceRoot,
    label: "Initialize fixture git repository",
  });
  await runCommand("git", ["add", "."], {
    cwd: workspaceRoot,
    label: "Stage fixture files",
  });
  await runCommand(
    "git",
    [
      "-c",
      "user.name=Hive E2E",
      "-c",
      "user.email=hive-e2e@example.com",
      "commit",
      "-m",
      "Initialize E2E workspace",
    ],
    {
      cwd: workspaceRoot,
      label: "Create fixture commit",
    }
  );
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

async function addCloneOnlyE2ETemplates(workspaceRoot: string): Promise<void> {
  const hiveConfigPath = join(workspaceRoot, "hive.config.json");
  const rawConfig = await readFile(hiveConfigPath, "utf8");
  const parsed = JSON.parse(rawConfig) as {
    templates?: Record<string, unknown>;
  };

  const nextConfig = {
    ...parsed,
    templates: {
      ...(parsed.templates ?? {}),
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
    hiveConfigPath,
    `${JSON.stringify(nextConfig, null, 2)}\n`,
    "utf8"
  );
}

async function syncWorkingTreeChangesIntoClone(options: {
  sourceRoot: string;
  workspaceRoot: string;
}): Promise<void> {
  const changedFiles = listGitPaths(options.sourceRoot, [
    "diff",
    "--name-only",
    "--diff-filter=ACMRTUXB",
    "HEAD",
  ]);
  const deletedFiles = listGitPaths(options.sourceRoot, [
    "diff",
    "--name-only",
    "--diff-filter=D",
    "HEAD",
  ]);
  const untrackedFiles = listGitPaths(options.sourceRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);

  for (const relativePath of [...changedFiles, ...untrackedFiles]) {
    const sourcePath = join(options.sourceRoot, relativePath);
    const destinationPath = join(options.workspaceRoot, relativePath);

    await mkdir(dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath, { force: true, recursive: true });
  }

  for (const relativePath of deletedFiles) {
    await rm(join(options.workspaceRoot, relativePath), {
      recursive: true,
      force: true,
    });
  }
}

function listGitPaths(cwd: string, args: string[]): string[] {
  const output = execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return output
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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

async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";

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
          `${options.label} failed (exit ${String(
            code
          )})\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
        )
      );
    });
  });
}

async function registerWorkspace(options: {
  apiUrl: string;
  path: string;
  activate: boolean;
}): Promise<void> {
  const response = await fetch(`${options.apiUrl}/rpc/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "register_workspace",
      input: {
        path: options.path,
        activate: options.activate,
      },
      fields: ["id"],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to register workspace ${options.path} (status ${response.status}): ${body}`
    );
  }

  const payload = (await response.json()) as RpcResult<{ id: string }>;

  if (payload.success) {
    return;
  }

  throw new Error(
    `Failed to register workspace ${options.path}: ${payload.errors?.[0]?.shortMessage ?? payload.errors?.[0]?.message ?? "unknown RPC error"}`
  );
}

async function runCommandCapture(
  command: string,
  args: string[],
  options: CommandOptions
): Promise<string> {
  return await new Promise<string>((resolveOutput, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveOutput(stdout.trim());
        return;
      }
      reject(
        new Error(
          `${options.label} failed (exit ${String(
            code
          )})\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
        )
      );
    });
  });
}

function startManagedProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logsDir: string;
  name: string;
}): ManagedProcess {
  const stdoutPath = join(options.logsDir, `${options.name}.stdout.log`);
  const stderrPath = join(options.logsDir, `${options.name}.stderr.log`);
  const stdoutStream = createWriteStream(stdoutPath, { flags: "a" });
  const stderrStream = createWriteStream(stderrPath, { flags: "a" });

  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.pipe(stdoutStream);
  child.stderr?.pipe(stderrStream);

  child.on("exit", (code) => {
    stdoutStream.end();
    stderrStream.end();
    if (code !== null && code !== 0 && code !== SIGTERM_EXIT_CODE) {
      process.stderr.write(
        `${options.name} exited unexpectedly with code ${String(code)}\n`
      );
    }
  });

  return {
    name: options.name,
    child,
    stdoutPath,
    stderrPath,
    processGroupId: process.platform !== "win32" ? (child.pid ?? null) : null,
  };
}

async function stopManagedProcess(
  managedProcess: ManagedProcess
): Promise<void> {
  const { child, name, stdoutPath, stderrPath, processGroupId } =
    managedProcess;
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      sendManagedProcessSignal(child, processGroupId, "SIGKILL");
    }, CLEANUP_TIMEOUT_MS);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    sendManagedProcessSignal(child, processGroupId, "SIGTERM");
  });

  const missingLogs = [stdoutPath, stderrPath].filter(
    (path) => !existsSync(path)
  );
  if (missingLogs.length > 0) {
    process.stderr.write(
      `Warning: missing ${name} log files: ${missingLogs.join(", ")}\n`
    );
  }
}

function sendManagedProcessSignal(
  child: ReturnType<typeof spawn>,
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

  if (child.exitCode !== null || child.killed) {
    return;
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

run().catch((error) => {
  process.stderr.write(
    `E2E runner failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
