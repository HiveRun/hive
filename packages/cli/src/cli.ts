import { type SpawnOptions, spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  binaryDirectory,
  cleanupPidFile,
  DEFAULT_WEB_URL,
  pidFilePath,
  startServer,
} from "@hive/server";
import { Builtins, Cli, Command, Option } from "clipanion";
import pc from "picocolors";

import {
  buildCompletionCommandModel,
  COMPLETION_SHELLS,
  type CompletionShell,
  renderCompletionScript,
} from "./completions";
import {
  ensureTrailingNewline,
  installCompletionScript,
  type WaitForServerReadyConfig,
  waitForServerReady,
} from "./runtime-utils";
import { uninstallHive } from "./uninstall";
import {
  resolveUninstallConfirmation,
  resolveUninstallDataRetention,
} from "./uninstall-confirmation";
import { resolveUninstallStopResult } from "./uninstall-runtime";

const rawArgv = process.argv.slice(2);
if (process.env.HIVE_DEBUG_ARGS === "1") {
  process.stderr.write(`[hive argv] ${JSON.stringify(rawArgv)}\n`);
}
if (!process.env.HIVE_SHELL_MODE) {
  await import("dotenv/config");
}

const coerceHelpAlias = (argv: string[]) => {
  if (argv[0] !== "help") {
    return argv;
  }
  const [, ...rest] = argv;
  if (rest.length === 0) {
    return ["--help"];
  }
  return [...rest, "--help"];
};

const cliArgv = coerceHelpAlias(rawArgv);

const DEFAULT_INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/HiveRun/hive/main/scripts/install.sh | bash";
const LOCAL_INSTALL_SCRIPT_PATH = join(binaryDirectory, "install.sh");
const CLI_VERSION = process.env.HIVE_VERSION ?? "dev";

const resolveWorkspaceRootEnv = () =>
  process.env.HIVE_WORKSPACE_ROOT ?? process.cwd();

const symbols = {
  info: pc.cyan("ℹ"),
  success: pc.green("✔"),
  warning: pc.yellow("▲"),
  error: pc.red("✖"),
};

const logInfo = (message: string) =>
  process.stdout.write(`${symbols.info} ${message}\n`);
const logSuccess = (message: string) =>
  process.stdout.write(`${symbols.success} ${message}\n`);
const logWarning = (message: string) =>
  process.stdout.write(`${symbols.warning} ${message}\n`);
const logError = (message: string) =>
  process.stderr.write(`${symbols.error} ${message}\n`);

const formatError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const printSummary = (title: string, rows: [string, string][]) => {
  const lines = [
    pc.bold(pc.green(title)),
    ...rows.map(
      ([label, value]) => `  ${pc.dim("•")} ${pc.dim(`${label}:`)} ${value}`
    ),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
};

const resolveHiveHomePath = () =>
  process.env.HIVE_HOME ?? join(homedir(), ".hive");

const resolveDesktopPidFilePath = () =>
  process.env.HIVE_DESKTOP_PID_FILE ??
  join(resolveHiveHomePath(), "desktop.pid");

const normalizeShell = (shell?: string): CompletionShell | null => {
  if (!shell) {
    return null;
  }
  const normalized = shell.toLowerCase() as CompletionShell;
  return COMPLETION_SHELLS.includes(normalized) ? normalized : null;
};

const supportedShellList = () => COMPLETION_SHELLS.join(", ");

const getDefaultCompletionInstallPath = (shell: CompletionShell) => {
  const home = homedir();
  if (shell === "bash") {
    return join(
      home,
      ".local",
      "share",
      "bash-completion",
      "completions",
      "hive"
    );
  }
  if (shell === "fish") {
    return join(home, ".config", "fish", "completions", "hive.fish");
  }
  const zshCustom = process.env.ZSH_CUSTOM;
  if (zshCustom) {
    return join(zshCustom, "completions", "_hive");
  }
  if (existsSync(join(home, ".oh-my-zsh"))) {
    return join(home, ".oh-my-zsh", "custom", "completions", "_hive");
  }
  return join(home, ".config", "zsh", "completions", "_hive");
};

const trimTrailingSlash = (value: string) =>
  value.endsWith("/") ? value.slice(0, -1) : value;

const HEALTHCHECK_URL = `${trimTrailingSlash(DEFAULT_WEB_URL)}/health`;
const DAEMON_PROBE_TIMEOUT_MS = 800;
const DAEMON_STOP_WAIT_TIMEOUT_MS = 10_000;
const DAEMON_STOP_POLL_INTERVAL_MS = 100;

const readActivePid = (): number | null => {
  if (!existsSync(pidFilePath)) {
    return null;
  }

  try {
    const pid = Number(readFileSync(pidFilePath, "utf8").trim());
    if (!pid || Number.isNaN(pid)) {
      cleanupPidFile();
      return null;
    }
    return pid;
  } catch {
    return null;
  }
};

const isPidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const isDaemonRunning = () => {
  const pid = readActivePid();
  if (!pid) {
    return false;
  }
  if (isPidAlive(pid)) {
    return true;
  }
  cleanupPidFile();
  return false;
};

const probeJson = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DAEMON_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

type LaunchResult = { pid: number | null; logFile: string };

const openLogStreams = (logFile: string) => ({
  stdoutFd: openSync(logFile, "a"),
  stderrFd: openSync(logFile, "a"),
});

const closeStream = (fd: number | null) => {
  if (fd === null) {
    return;
  }
  try {
    closeSync(fd);
  } catch {
    /* ignore */
  }
};

const persistPidFile = (pid: number | null) => {
  ensurePidDirectory();
  if (!pid) {
    return;
  }
  try {
    writeFileSync(pidFilePath, String(pid));
  } catch (error) {
    logWarning(
      `Failed to write pid file ${pidFilePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

const launchDetachedServer = (): LaunchResult => {
  const logDir = resolveLogDirectory();
  ensureLogDirectory(logDir);
  const logFile = resolveLogFilePath();
  const { stdoutFd, stderrFd } = openLogStreams(logFile);

  try {
    const child = spawn(process.execPath, ["--foreground"], {
      cwd: binaryDirectory,
      env: {
        ...process.env,
        HIVE_FOREGROUND: "1",
        HIVE_WORKSPACE_ROOT: resolveWorkspaceRootEnv(),
      },
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });

    closeStream(stdoutFd);
    closeStream(stderrFd);

    child.unref();
    persistPidFile(child.pid ?? null);

    return { pid: child.pid ?? null, logFile };
  } catch (error) {
    closeStream(stdoutFd);
    closeStream(stderrFd);
    throw error;
  }
};

const ensureDaemonRunning = async (
  config?: Omit<WaitForServerReadyConfig, "url">
): Promise<boolean> => {
  try {
    if (isDaemonRunning()) {
      return true;
    }

    logInfo("Hive is not running. Starting background daemon...");
    launchDetachedServer();

    const ready = await waitForServerReady({
      url: HEALTHCHECK_URL,
      ...config,
    });
    if (!ready) {
      logWarning("Daemon started, but /health did not respond before timeout.");
    }
    return true;
  } catch (error) {
    logError(
      `Failed to start Hive: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
};

const resolveLogDirectory = () =>
  process.env.HIVE_LOG_DIR ?? join(binaryDirectory, "logs");
const resolveLogFilePath = () => join(resolveLogDirectory(), "hive.log");

const openDefaultBrowser = (url: string) => {
  const platform = process.platform;
  let command: string;
  let args: string[];

  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  try {
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    return { ok: true } as const;
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to open default browser",
    } as const;
  }
};

const getDesktopExecutableCandidates = () => {
  const override = process.env.HIVE_ELECTRON_BINARY;
  const candidates: string[] = [];
  if (override) {
    candidates.push(override);
  }

  if (process.platform === "darwin") {
    candidates.push(join(binaryDirectory, "Hive Desktop.app"));
    candidates.push(join(binaryDirectory, "hive-desktop"));
    candidates.push(join(binaryDirectory, "Hive.app"));
    candidates.push(join(binaryDirectory, "hive-electron"));
  } else if (process.platform === "win32") {
    candidates.push(join(binaryDirectory, "hive-desktop.exe"));
    candidates.push(join(binaryDirectory, "Hive Desktop.exe"));
    candidates.push(join(binaryDirectory, "hive-electron.exe"));
    candidates.push(join(binaryDirectory, "Hive.exe"));
  } else {
    candidates.push(join(binaryDirectory, "hive-desktop.AppImage"));
    candidates.push(join(binaryDirectory, "hive-desktop"));
    candidates.push(join(binaryDirectory, "hive-desktop.bin"));
    candidates.push(join(binaryDirectory, "hive-electron.AppImage"));
    candidates.push(join(binaryDirectory, "hive-electron"));
    candidates.push(join(binaryDirectory, "hive-electron.bin"));
  }

  return candidates;
};

const resolveMacAppExecutable = (appPath: string) => {
  const appName = basename(appPath, ".app");
  const executable = join(appPath, "Contents", "MacOS", appName);
  return existsSync(executable) ? executable : null;
};

const launchDesktopApplication = () => {
  const target = getDesktopExecutableCandidates().find(
    (candidate) => candidate && existsSync(candidate)
  );

  if (!target) {
    return {
      ok: false,
      message:
        "Unable to locate the Hive Desktop binary. Set HIVE_ELECTRON_BINARY to the desktop executable.",
    } as const;
  }

  try {
    let command = target;
    let args: string[] = [];
    let options: SpawnOptions = {
      stdio: "ignore",
      detached: true,
      cwd: dirname(target),
    };

    if (process.platform === "darwin" && target.endsWith(".app")) {
      const appExecutable = resolveMacAppExecutable(target);
      if (appExecutable) {
        command = appExecutable;
        options = {
          stdio: "ignore",
          detached: true,
          cwd: dirname(appExecutable),
        };
      } else {
        command = "open";
        args = [target];
        options = { stdio: "ignore", detached: true };
      }
    }

    const rendererPath = join(binaryDirectory, "public", "index.html");
    const env =
      existsSync(rendererPath) && !process.env.HIVE_DESKTOP_RENDERER_PATH
        ? {
            ...process.env,
            HIVE_DESKTOP_RENDERER_PATH: rendererPath,
          }
        : process.env;

    const child = spawn(command, args, {
      ...options,
      env,
    });
    child.unref();
    return { ok: true, path: target, pid: child.pid ?? null } as const;
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to launch Hive desktop",
    } as const;
  }
};

const resolveDesktopProcessTargets = () => {
  const candidates = getDesktopExecutableCandidates();
  const appNames = new Set<string>();
  const processNames = new Set<string>();
  const appExtension = ".app";

  for (const candidate of candidates) {
    const base = basename(candidate);
    if (base.endsWith(appExtension)) {
      const appName = base.slice(0, -appExtension.length);
      if (appName) {
        appNames.add(appName);
        processNames.add(appName);
      }
      continue;
    }
    processNames.add(base);
  }

  return { appNames: [...appNames], processNames: [...processNames] };
};

const closeDesktopByName = (appNames: string[], processNames: string[]) => {
  if (process.platform === "darwin") {
    for (const appName of appNames) {
      spawnSync("osascript", ["-e", `tell application "${appName}" to quit`], {
        stdio: "ignore",
      });
    }
    for (const processName of processNames) {
      spawnSync("pkill", ["-f", processName], { stdio: "ignore" });
    }
    return;
  }

  if (process.platform === "win32") {
    for (const processName of processNames) {
      const executableName = processName.toLowerCase().endsWith(".exe")
        ? processName
        : `${processName}.exe`;
      spawnSync("taskkill", ["/IM", executableName, "/T", "/F"], {
        stdio: "ignore",
      });
    }
    return;
  }

  for (const processName of processNames) {
    spawnSync("pkill", ["-f", processName], { stdio: "ignore" });
  }
};

const closeDesktopApplication = () => {
  const { appNames, processNames } = resolveDesktopProcessTargets();
  const desktopPid = readDesktopPid();

  if (desktopPid && isPidAlive(desktopPid)) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", `${desktopPid}`, "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      process.kill(desktopPid, "SIGTERM");
    }
    cleanupDesktopPidFile();
    return;
  }

  cleanupDesktopPidFile();
  closeDesktopByName(appNames, processNames);
};

const ensureLogDirectory = (dir: string) => {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
};

const ensurePidDirectory = () => {
  try {
    mkdirSync(dirname(pidFilePath), { recursive: true });
  } catch {
    /* ignore */
  }
};

const ensureDesktopPidDirectory = () => {
  try {
    mkdirSync(dirname(resolveDesktopPidFilePath()), { recursive: true });
  } catch {
    /* ignore */
  }
};

const cleanupDesktopPidFile = () => {
  const pidPath = resolveDesktopPidFilePath();
  if (!existsSync(pidPath)) {
    return;
  }
  try {
    unlinkSync(pidPath);
  } catch {
    /* ignore */
  }
};

const persistDesktopPidFile = (pid: number | null) => {
  if (!pid) {
    return;
  }
  ensureDesktopPidDirectory();
  try {
    writeFileSync(resolveDesktopPidFilePath(), `${pid}\n`);
  } catch {
    /* ignore */
  }
};

const readDesktopPid = (): number | null => {
  const pidPath = resolveDesktopPidFilePath();
  if (!existsSync(pidPath)) {
    return null;
  }

  try {
    const pid = Number(readFileSync(pidPath, "utf8").trim());
    if (!pid || Number.isNaN(pid)) {
      cleanupDesktopPidFile();
      return null;
    }
    return pid;
  } catch {
    return null;
  }
};

const describePidStatus = () => {
  if (!existsSync(pidFilePath)) {
    return "Not running (pid file missing)";
  }

  let pidText: string;
  try {
    pidText = readFileSync(pidFilePath, "utf8").trim();
  } catch (error) {
    return `Unknown (failed to read pid file: ${
      error instanceof Error ? error.message : String(error)
    })`;
  }

  const pid = Number(pidText);
  if (!pid || Number.isNaN(pid)) {
    return "Unknown (pid file is invalid)";
  }

  try {
    process.kill(pid, 0);
    return `Running (PID ${pid})`;
  } catch {
    return `Not running (stale PID ${pid})`;
  }
};

type StopBackgroundProcessResult =
  | "failed"
  | "not_running"
  | "stale_pid"
  | "stopped";

const sleep = (milliseconds: number) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const getErrnoCode = (error: unknown) =>
  error && typeof error === "object" && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : null;

const waitForProcessExit = async (
  pid: number,
  timeoutMs: number
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      const errorCode = getErrnoCode(error);

      if (errorCode === "ESRCH") {
        return true;
      }

      return false;
    }

    await sleep(DAEMON_STOP_POLL_INTERVAL_MS);
  }

  return false;
};

const readManagedPidForStop = (emitError: (message: string) => void) => {
  let pidText: string;
  try {
    pidText = readFileSync(pidFilePath, "utf8").trim();
  } catch (error) {
    emitError(
      `Unable to read pid file ${pidFilePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }

  const pid = Number(pidText);
  if (!pid || Number.isNaN(pid)) {
    emitError(`Pid file ${pidFilePath} contains invalid data.`);
    cleanupPidFile();
    return null;
  }

  return pid;
};

const sendStopSignal = (
  pid: number,
  emitInfo: (message: string) => void,
  emitError: (message: string) => void
): "failed" | "signaled" | "stale_pid" => {
  try {
    process.kill(pid, "SIGTERM");
    return "signaled";
  } catch (error) {
    if (getErrnoCode(error) === "ESRCH") {
      cleanupPidFile();
      emitInfo(`Removed stale Hive PID file (${pid}).`);
      return "stale_pid";
    }

    emitError(
      `Failed to stop Hive (PID ${pid}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return "failed";
  }
};

const stopBackgroundProcess = async (options?: {
  silent?: boolean;
  waitForExitMs?: number;
}): Promise<StopBackgroundProcessResult> => {
  const silent = options?.silent ?? false;
  const waitForExitMs = options?.waitForExitMs;
  const log = (message: string) => {
    if (!silent) {
      logInfo(message);
    }
  };

  if (!existsSync(pidFilePath)) {
    log("No running Hive instance found.");
    return "not_running" as const;
  }

  const pid = readManagedPidForStop(logError);
  if (!pid) {
    return "failed" as const;
  }

  const signalResult = sendStopSignal(pid, log, logError);
  if (signalResult === "failed") {
    return "failed" as const;
  }

  if (signalResult === "stale_pid") {
    return "stale_pid" as const;
  }

  if (waitForExitMs && waitForExitMs > 0) {
    const exited = await waitForProcessExit(pid, waitForExitMs);
    if (!exited) {
      logError(`Timed out waiting for Hive (PID ${pid}) to exit.`);
      return "failed" as const;
    }
  }

  logSuccess(`Stopped Hive (PID ${pid}).`);

  cleanupPidFile();
  return "stopped" as const;
};

const streamLogs = () => {
  const logFile = resolveLogFilePath();
  if (!existsSync(logFile)) {
    logError(
      `No log file found at ${logFile}. Start Hive before streaming logs.`
    );
    return Promise.resolve(1);
  }

  logInfo(`Streaming logs from ${logFile}. Press Ctrl+C to stop.`);

  let position = 0;

  const readNewData = () => {
    const stats = statSync(logFile);
    if (stats.size < position) {
      position = 0;
    }
    if (stats.size === position) {
      return;
    }
    const length = stats.size - position;
    const buffer = Buffer.alloc(length);
    const fd = openSync(logFile, "r");
    readSync(fd, buffer, 0, length, position);
    closeSync(fd);
    position = stats.size;
    process.stdout.write(buffer.toString("utf8"));
  };

  try {
    readNewData();
  } catch (error) {
    logError(
      `Failed to read log file ${logFile}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return Promise.resolve(1);
  }

  return new Promise<number>((resolvePromise) => {
    const watcher = watch(logFile, { persistent: true }, () => {
      try {
        readNewData();
      } catch (error) {
        logError(
          `Failed to read log updates: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

    const cleanup = (code = 0) => {
      watcher.close();
      process.off("SIGINT", handleInterrupt);
      process.off("SIGTERM", handleInterrupt);
      resolvePromise(code);
    };

    const handleInterrupt = () => cleanup(0);

    process.on("SIGINT", handleInterrupt);
    process.on("SIGTERM", handleInterrupt);

    watcher.on("error", (error) => {
      logError(
        `Log watcher failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      cleanup(1);
    });
  });
};

const runUpgrade = async () => {
  const stopResult = await stopBackgroundProcess({
    silent: true,
    waitForExitMs: DAEMON_STOP_WAIT_TIMEOUT_MS,
  });
  if (stopResult === "failed") {
    logError("Unable to stop the running instance. Aborting upgrade.");
    return 1;
  }

  if (stopResult === "stopped") {
    logInfo("Stopped running instance.");
  }

  if (stopResult === "stale_pid") {
    logInfo("Removed stale PID file before upgrade.");
  }

  const configuredCommand = process.env.HIVE_INSTALL_COMMAND;
  const storedInstallUrl = process.env.HIVE_INSTALL_URL;
  const env = { ...process.env };
  if (storedInstallUrl) {
    env.HIVE_INSTALL_URL = storedInstallUrl;
  }
  logInfo("Downloading and installing the latest release...");

  let child: ReturnType<typeof spawn>;
  if (configuredCommand) {
    const command = `set -euo pipefail; ${configuredCommand}`;
    child = spawn("bash", ["-c", command], {
      stdio: "inherit",
      env,
    });
  } else if (existsSync(LOCAL_INSTALL_SCRIPT_PATH)) {
    child = spawn("bash", [LOCAL_INSTALL_SCRIPT_PATH], {
      stdio: "inherit",
      env,
      cwd: binaryDirectory,
    });
  } else if (storedInstallUrl) {
    const command = `set -euo pipefail; curl -fsSL ${storedInstallUrl} | bash`;
    child = spawn("bash", ["-c", command], {
      stdio: "inherit",
      env,
    });
  } else {
    const command = `set -euo pipefail; ${DEFAULT_INSTALL_COMMAND}`;
    child = spawn("bash", ["-c", command], {
      stdio: "inherit",
      env,
    });
  }

  return await new Promise<number>((resolvePromise) => {
    child.on("exit", (code) => {
      const exitCode = code ?? 0;
      if (exitCode === 0) {
        logSuccess(
          "Hive upgraded successfully. Run `hive` to start the new version."
        );
      } else {
        logError(`Upgrade command exited with code ${exitCode}.`);
      }
      resolvePromise(exitCode);
    });

    child.on("error", (error) => {
      logError(
        `Upgrade command failed to start: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      resolvePromise(1);
    });
  });
};

const askPrompt = async (prompt: string) => {
  const promptInterface = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await promptInterface.question(prompt);
  } finally {
    promptInterface.close();
  }
};

const promptUninstallConfirmation = () => {
  const hiveHome = resolveHiveHomePath();
  return askPrompt(
    `This will permanently remove Hive files at ${hiveHome}. Continue? [y/N] `
  );
};

const promptUninstallDataRetention = () => {
  const hiveHome = resolveHiveHomePath();
  return askPrompt(
    `Preserve Hive data in ${join(hiveHome, "state")} while removing the app? [y/N] `
  );
};

const uninstallCommand = async (confirm: boolean, keepData: boolean) => {
  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const confirmation = await resolveUninstallConfirmation({
    confirmedByFlag: confirm,
    isInteractive,
    askConfirmation: promptUninstallConfirmation,
  });

  const preserveData = await resolveUninstallDataRetention({
    keepDataByFlag: keepData,
    shouldPrompt: confirmation && isInteractive && !confirm,
    askConfirmation: promptUninstallDataRetention,
  });

  const stopResult = await resolveUninstallStopResult({
    confirmed: confirmation,
    healthcheckUrl: HEALTHCHECK_URL,
    stopBackgroundProcess: () => stopBackgroundProcess({ silent: true }),
    probeJson,
    logInfo,
    logError,
  });

  return uninstallHive({
    confirm: confirmation,
    preserveData,
    hiveHome: resolveHiveHomePath(),
    hiveBinDir: process.env.HIVE_BIN_DIR,
    stopRuntime: () => stopResult,
    closeDesktop: closeDesktopApplication,
    logInfo,
    logSuccess,
    logWarning,
    logError,
  });
};

const runtimeExecutable = basename(process.execPath).toLowerCase();
const isBunRuntime = runtimeExecutable.startsWith("bun");
const isCompiledRuntime = !isBunRuntime;
const isForcedForeground = process.env.HIVE_FOREGROUND === "1";
const defaultShouldRunDetached = isCompiledRuntime && !isForcedForeground;

const startDetachedServer = () => {
  const { logFile } = launchDetachedServer();

  printSummary("Hive is running in the background", [
    ["UI", DEFAULT_WEB_URL],
    ["Logs", logFile],
    ["PID file", pidFilePath],
    ["Stop", "hive stop"],
    ["Stream logs", "hive logs"],
  ]);

  process.exit(0);
};

const bootstrap = async (options?: { forceForeground?: boolean }) => {
  const shouldRunDetached =
    !options?.forceForeground && defaultShouldRunDetached;

  if (shouldRunDetached) {
    try {
      startDetachedServer();
      return 0;
    } catch (error) {
      logWarning(
        `Failed to launch background process: ${
          error instanceof Error ? error.message : String(error)
        }. Falling back to foreground mode.`
      );
    }
  }

  if (!process.env.HIVE_WORKSPACE_ROOT) {
    process.env.HIVE_WORKSPACE_ROOT = process.cwd();
  }

  await startServer();
  return new Promise<never>(() => {
    /* Keep process alive while server runs in foreground */
  });
};

const stopCommand = async () => {
  const result = await stopBackgroundProcess({
    waitForExitMs: DAEMON_STOP_WAIT_TIMEOUT_MS,
  });
  closeDesktopApplication();
  return result === "failed" ? 1 : 0;
};

const webCommand = async () => {
  const ready = await ensureDaemonRunning();
  if (!ready) {
    return 1;
  }

  const result = openDefaultBrowser(DEFAULT_WEB_URL);
  if (!result.ok) {
    logError(`Failed to open browser: ${result.message}`);
    return 1;
  }

  logSuccess(`Opened ${DEFAULT_WEB_URL} in your default browser.`);
  return 0;
};

const desktopCommand = async () => {
  const ready = await ensureDaemonRunning();
  if (!ready) {
    return 1;
  }

  const result = launchDesktopApplication();
  if (!result.ok) {
    if (result.message) {
      logError(`Failed to launch Hive desktop: ${result.message}`);
    }
    return 1;
  }

  persistDesktopPidFile(result.pid ?? null);
  logSuccess("Launched Hive desktop application.");
  return 0;
};

const infoCommand = () => {
  const hiveHome = resolveHiveHomePath();
  const logDir = resolveLogDirectory();
  const logFile = resolveLogFilePath();
  const summaryRows: [string, string][] = [
    ["Version", CLI_VERSION],
    ["Hive home", hiveHome],
    ["Release", binaryDirectory],
    ["Binary", process.execPath],
    ["Logs", logDir],
    ["Log file", logFile],
    ["PID file", pidFilePath],
    ["Daemon", describePidStatus()],
    ["Default UI", DEFAULT_WEB_URL],
  ];

  printSummary("Hive environment", summaryRows);
  return 0;
};

const completionsCommand = (shell: string) => {
  const normalized = normalizeShell(shell);
  if (!normalized) {
    logError(
      `Unsupported shell "${shell}". Supported shells: ${supportedShellList()}`
    );
    return 1;
  }

  const script = renderCompletionScript(normalized, completionCommandModel);
  if (!script) {
    logError("Failed to render completion script.");
    return 1;
  }

  process.stdout.write(ensureTrailingNewline(script));
  return 0;
};

const completionsInstallCommand = (
  shell: string,
  destination?: string | null
) => {
  const normalized = normalizeShell(shell);

  if (!normalized) {
    logError(
      `Unsupported shell "${shell}". Supported shells: ${supportedShellList()}`
    );
    return 1;
  }

  const targetPath = destination ?? getDefaultCompletionInstallPath(normalized);

  const script = renderCompletionScript(normalized, completionCommandModel);
  if (!script) {
    logError("Failed to render completion script.");
    return 1;
  }

  const result = installCompletionScript(script, targetPath);
  if (!result.ok) {
    logError(`Failed to install completions: ${result.message}`);
    return 1;
  }

  logSuccess(`Installed hive completions for ${normalized} at ${result.path}`);
  logInfo("Restart your shell to load them.");
  return 0;
};

const runCommand = async (
  operation: () => number | Promise<number>,
  label: string
) => {
  try {
    return await operation();
  } catch (error) {
    logError(`${label} failed: ${formatError(error)}`);
    return 1;
  }
};

class StartCommand extends Command {
  static override paths = [Command.Default];
  static override usage = Command.Usage({
    category: "Runtime",
    description: "Start the Hive daemon and serve the UI.",
    details: `
Starts Hive in the background unless you pass --foreground. When running detached, logs and the PID file are stored in ~/.hive by default.
`,
    examples: [
      ["Start in background", "hive"],
      ["Force foreground mode", "hive --foreground"],
    ],
  });

  forceForeground = Option.Boolean("--foreground", {
    description: "Run in the foreground instead of background mode",
  });

  override execute() {
    return runCommand(
      () => bootstrap({ forceForeground: Boolean(this.forceForeground) }),
      "start"
    );
  }
}

class StopCommand extends Command {
  static override paths = [["stop"]];
  static override usage = Command.Usage({
    category: "Runtime",
    description: "Stop the background Hive daemon.",
    details:
      "Stops the detached background process by reading the PID file written by the start command.",
    examples: [["Stop running instance", "hive stop"]],
  });

  override execute() {
    return runCommand(() => stopCommand(), "stop");
  }
}

class LogsCommand extends Command {
  static override paths = [["logs"]];
  static override usage = Command.Usage({
    category: "Runtime",
    description: "Stream the Hive daemon log file.",
    details:
      "Tails the current log file and keeps the process running until you press Ctrl+C.",
    examples: [["Follow logs", "hive logs"]],
  });

  override execute() {
    return runCommand(() => streamLogs(), "logs");
  }
}

class WebCommand extends Command {
  static override paths = [["web"]];
  static override usage = Command.Usage({
    category: "Clients",
    description: "Open the Hive UI in your default browser.",
    details:
      "Starts the daemon if necessary and launches the configured web UI URL.",
    examples: [["Start server and open browser", "hive web"]],
  });

  override execute() {
    return runCommand(() => webCommand(), "web");
  }
}

class DesktopCommand extends Command {
  static override paths = [["desktop"]];
  static override usage = Command.Usage({
    category: "Clients",
    description: "Launch the Hive desktop application.",
    details:
      "Starts the daemon if needed and opens the packaged desktop UI. Set HIVE_ELECTRON_BINARY to override the desktop executable path.",
    examples: [["Open desktop UI", "hive desktop"]],
  });

  override execute() {
    return runCommand(() => desktopCommand(), "desktop");
  }
}

class UpgradeCommand extends Command {
  static override paths = [["upgrade"]];
  static override usage = Command.Usage({
    category: "Runtime",
    description: "Download and install the latest Hive release.",
    details:
      "Stops the current daemon if running, then executes the configured installer command (curl | bash by default).",
    examples: [["Upgrade to latest version", "hive upgrade"]],
  });

  override execute() {
    return runCommand(() => runUpgrade(), "upgrade");
  }
}

class UninstallCommand extends Command {
  static override paths = [["uninstall"]];
  static override usage = Command.Usage({
    category: "Runtime",
    description: "Remove the local Hive installation.",
    details:
      "Stops running Hive processes and removes HIVE_HOME (defaults to ~/.hive). In interactive terminals, Hive prompts for confirmation and whether to preserve data. Use --yes for non-interactive environments, and --keep-data to remove only app binaries while retaining runtime data.",
    examples: [
      ["Uninstall Hive with prompt", "hive uninstall"],
      ["Uninstall Hive without prompt", "hive uninstall --yes"],
      ["Uninstall app but keep data", "hive uninstall --yes --keep-data"],
    ],
  });

  confirm = Option.Boolean("--yes", {
    description: "Confirm removal of your Hive installation",
  });

  keepData = Option.Boolean("--keep-data", {
    description: "Remove Hive app files but preserve state/log data",
  });

  override execute() {
    return runCommand(
      () => uninstallCommand(Boolean(this.confirm), Boolean(this.keepData)),
      "uninstall"
    );
  }
}

class InfoCommand extends Command {
  static override paths = [["info"]];
  static override usage = Command.Usage({
    category: "Diagnostics",
    description: "Print paths, version, and daemon status.",
    examples: [["Check current install", "hive info"]],
  });

  override execute() {
    return runCommand(() => infoCommand(), "info");
  }
}

class CompletionsCommand extends Command {
  static override paths = [["completions"]];
  static override usage = Command.Usage({
    category: "Tooling",
    description: "Print the completion script for a supported shell.",
    examples: [["Generate zsh completions", "hive completions zsh"]],
  });

  shell = Option.String({
    name: "shell",
    required: true,
  });

  override execute() {
    return runCommand(
      () => Promise.resolve(completionsCommand(this.shell)),
      "completions"
    );
  }
}

class CompletionsInstallCommand extends Command {
  static override paths = [["completions", "install"]];
  static override usage = Command.Usage({
    category: "Tooling",
    description: "Install the completion script to a default or custom path.",
    details:
      "Detects common shell-specific directories (Oh My Zsh custom dir, ~/.local/share/bash-completion/completions, ~/.config/fish/completions, etc.). Pass a destination argument to override the target path.",
    examples: [
      ["Install completions for zsh", "hive completions install zsh"],
      [
        "Install to a custom location",
        "hive completions install zsh ~/.config/zsh/completions/_hive",
      ],
    ],
  });

  shell = Option.String({
    name: "shell",
    required: true,
  });

  destination = Option.String({
    name: "destination",
    required: false,
  });

  override execute() {
    return runCommand(
      () => completionsInstallCommand(this.shell, this.destination),
      "completions install"
    );
  }
}

const registeredCommandClasses = [
  StartCommand,
  StopCommand,
  LogsCommand,
  WebCommand,
  DesktopCommand,
  UpgradeCommand,
  UninstallCommand,
  InfoCommand,
  CompletionsCommand,
  CompletionsInstallCommand,
  Builtins.HelpCommand,
  Builtins.VersionCommand,
];

const completionCommandModel = buildCompletionCommandModel(
  registeredCommandClasses.flatMap((commandClass) => commandClass.paths ?? [])
);

const cli = new Cli({
  binaryLabel: "Hive CLI",
  binaryName: "hive",
  binaryVersion: CLI_VERSION,
});

for (const commandClass of registeredCommandClasses) {
  cli.register(commandClass);
}

const runCli = async () => {
  try {
    const exitCode = await cli.run(cliArgv, Cli.defaultContext);
    if (typeof exitCode === "number") {
      process.exit(exitCode);
    }
  } catch (error) {
    logError(
      `Failed to start Hive: ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }`
    );
    process.exit(1);
  }
};

runCli();
