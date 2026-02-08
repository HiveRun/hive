import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeContext } from "./runtime-context";
import { waitForHttpOk } from "./wait";

const KEEP_ARTIFACTS = process.env.HIVE_E2E_KEEP_ARTIFACTS === "1";
const CLEANUP_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 180_000;
const SIGTERM_EXIT_CODE = 143;
const SERVER_READY_PATH = "/health";
const WEB_READY_PATH = "/";
const WDIO_CONFIG_PATH = "./wdio.conf.ts";
const WDIO_BIN_PATH = ["node_modules", "@wdio", "cli", "bin", "wdio.js"];

type ManagedProcess = {
  name: string;
  child: ReturnType<typeof spawn>;
  stdoutPath: string;
  stderrPath: string;
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

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const context = await createRuntimeContext({ repoRoot });
  const managedProcesses: ManagedProcess[] = [];
  let runSucceeded = false;

  try {
    await createFixtureWorkspace(context.workspaceRoot);

    const server = startManagedProcess({
      command: "bun",
      args: ["run", "src/index.ts"],
      cwd: serverRoot,
      env: {
        ...process.env,
        DATABASE_URL: `file:${context.dbPath}`,
        HIVE_HOME: context.hiveHome,
        HIVE_WORKSPACE_ROOT: context.workspaceRoot,
        HOST: "127.0.0.1",
        PORT: String(context.apiPort),
        WEB_PORT: String(context.webPort),
        CORS_ORIGIN: context.webUrl,
      },
      logsDir: context.logsDir,
      name: "server",
    });
    managedProcesses.push(server);

    await waitForHttpOk(`${context.apiUrl}${SERVER_READY_PATH}`, {
      timeoutMs: STARTUP_TIMEOUT_MS,
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

    const wdioArgs = [
      join(e2eRoot, ...WDIO_BIN_PATH),
      "run",
      WDIO_CONFIG_PATH,
      ...(args.spec ? ["--spec", args.spec] : []),
    ];

    await runCommand("node", wdioArgs, {
      cwd: e2eRoot,
      env: {
        ...process.env,
        HIVE_E2E_BASE_URL: context.webUrl,
        HIVE_E2E_API_URL: context.apiUrl,
        HIVE_E2E_ARTIFACTS_DIR: context.artifactsDir,
        NODE_OPTIONS: "--import=tsx",
      },
      label: "WebdriverIO suite",
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

function parseArgs(argv: string[]): ParsedArgs {
  const specIndex = argv.indexOf("--spec");
  const spec = specIndex >= 0 ? argv[specIndex + 1] : undefined;
  return { spec };
}

async function createFixtureWorkspace(workspaceRoot: string): Promise<void> {
  await mkdir(workspaceRoot, { recursive: true });

  const hiveConfig = {
    opencode: {
      defaultProvider: "zen",
      defaultModel: "big-pickle",
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
          providerId: "zen",
          modelId: "big-pickle",
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
    `${JSON.stringify({ model: "zen/big-pickle" }, null, 2)}\n`,
    "utf8"
  );

  await writeFile(join(workspaceRoot, "README.md"), "# Hive E2E Workspace\n");

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
  };
}

async function stopManagedProcess(
  managedProcess: ManagedProcess
): Promise<void> {
  const { child, name, stdoutPath, stderrPath } = managedProcess;
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, CLEANUP_TIMEOUT_MS);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    child.kill("SIGTERM");
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

run().catch((error) => {
  process.stderr.write(
    `E2E runner failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
