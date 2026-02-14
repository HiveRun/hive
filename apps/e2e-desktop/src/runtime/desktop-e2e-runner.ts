import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const KEEP_ARTIFACTS = process.env.HIVE_E2E_KEEP_ARTIFACTS === "1";
const CLEANUP_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 180_000;
const TAURI_BUILD_TIMEOUT_MS = 900_000;
const SERVER_START_ATTEMPTS = 3;
const SERVER_RETRY_DELAY_MS = 1000;
const HTTP_POLL_INTERVAL_MS = 500;
const SIGTERM_EXIT_CODE = 143;
const API_READY_PATH = "/health";
const WDIO_CONFIG_PATH = "wdio.conf.mjs";
const TAURI_DRIVER_HOST = "127.0.0.1";
const DEFAULT_DRIVER_PORT = 4444;
const DEFAULT_NATIVE_DRIVER_PORT = 4445;

type ManagedProcess = {
  name: string;
  child: ReturnType<typeof spawn>;
  stdoutPath: string;
  stderrPath: string;
  processGroupId: number | null;
};

type RuntimeContext = {
  runId: string;
  runRoot: string;
  workspaceRoot: string;
  hiveHome: string;
  dbPath: string;
  logsDir: string;
  artifactsDir: string;
  apiPort: number;
  apiUrl: string;
};

type ParsedArgs = {
  spec?: string;
};

type CommandOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  label: string;
  timeoutMs?: number;
};

const modulePath = fileURLToPath(import.meta.url);
const moduleDir = dirname(modulePath);
const e2eRoot = join(moduleDir, "..", "..");
const stableArtifactsDir = join(e2eRoot, "reports", "latest");
const repoRoot = join(e2eRoot, "..", "..");
const serverRoot = join(repoRoot, "apps", "server");
const useSharedHiveHome = process.env.HIVE_E2E_SHARED_HOME === "1";
const sharedHiveHomePath = join(
  repoRoot,
  "tmp",
  "e2e-shared",
  "hive-home-desktop"
);

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const context = await createRuntimeContext({
    hiveHomePath: useSharedHiveHome ? sharedHiveHomePath : undefined,
    repoRoot,
  });
  const managedProcesses: ManagedProcess[] = [];
  let runSucceeded = false;

  try {
    if (useSharedHiveHome) {
      process.stdout.write(
        `Using shared desktop E2E HIVE_HOME: ${context.hiveHome}\n`
      );
    }

    await createFixtureWorkspace(context.workspaceRoot);

    const server = await startServerWithRetries({
      context,
      logsDir: context.logsDir,
    });
    managedProcesses.push(server);

    process.stdout.write("Building debug Tauri desktop binary...\n");
    await runCommand(
      "bun",
      ["run", "build:tauri", "--", "--debug", "--no-bundle"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          VITE_API_URL: context.apiUrl,
        },
        label: "Build debug Tauri desktop binary",
        timeoutMs: TAURI_BUILD_TIMEOUT_MS,
      }
    );

    const desktopBinaryPath = resolveDesktopBinaryPath();
    process.stdout.write(`Using desktop binary: ${desktopBinaryPath}\n`);

    const driverPort = Number(
      process.env.HIVE_E2E_DRIVER_PORT ?? String(DEFAULT_DRIVER_PORT)
    );
    const nativeDriverPort = Number(
      process.env.HIVE_E2E_NATIVE_DRIVER_PORT ??
        String(DEFAULT_NATIVE_DRIVER_PORT)
    );

    const tauriDriver = startManagedProcess({
      command: "tauri-driver",
      args: [
        "--port",
        String(driverPort),
        "--native-port",
        String(nativeDriverPort),
      ],
      cwd: repoRoot,
      env: process.env,
      logsDir: context.logsDir,
      name: "tauri-driver",
    });
    managedProcesses.push(tauriDriver);

    await waitForHttpOk(
      `http://${TAURI_DRIVER_HOST}:${String(driverPort)}/status`,
      {
        timeoutMs: STARTUP_TIMEOUT_MS,
      }
    );

    const wdioArgs = [
      "wdio",
      "run",
      WDIO_CONFIG_PATH,
      ...(args.spec ? ["--spec", args.spec] : []),
    ];

    await runCommand("bunx", wdioArgs, {
      cwd: e2eRoot,
      env: {
        ...process.env,
        HIVE_E2E_API_URL: context.apiUrl,
        HIVE_E2E_ARTIFACTS_DIR: context.artifactsDir,
        HIVE_E2E_DRIVER_HOST: TAURI_DRIVER_HOST,
        HIVE_E2E_DRIVER_PORT: String(driverPort),
        HIVE_E2E_DESKTOP_BINARY: desktopBinaryPath,
        HIVE_E2E_WORKSPACE_PATH: context.workspaceRoot,
        HIVE_E2E_HIVE_HOME: context.hiveHome,
      },
      label: "Desktop WDIO suite",
    });

    runSucceeded = true;
    process.stdout.write("Desktop E2E suite passed.\n");
  } finally {
    await Promise.all(
      [...managedProcesses]
        .reverse()
        .map((managedProcess) => stopManagedProcess(managedProcess))
    );

    await publishArtifacts(context.artifactsDir, stableArtifactsDir);
    process.stdout.write(`Desktop E2E reports: ${stableArtifactsDir}\n`);

    if (!KEEP_ARTIFACTS && runSucceeded) {
      await rm(context.runRoot, { recursive: true, force: true });
    } else {
      process.stdout.write(`Desktop E2E run artifacts: ${context.runRoot}\n`);
    }
  }
}

async function createRuntimeContext(options: {
  hiveHomePath?: string;
  repoRoot: string;
}): Promise<RuntimeContext> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
  const runRoot = join(options.repoRoot, "tmp", "e2e-desktop-runs", runId);
  const workspaceRoot = join(runRoot, "workspace");
  const hiveHome = options.hiveHomePath ?? join(runRoot, "hive-home");
  const dbPath = join(runRoot, "e2e-desktop.db");
  const logsDir = join(runRoot, "logs");
  const artifactsDir = join(runRoot, "artifacts");
  const apiPort = await resolveApiPort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;

  await Promise.all([
    mkdir(resolvePath(workspaceRoot), { recursive: true }),
    mkdir(resolvePath(hiveHome), { recursive: true }),
    mkdir(resolvePath(logsDir), { recursive: true }),
    mkdir(resolvePath(artifactsDir), { recursive: true }),
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
    apiUrl,
  };
}

async function resolveApiPort(): Promise<number> {
  const configuredPort = Number(process.env.HIVE_E2E_API_PORT ?? "");
  if (Number.isFinite(configuredPort) && configuredPort > 0) {
    return configuredPort;
  }

  return await findAvailablePort();
}

async function findAvailablePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!(address && typeof address === "object" && address.port)) {
        server.close(() => {
          reject(new Error("Failed to resolve an available port"));
        });
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
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
        CORS_ORIGIN: "tauri://localhost",
      },
      logsDir: options.logsDir,
      name: "server",
    });

    try {
      await waitForHttpOk(`${options.context.apiUrl}${API_READY_PATH}`, {
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

function resolveDesktopBinaryPath(): string {
  let candidates: string[];

  if (process.platform === "darwin") {
    candidates = [
      join(repoRoot, "src-tauri", "target", "debug", "hive-desktop"),
      join(
        repoRoot,
        "src-tauri",
        "target",
        "debug",
        "bundle",
        "macos",
        "Hive Desktop.app",
        "Contents",
        "MacOS",
        "Hive Desktop"
      ),
    ];
  } else if (process.platform === "win32") {
    candidates = [
      join(repoRoot, "src-tauri", "target", "debug", "hive-desktop.exe"),
    ];
  } else {
    candidates = [
      join(repoRoot, "src-tauri", "target", "debug", "hive-desktop"),
      join(repoRoot, "src-tauri", "target", "debug", "hive-desktop.bin"),
    ];
  }

  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(
      `Unable to locate debug desktop binary. Checked: ${candidates.join(", ")}`
    );
  }

  return resolved;
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
    "# Hive Desktop E2E Workspace\n",
    "utf8"
  );

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
      "Initialize desktop E2E workspace",
    ],
    {
      cwd: workspaceRoot,
      label: "Create fixture commit",
    }
  );
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
    const timeout =
      typeof options.timeoutMs === "number"
        ? setTimeout(() => {
            child.kill("SIGKILL");
          }, options.timeoutMs)
        : null;

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    child.on("exit", (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }
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
  const { child, processGroupId } = managedProcess;
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

async function waitForHttpOk(
  url: string,
  options: { timeoutMs: number }
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < options.timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    await wait(HTTP_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for HTTP 200 from ${url}`);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

run().catch((error) => {
  process.stderr.write(
    `Desktop E2E runner failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
