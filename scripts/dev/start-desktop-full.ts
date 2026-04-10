import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  resolveDefaultDevHiveHome,
  resolveWorkspaceRoot,
} from "./local-hive-home";

const DEV_SERVER_TIMEOUT_MS = 120_000;
const DEV_SERVER_POLL_INTERVAL_MS = 500;
const SHUTDOWN_GRACE_PERIOD_MS = 100;

const workspaceRoot = resolveWorkspaceRoot(process.cwd());
const hiveHome =
  process.env.HIVE_HOME ?? resolveDefaultDevHiveHome(process.cwd());
const desktopUrl = process.env.HIVE_DESKTOP_URL ?? "http://localhost:3001";
const devCommand =
  process.env.HIVE_DESKTOP_FULL_DEV_COMMAND ??
  "turbo run dev --filter=web... --filter=@hive/server...";
const desktopCommand =
  process.env.HIVE_DESKTOP_FULL_DESKTOP_COMMAND ??
  "bun run --cwd apps/desktop-electron start";

const env = {
  ...process.env,
  HIVE_DESKTOP_URL: desktopUrl,
  HIVE_HOME: hiveHome,
};

const devProcess = spawnCommand(devCommand);
let desktopProcess: ChildProcess | null = null;
let shuttingDown = false;

registerShutdownHandlers();

devProcess.on("exit", (code, signal) => {
  if (!shuttingDown) {
    desktopProcess?.kill("SIGTERM");
  }

  exitWithSignalOrCode(code, signal);
});

main().catch(async (error) => {
  process.stderr.write(
    `Failed to start desktop full dev flow: ${String(error)}\n`
  );
  await shutdown();
  process.exit(1);
});

async function main() {
  await waitForUrl(desktopUrl);
  desktopProcess = spawnCommand(desktopCommand);

  desktopProcess.on("exit", (code, signal) => {
    if (!shuttingDown) {
      devProcess.kill("SIGTERM");
    }

    exitWithSignalOrCode(code, signal);
  });
}

function spawnCommand(command: string) {
  return spawn(command, {
    cwd: workspaceRoot,
    env,
    shell: true,
    stdio: "inherit",
  });
}

async function waitForUrl(url: string) {
  const timeoutAt = Date.now() + DEV_SERVER_TIMEOUT_MS;

  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the local dev server comes up.
    }

    await delay(DEV_SERVER_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for dev server at ${url}`);
}

function registerShutdownHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await shutdown();
      process.exit(0);
    });
  }
}

async function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  desktopProcess?.kill("SIGTERM");
  devProcess.kill("SIGTERM");
  await delay(SHUTDOWN_GRACE_PERIOD_MS);
}

function exitWithSignalOrCode(
  code: number | null,
  signal: NodeJS.Signals | null
) {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
}
