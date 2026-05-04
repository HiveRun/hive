import type { ManagedProcess } from "./process";
import { startManagedProcess, startProcessWithRetries } from "./process";
import type { RuntimeContext } from "./runtime-context";
import { waitForHttpOk } from "./wait";

type StartHiveServerOptions = {
  attempts: number;
  context: RuntimeContext;
  extraEnv: NodeJS.ProcessEnv;
  logsDir: string;
  readyPath: string;
  retryDelayMs: number;
  serverRoot: string;
  startupTimeoutMs: number;
  stopProcess: (managedProcess: ManagedProcess) => Promise<void>;
};

type StartE2eServerOptions = {
  context: RuntimeContext;
  logsDir: string;
  serverRoot: string;
  stopProcess: (managedProcess: ManagedProcess) => Promise<void>;
};

export async function startHiveServerWithRetries(
  options: StartHiveServerOptions
): Promise<ManagedProcess> {
  return await startProcessWithRetries({
    attempts: options.attempts,
    retryDelayMs: options.retryDelayMs,
    startProcess: () =>
      startManagedProcess({
        command: "bun",
        args: ["run", "src/index.ts"],
        cwd: options.serverRoot,
        env: {
          ...process.env,
          DATABASE_URL: `file:${options.context.dbPath}`,
          HIVE_HOME: options.context.hiveHome,
          HIVE_WORKSPACE_ROOT: options.context.workspaceRoot,
          HIVE_BROWSE_ROOT: options.context.runRoot,
          HIVE_OPENCODE_START_TIMEOUT_MS: "120000",
          HOST: "127.0.0.1",
          PORT: String(options.context.apiPort),
          ...options.extraEnv,
        },
        logsDir: options.logsDir,
        name: "server",
      }),
    stopProcess: options.stopProcess,
    waitUntilReady: async () => {
      await waitForHttpOk(`${options.context.apiUrl}${options.readyPath}`, {
        timeoutMs: options.startupTimeoutMs,
      });
    },
  });
}

export async function startDefaultHiveServer(options: {
  context: RuntimeContext;
  extraEnv: NodeJS.ProcessEnv;
  logsDir: string;
  readyPath: string;
  serverRoot: string;
  stopProcess: (managedProcess: ManagedProcess) => Promise<void>;
}): Promise<ManagedProcess> {
  return await startHiveServerWithRetries({
    attempts: 3,
    context: options.context,
    extraEnv: options.extraEnv,
    logsDir: options.logsDir,
    readyPath: options.readyPath,
    retryDelayMs: 1000,
    serverRoot: options.serverRoot,
    startupTimeoutMs: 180_000,
    stopProcess: options.stopProcess,
  });
}

export function startWebE2eServer(
  options: StartE2eServerOptions
): Promise<ManagedProcess> {
  return startE2eServer(options, {
    WEB_PORT: String(options.context.webPort),
    CORS_ORIGIN: options.context.webUrl,
  });
}

export function startDesktopE2eServer(
  options: StartE2eServerOptions
): Promise<ManagedProcess> {
  return startE2eServer(options, { CORS_ORIGIN: "null" });
}

async function startE2eServer(
  options: StartE2eServerOptions,
  extraEnv: NodeJS.ProcessEnv
): Promise<ManagedProcess> {
  return await startDefaultHiveServer({
    context: options.context,
    extraEnv,
    logsDir: options.logsDir,
    readyPath: "/health",
    serverRoot: options.serverRoot,
    stopProcess: options.stopProcess,
  });
}
