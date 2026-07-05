import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const DEFAULT_SERVER_PORT = 3000;
const DEFAULT_HOSTNAME = "localhost";
export const serverPort = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
export const serverHostname =
  process.env.HOST ?? process.env.HOSTNAME ?? DEFAULT_HOSTNAME;

function formatHostForLocalUrl(hostname: string) {
  if (hostname === "0.0.0.0") {
    return "127.0.0.1";
  }

  if (hostname === "::") {
    return "[::1]";
  }

  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

const resolvedExecPath =
  realpathSync.native?.(process.execPath) ?? realpathSync(process.execPath);
const runtimeExecutable = basename(resolvedExecPath).toLowerCase();
const isBunRuntime = runtimeExecutable.startsWith("bun");
const isCompiledRuntime = !isBunRuntime;
const hiveHome = process.env.HIVE_HOME || join(homedir(), ".hive");

export const DEFAULT_API_PORT = String(serverPort);
export const DEFAULT_API_URL = `http://${formatHostForLocalUrl(serverHostname)}:${DEFAULT_API_PORT}`;
export const DEFAULT_WEB_PORT =
  process.env.WEB_PORT ?? (isCompiledRuntime ? String(serverPort) : "3001");
export const DEFAULT_WEB_URL = `http://localhost:${DEFAULT_WEB_PORT}`;
export const binaryDirectory = dirname(resolvedExecPath);
export const pidFilePath =
  process.env.HIVE_PID_FILE ?? join(hiveHome, "hive.pid");
export const readyFilePath =
  process.env.HIVE_READY_FILE ?? join(hiveHome, "daemon-ready");

export const cleanupPidFile = () => {
  try {
    rmSync(pidFilePath);
  } catch {
    /* ignore pid file cleanup errors */
  }
};

export const cleanupReadyFile = () => {
  try {
    rmSync(readyFilePath);
  } catch {
    /* ignore ready file cleanup errors */
  }
};

export const markDaemonReady = () => {
  try {
    mkdirSync(dirname(readyFilePath), { recursive: true });
    writeFileSync(readyFilePath, `${process.pid}\n`, "utf8");
  } catch {
    /* ignore ready file write errors */
  }
};
