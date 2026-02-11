import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
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
const SERVER_READY_PATH = "/health";
const WEB_READY_PATH = "/";
const PLAYWRIGHT_CONFIG_PATH = "playwright.config.ts";
const SECONDARY_WORKSPACE_NAME = "workspace-secondary";

type WorkspaceMode = "fixture" | "clone";

const WORKSPACE_MODE_ENV = "HIVE_E2E_WORKSPACE_MODE";
const WORKSPACE_SOURCE_ENV = "HIVE_E2E_WORKSPACE_SOURCE";
const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "fixture";

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
const serverRoot = join(repoRoot, "apps", "server");
const webRoot = join(repoRoot, "apps", "web");
const useSharedHiveHome = process.env.HIVE_E2E_SHARED_HOME === "1";
const sharedHiveHomePath = join(repoRoot, "tmp", "e2e-shared", "hive-home");

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
      await createFixtureWorkspace(secondaryWorkspaceRoot);
    } else {
      await createFixtureWorkspace(context.workspaceRoot);
      await createFixtureWorkspace(secondaryWorkspaceRoot);
    }

    const server = await startServerWithRetries({
      context,
      logsDir: context.logsDir,
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

async function startServerWithRetries(options: {
  context: RuntimeContext;
  logsDir: string;
}): Promise<ManagedProcess> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= SERVER_START_ATTEMPTS; attempt += 1) {
    const server = startManagedProcess({
      command: "bun",
      args: ["run", "src/index.ts"],
      cwd: serverRoot,
      env: {
        ...process.env,
        DATABASE_URL: `file:${options.context.dbPath}`,
        HIVE_HOME: options.context.hiveHome,
        HIVE_WORKSPACE_ROOT: options.context.workspaceRoot,
        HIVE_BROWSE_ROOT: options.context.runRoot,
        HIVE_OPENCODE_START_TIMEOUT_MS: "120000",
        HOST: "127.0.0.1",
        PORT: String(options.context.apiPort),
        WEB_PORT: String(options.context.webPort),
        CORS_ORIGIN: options.context.webUrl,
      },
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
