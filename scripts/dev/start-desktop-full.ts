import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  resolveDefaultDevHiveHome,
  resolveWorkspaceRoot,
} from "./local-hive-home";

const DEFAULT_DESKTOP_URL = "http://127.0.0.1:3001";
const DEFAULT_BACKEND_URL = "http://127.0.0.1:3000";
const DEV_SERVER_TIMEOUT_MS = 120_000;
const DEV_SERVER_POLL_INTERVAL_MS = 500;
const FETCH_TIMEOUT_MS = 2000;
const MAX_PORT_NUMBER = 65_535;
const SHUTDOWN_TIMEOUT_MS = 300_000;
const FORCED_SHUTDOWN_TIMEOUT_MS = 5000;
const SHUTDOWN_POLL_INTERVAL_MS = 100;
const TASKKILL_TIMEOUT_MS = 5000;

type ChildExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

type DesktopDevConfiguration = {
  apiCommand: string;
  backendUrl: string;
  desktopCommand: string;
  desktopUrl: string;
  env: NodeJS.ProcessEnv;
  healthUrl: string;
  readyFilePath: string;
  readyToken: string;
  rendererCommand: string;
  rendererReadyFilePath: string;
  workspaceRoot: string;
};

export async function resolveDesktopDevConfiguration(
  currentDir = process.cwd(),
  sourceEnv: NodeJS.ProcessEnv = process.env,
  processId = process.pid
): Promise<DesktopDevConfiguration> {
  const workspaceRoot = resolveWorkspaceRoot(currentDir);
  const hiveHome = sourceEnv.HIVE_HOME ?? resolveDefaultDevHiveHome(currentDir);
  const backend = normalizeLoopbackUrl(
    sourceEnv.HIVE_DESKTOP_BACKEND_URL ??
      sourceEnv.VITE_API_URL ??
      DEFAULT_BACKEND_URL,
    "Hive desktop backend URL"
  );
  const backendPort = resolveUrlPort(backend);

  if (!(await isPortAvailable(backend.hostname, backendPort))) {
    throw new Error(
      `Hive desktop API port ${backendPort} is already in use at ${backend.origin}. Stop the existing Hive process or set HIVE_DESKTOP_BACKEND_URL to a free loopback port.`
    );
  }

  const requestedDesktop = normalizeLoopbackUrl(
    sourceEnv.HIVE_DESKTOP_URL ?? DEFAULT_DESKTOP_URL,
    "Hive desktop renderer URL"
  );
  const desktop = new URL(requestedDesktop);
  if (resolveUrlPort(desktop) === backendPort) {
    desktop.port = String(backendPort + 1);
  }
  const desktopPort = resolveUrlPort(desktop);
  const backendUrl = trimTrailingSlash(backend.href);
  const desktopUrl = trimTrailingSlash(desktop.href);
  const healthUrl =
    sourceEnv.HIVE_DESKTOP_HEALTH_URL?.trim() || `${backendUrl}/health`;
  const readyFilePath = join(hiveHome, `desktop-dev-ready-${processId}.pid`);
  const rendererReadyFilePath = join(
    hiveHome,
    `desktop-renderer-ready-${processId}.json`
  );
  const readyToken = randomUUID();

  return {
    apiCommand:
      sourceEnv.HIVE_DESKTOP_FULL_API_COMMAND ??
      "turbo run dev --filter=@hive/server...",
    backendUrl,
    desktopCommand:
      sourceEnv.HIVE_DESKTOP_FULL_DESKTOP_COMMAND ??
      "bun run --cwd apps/desktop-electron start",
    desktopUrl,
    env: {
      ...sourceEnv,
      HIVE_DESKTOP_BACKEND_URL: backendUrl,
      HIVE_DESKTOP_API_PORT: String(backendPort),
      HIVE_DESKTOP_DEV_HOST: desktop.hostname,
      HIVE_DESKTOP_DEV_PORT: String(desktopPort),
      HIVE_DESKTOP_HEALTH_URL: healthUrl,
      HIVE_DESKTOP_RENDERER_READY_FILE: rendererReadyFilePath,
      HIVE_DESKTOP_READY_TOKEN: readyToken,
      HIVE_DESKTOP_URL: desktopUrl,
      HIVE_HOME: hiveHome,
      HIVE_READY_FILE: readyFilePath,
      HIVE_WORKSPACE_ROOT: workspaceRoot,
      VITE_API_URL: backendUrl,
      WEB_PORT: String(desktopPort),
    },
    healthUrl,
    readyFilePath,
    readyToken,
    rendererCommand:
      sourceEnv.HIVE_DESKTOP_FULL_RENDERER_COMMAND ??
      "turbo run dev --filter=web",
    rendererReadyFilePath,
    workspaceRoot,
  };
}

export async function runDesktopDev() {
  const configuration = await resolveDesktopDevConfiguration();
  const children: ChildProcess[] = [];
  const shutdownSignal = createShutdownSignal();
  const shutdownOutcome = shutdownSignal.promise.then((signal) => ({
    type: "signal" as const,
    signal,
  }));

  process.stdout.write(
    `Starting Hive desktop renderer at or above ${configuration.desktopUrl} with API ${configuration.backendUrl}\n`
  );

  try {
    await Promise.all([
      rm(configuration.readyFilePath, { force: true }),
      rm(configuration.rendererReadyFilePath, { force: true }),
    ]);
    const apiProcess = spawnCommand(configuration.apiCommand, configuration);
    children.push(apiProcess);
    const apiExit = waitForChildExit(apiProcess);

    const apiStartupOutcome = await Promise.race([
      waitForHiveApi(configuration).then(() => ({ type: "ready" as const })),
      apiExit.then((exit) => ({ type: "api-exit" as const, exit })),
      shutdownOutcome,
    ]);

    if (apiStartupOutcome.type === "signal") {
      return { code: null, signal: apiStartupOutcome.signal };
    }
    if (apiStartupOutcome.type === "api-exit") {
      throw new Error(
        `Hive API exited before becoming ready (${describeExit(apiStartupOutcome.exit)})`
      );
    }

    const rendererProcess = spawnCommand(
      configuration.rendererCommand,
      configuration
    );
    children.push(rendererProcess);
    const rendererExit = waitForChildExit(rendererProcess);
    const rendererStartupOutcome = await Promise.race([
      waitForRenderer(configuration).then(() => ({ type: "ready" as const })),
      apiExit.then((exit) => ({ type: "api-exit" as const, exit })),
      rendererExit.then((exit) => ({ type: "renderer-exit" as const, exit })),
      shutdownOutcome,
    ]);

    if (rendererStartupOutcome.type === "signal") {
      return { code: null, signal: rendererStartupOutcome.signal };
    }
    if (rendererStartupOutcome.type !== "ready") {
      throw new Error(
        `${rendererStartupOutcome.type === "api-exit" ? "Hive API" : "Desktop renderer"} exited before the renderer became ready (${describeExit(rendererStartupOutcome.exit)})`
      );
    }

    const desktopProcess = spawnCommand(
      configuration.desktopCommand,
      configuration
    );
    children.push(desktopProcess);
    const desktopExit = waitForChildExit(desktopProcess);

    const outcome = await Promise.race([
      apiExit.then((exit) => ({ type: "exit" as const, exit })),
      rendererExit.then((exit) => ({ type: "exit" as const, exit })),
      desktopExit.then((exit) => ({ type: "exit" as const, exit })),
      shutdownOutcome,
    ]);

    return outcome.type === "signal"
      ? { code: null, signal: outcome.signal }
      : outcome.exit;
  } finally {
    try {
      await shutdown(children, shutdownSignal.forcePromise);
    } finally {
      shutdownSignal.dispose();
      await Promise.all([
        rm(configuration.readyFilePath, { force: true }),
        rm(configuration.rendererReadyFilePath, { force: true }),
      ]);
    }
  }
}

function normalizeLoopbackUrl(value: string, label: string) {
  const url = new URL(value);
  if (url.protocol !== "http:") {
    throw new Error(`${label} must use http`);
  }
  if (
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1"
  ) {
    url.hostname = "127.0.0.1";
  }
  if (url.hostname !== "127.0.0.1") {
    throw new Error(`${label} must use a loopback hostname`);
  }
  return url;
}

function resolveUrlPort(url: URL) {
  const port = Number(url.port || "80");
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT_NUMBER) {
    throw new Error(`Invalid port in URL: ${url.href}`);
  }
  return port;
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isPortAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer((socket) => socket.destroy());
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => resolve(!error));
    });
  });
}

function spawnCommand(command: string, configuration: DesktopDevConfiguration) {
  return spawn(command, {
    cwd: configuration.workspaceRoot,
    detached: process.platform !== "win32",
    env: configuration.env,
    shell: true,
    stdio: "inherit",
  });
}

function waitForChildExit(child: ChildProcess): Promise<ChildExit> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForRenderer(configuration: DesktopDevConfiguration) {
  await waitForCondition(
    `Hive desktop renderer starting at ${configuration.desktopUrl}`,
    async () => {
      const marker = JSON.parse(
        await readFile(configuration.rendererReadyFilePath, "utf8")
      ) as { pid?: unknown; port?: unknown; readyToken?: unknown };
      if (
        marker.readyToken !== configuration.readyToken ||
        !Number.isInteger(marker.pid) ||
        (marker.pid as number) < 1 ||
        !isPidAlive(marker.pid as number) ||
        !Number.isInteger(marker.port) ||
        (marker.port as number) < 1 ||
        (marker.port as number) > MAX_PORT_NUMBER
      ) {
        return false;
      }
      const rendererUrl = new URL(configuration.desktopUrl);
      rendererUrl.port = String(marker.port);
      const desktopUrl = trimTrailingSlash(rendererUrl.href);
      const response = await fetchWithTimeout(desktopUrl);
      const owned =
        response.ok &&
        response.headers.get("x-hive-desktop-ready") ===
          configuration.readyToken;
      if (owned) {
        configuration.desktopUrl = desktopUrl;
        configuration.env.HIVE_DESKTOP_URL = desktopUrl;
        configuration.env.WEB_PORT = String(marker.port);
        process.stdout.write(`Hive desktop renderer ready at ${desktopUrl}\n`);
      }
      return owned;
    }
  );
}

async function waitForHiveApi(configuration: DesktopDevConfiguration) {
  await waitForCondition(`Hive API at ${configuration.healthUrl}`, async () => {
    const readyPid = Number(
      (await readFile(configuration.readyFilePath, "utf8")).trim()
    );
    if (!(Number.isInteger(readyPid) && readyPid > 0 && isPidAlive(readyPid))) {
      return false;
    }

    const response = await fetchWithTimeout(configuration.healthUrl);
    if (
      !response.ok ||
      response.headers.get("x-hive-desktop-ready") !== configuration.readyToken
    ) {
      return false;
    }
    const payload = (await response.json()) as {
      service?: unknown;
      status?: unknown;
    };
    return payload.service === "hive" && payload.status === "ok";
  });
}

async function waitForCondition(
  description: string,
  probe: () => Promise<boolean>
) {
  const timeoutAt = Date.now() + DEV_SERVER_TIMEOUT_MS;

  while (Date.now() < timeoutAt) {
    try {
      if (await probe()) {
        return;
      }
    } catch {
      // Keep polling until this launcher-owned service is ready.
    }

    await delay(DEV_SERVER_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for ${description}`);
}

function fetchWithTimeout(url: string) {
  return fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

function isPidAlive(pid: number) {
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  return alive;
}

function createShutdownSignal() {
  let resolveSignal!: (signal: NodeJS.Signals) => void;
  let resolveForce!: () => void;
  let receivedSignal = false;
  const promise = new Promise<NodeJS.Signals>((resolve) => {
    resolveSignal = resolve;
  });
  const forcePromise = new Promise<void>((resolve) => {
    resolveForce = resolve;
  });
  const handleSignal = (signal: NodeJS.Signals) => {
    if (receivedSignal) {
      resolveForce();
      return;
    }
    receivedSignal = true;
    resolveSignal(signal);
  };
  const handleSigint = () => handleSignal("SIGINT");
  const handleSigterm = () => handleSignal("SIGTERM");
  const handleSighup = () => handleSignal("SIGHUP");
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);
  if (process.platform !== "win32") {
    process.on("SIGHUP", handleSighup);
  }

  return {
    dispose: () => {
      process.off("SIGINT", handleSigint);
      process.off("SIGTERM", handleSigterm);
      if (process.platform !== "win32") {
        process.off("SIGHUP", handleSighup);
      }
    },
    forcePromise,
    promise,
  };
}

async function shutdown(children: ChildProcess[], forcePromise: Promise<void>) {
  await settleTreeSignals(
    children.map((child) => signalProcessTree(child, "SIGTERM"))
  );

  const exitedGracefully = await Promise.race([
    waitForProcessTreesExit(children, SHUTDOWN_TIMEOUT_MS),
    forcePromise.then(() => false),
  ]);

  if (exitedGracefully) {
    return;
  }

  await settleTreeSignals(
    children
      .filter(isProcessTreeAlive)
      .map((child) => signalProcessTree(child, "SIGKILL"))
  );
  await waitForProcessTreesExit(children, FORCED_SHUTDOWN_TIMEOUT_MS);
}

async function settleTreeSignals(signals: Promise<void>[]) {
  const outcomes = await Promise.allSettled(signals);
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      process.stderr.write(
        `Failed to signal process tree: ${String(outcome.reason)}\n`
      );
    }
  }
}

async function waitForProcessTreesExit(
  children: ChildProcess[],
  timeoutMs: number
) {
  const timeoutAt = Date.now() + timeoutMs;
  while (children.some(isProcessTreeAlive) && Date.now() < timeoutAt) {
    await delay(SHUTDOWN_POLL_INTERVAL_MS);
  }
  return children.every((child) => !isProcessTreeAlive(child));
}

function isProcessTreeAlive(child: ChildProcess) {
  if (!child.pid) {
    return false;
  }
  if (process.platform === "win32") {
    return child.exitCode === null && child.signalCode === null;
  }

  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (!(child.pid && isProcessTreeAlive(child))) {
    return;
  }

  try {
    if (process.platform === "win32") {
      const taskkill = spawn(
        "taskkill",
        [
          "/pid",
          String(child.pid),
          "/t",
          ...(signal === "SIGKILL" ? ["/f"] : []),
        ],
        { stdio: "ignore", windowsHide: true }
      );
      const taskkillExit = waitForChildExit(taskkill).then(
        (taskkillResult) => ({
          exit: taskkillResult,
          timedOut: false as const,
        })
      );
      const outcome = await Promise.race([
        taskkillExit,
        delay(TASKKILL_TIMEOUT_MS).then(() => ({ timedOut: true as const })),
      ]);
      if (outcome.timedOut) {
        taskkill.kill("SIGKILL");
        throw new Error(`taskkill timed out for process tree ${child.pid}`);
      }
      const { exit } = outcome;
      if (exit.code && isProcessTreeAlive(child)) {
        throw new Error(
          `taskkill failed for process tree ${child.pid} (${describeExit(exit)})`
        );
      }
      return;
    }
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

function describeExit(exit: ChildExit) {
  return exit.signal ? `signal ${exit.signal}` : `code ${exit.code ?? 0}`;
}

function exitWithSignalOrCode(exit: ChildExit) {
  if (exit.signal) {
    process.kill(process.pid, exit.signal);
    return;
  }
  process.exit(exit.code ?? 0);
}

if (import.meta.main) {
  runDesktopDev()
    .then(exitWithSignalOrCode)
    .catch((error) => {
      process.stderr.write(
        `Failed to start desktop full dev flow: ${String(error)}\n`
      );
      process.exit(1);
    });
}
