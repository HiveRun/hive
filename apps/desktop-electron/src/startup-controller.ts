import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createDaemonRuntime,
  type DaemonStartupEvent,
} from "@hive/daemon-runtime";
import { getDesktopRuntimeInfo } from "./runtime-info";

type DesktopStartupPhase =
  | "idle"
  | "detecting-daemon"
  | "starting-daemon"
  | "waiting-for-api"
  | "api-ready"
  | "error";

type DesktopStartupState = {
  phase: DesktopStartupPhase;
  message: string;
  backendUrl: string;
  healthUrl: string;
  pid?: number | null;
  startedAt: number;
  updatedAt: number;
  error?: string;
};

const DEFAULT_DAEMON_ARGS = ["--foreground"];
const DEFAULT_STARTUP_TIMEOUT_MS = 180_000;
const DEFAULT_STARTUP_INTERVAL_MS = 300;
const DESKTOP_DAEMON_ENV_STRIP_KEYS = [
  "DATABASE_URL",
  "DOTENV_CONFIG_SILENT",
  "HIVE_INSTALL_URL",
  "HIVE_LOG_DIR",
  "HIVE_MIGRATIONS_DIR",
  "HIVE_OPENCODE_BIN",
  "HIVE_WEB_DIST",
] as const;

const moduleDir = import.meta.dirname;

const resolveHiveHomePath = () =>
  process.env.HIVE_HOME ?? join(homedir(), ".hive");

const resolveLogDirectory = () =>
  process.env.HIVE_LOG_DIR ?? join(resolveHiveHomePath(), "logs");

const resolvePidFilePath = () =>
  process.env.HIVE_PID_FILE ?? join(resolveHiveHomePath(), "hive.pid");

const resolveReadyFilePath = () =>
  process.env.HIVE_READY_FILE ?? join(resolveHiveHomePath(), "daemon-ready");

const resolveStartLockFilePath = () =>
  join(resolveHiveHomePath(), "daemon-start.pid");

const resolveWorkspaceRoot = () =>
  process.env.HIVE_WORKSPACE_ROOT ?? process.cwd();

const resolveDaemonArgs = () => {
  const encoded = process.env.HIVE_DESKTOP_DAEMON_ARGS;
  if (!encoded) {
    return DEFAULT_DAEMON_ARGS;
  }

  try {
    const parsed = JSON.parse(encoded);
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === "string")
    ) {
      return parsed;
    }
  } catch {
    /* fall through to default args */
  }

  return DEFAULT_DAEMON_ARGS;
};

const resolveStartupTimeoutMs = () => {
  const configured = Number(process.env.HIVE_DESKTOP_STARTUP_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_STARTUP_TIMEOUT_MS;
};

const resolveSiblingCliCandidates = () => {
  const executableName = process.platform === "win32" ? "hive.exe" : "hive";
  const candidates = [
    process.env.HIVE_DESKTOP_CLI_BINARY,
    process.env.HIVE_DESKTOP_DAEMON_COMMAND,
    join(dirname(process.execPath), executableName),
    join(process.resourcesPath, executableName),
    join(process.resourcesPath, "..", executableName),
    join(process.resourcesPath, "..", "..", executableName),
    join(process.resourcesPath, "..", "..", "..", executableName),
    join(process.resourcesPath, "..", "..", "..", "..", executableName),
    join(moduleDir, "..", "..", "..", executableName),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.map((candidate) => resolve(candidate));
};

const resolveDaemonCommand = () =>
  resolveSiblingCliCandidates().find((candidate) => existsSync(candidate)) ??
  null;

const createInitialState = (): DesktopStartupState => {
  const runtimeInfo = getDesktopRuntimeInfo();
  const now = Date.now();

  return {
    phase: "idle",
    message: "Preparing Hive desktop startup",
    backendUrl: runtimeInfo.backendUrl,
    healthUrl: runtimeInfo.healthUrl,
    startedAt: now,
    updatedAt: now,
  };
};

const mapDaemonPhase = (
  phase: DaemonStartupEvent["phase"]
): DesktopStartupPhase => {
  if (phase === "detecting-daemon") {
    return "detecting-daemon";
  }
  if (phase === "starting-daemon") {
    return "starting-daemon";
  }
  if (phase === "waiting-for-api") {
    return "waiting-for-api";
  }
  if (phase === "api-ready") {
    return "api-ready";
  }
  return "error";
};

export const createDesktopStartupController = () => {
  const listeners = new Set<(nextState: DesktopStartupState) => void>();
  let startupPromise: Promise<void> | null = null;
  let currentState = createInitialState();

  const notify = () => {
    for (const listener of listeners) {
      listener(currentState);
    }
  };

  const updateState = (next: Partial<DesktopStartupState>) => {
    currentState = {
      ...currentState,
      ...next,
      updatedAt: Date.now(),
    };
    notify();
  };

  const applyDaemonEvent = (event: DaemonStartupEvent) => {
    updateState({
      phase: mapDaemonPhase(event.phase),
      message: event.message,
      pid: event.pid,
      error: event.error,
    });
  };

  const start = async () => {
    if (startupPromise) {
      return await startupPromise;
    }

    startupPromise = (async () => {
      const runtimeInfo = getDesktopRuntimeInfo();
      const startedAt = Date.now();
      currentState = {
        phase: "detecting-daemon",
        message: "Detecting Hive daemon",
        backendUrl: runtimeInfo.backendUrl,
        healthUrl: runtimeInfo.healthUrl,
        startedAt,
        updatedAt: startedAt,
      };
      notify();

      const daemonCommand = resolveDaemonCommand();

      const runtime = createDaemonRuntime({
        detachedCwd:
          process.env.HIVE_DESKTOP_DAEMON_CWD ??
          (daemonCommand ? dirname(daemonCommand) : process.cwd()),
        env: process.env,
        envStripKeys:
          process.env.HIVE_DESKTOP_PRESERVE_DAEMON_ENV === "1"
            ? []
            : DESKTOP_DAEMON_ENV_STRIP_KEYS,
        executablePath: daemonCommand ?? "",
        foregroundArgs: resolveDaemonArgs(),
        healthcheckUrl: runtimeInfo.healthUrl,
        hiveHome: resolveHiveHomePath(),
        logFilePath: join(resolveLogDirectory(), "hive.log"),
        onStatus: applyDaemonEvent,
        pidFilePath: resolvePidFilePath(),
        readyFilePath: resolveReadyFilePath(),
        startLockFilePath: resolveStartLockFilePath(),
        useShellDetach:
          process.env.HIVE_DESKTOP_DAEMON_USE_SHELL_DETACH !== "0",
        workspaceRoot: resolveWorkspaceRoot(),
      });

      const ready = await runtime.ensureRunning({
        intervalMs: DEFAULT_STARTUP_INTERVAL_MS,
        timeoutMs: resolveStartupTimeoutMs(),
      });

      if (!ready) {
        updateState({
          phase: "error",
          message: "Hive daemon did not become ready",
        });
      }
    })().finally(() => {
      startupPromise = null;
    });

    return await startupPromise;
  };

  const retry = async () => {
    startupPromise = null;
    currentState = createInitialState();
    notify();
    await start();
  };

  const subscribe = (listener: (nextState: DesktopStartupState) => void) => {
    listeners.add(listener);
    listener(currentState);

    return () => {
      listeners.delete(listener);
    };
  };

  return {
    getState: () => currentState,
    retry,
    start,
    subscribe,
  };
};

export type DesktopStartupController = ReturnType<
  typeof createDesktopStartupController
>;
