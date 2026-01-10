import { type SpawnOptions, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  binaryDirectory,
  cleanupPidFile,
  DEFAULT_WEB_URL,
  pidFilePath,
  startServer,
} from "@hive/server";
import { Builtins, Cli, Command, Option } from "clipanion";
import { Effect } from "effect";
import pc from "picocolors";

import {
  COMPLETION_SHELLS,
  type CompletionShell,
  renderCompletionScript,
} from "./completions";
import {
  ensureTrailingNewline,
  installCompletionScriptEffect,
  type WaitForServerReadyConfig,
  waitForServerReadyEffect,
} from "./effects";

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

const ensureDaemonRunningEffect = (
  config?: Omit<WaitForServerReadyConfig, "url">
): Effect.Effect<boolean> =>
  Effect.catchAll(
    Effect.gen(function* () {
      if (isDaemonRunning()) {
        return true;
      }

      logInfo("Hive is not running. Starting background daemon...");
      yield* Effect.try({
        try: () => launchDetachedServer(),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });

      const ready = yield* waitForServerReadyEffect({
        url: HEALTHCHECK_URL,
        ...config,
      });
      if (!ready) {
        logWarning(
          "Daemon started, but /health did not respond before timeout."
        );
      }
      return true;
    }),
    (error) => {
      logError(
        `Failed to start Hive: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return Effect.succeed(false);
    }
  );

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

const getTauriExecutableCandidates = () => {
  const override = process.env.HIVE_TAURI_BINARY;
  const candidates: string[] = [];
  if (override) {
    candidates.push(override);
  }

  if (process.platform === "darwin") {
    candidates.push(join(binaryDirectory, "Hive Desktop.app"));
    candidates.push(join(binaryDirectory, "hive-desktop"));
    candidates.push(join(binaryDirectory, "Hive.app"));
    candidates.push(join(binaryDirectory, "hive-tauri"));
  } else if (process.platform === "win32") {
    candidates.push(join(binaryDirectory, "hive-desktop.exe"));
    candidates.push(join(binaryDirectory, "Hive Desktop.exe"));
    candidates.push(join(binaryDirectory, "hive-tauri.exe"));
    candidates.push(join(binaryDirectory, "Hive.exe"));
  } else {
    candidates.push(join(binaryDirectory, "hive-desktop.AppImage"));
    candidates.push(join(binaryDirectory, "hive-desktop"));
    candidates.push(join(binaryDirectory, "hive-desktop.bin"));
    candidates.push(join(binaryDirectory, "hive-tauri.AppImage"));
    candidates.push(join(binaryDirectory, "hive-tauri"));
    candidates.push(join(binaryDirectory, "hive-tauri.bin"));
  }

  return candidates;
};

const launchTauriApplication = () => {
  const target = getTauriExecutableCandidates().find(
    (candidate) => candidate && existsSync(candidate)
  );

  if (!target) {
    return {
      ok: false,
      message:
        "Unable to locate the Hive Desktop binary. Set HIVE_TAURI_BINARY to the desktop executable.",
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
      command = "open";
      args = [target];
      options = { stdio: "ignore", detached: true };
    }

    const child = spawn(command, args, options);
    child.unref();
    return { ok: true, path: target } as const;
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

const stopBackgroundProcess = (options?: { silent?: boolean }) => {
  const silent = options?.silent ?? false;
  const log = (message: string) => {
    if (!silent) {
      logInfo(message);
    }
  };

  if (!existsSync(pidFilePath)) {
    log("No running Hive instance found.");
    return "not_running" as const;
  }

  let pidText: string;
  try {
    pidText = readFileSync(pidFilePath, "utf8").trim();
  } catch (error) {
    logError(
      `Unable to read pid file ${pidFilePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return "failed" as const;
  }

  const pid = Number(pidText);
  if (!pid || Number.isNaN(pid)) {
    logError(`Pid file ${pidFilePath} contains invalid data.`);
    cleanupPidFile();
    return "failed" as const;
  }

  try {
    process.kill(pid, "SIGTERM");
    logSuccess(`Stopped Hive (PID ${pid}).`);
  } catch (error) {
    logError(
      `Failed to stop Hive (PID ${pid}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return "failed" as const;
  }

  cleanupPidFile();
  return "stopped" as const;
};

const DEFAULT_LOG_TAIL_BYTES = 65_536;

const streamLogs = () => {
  const logFile = resolveLogFilePath();
  if (!existsSync(logFile)) {
    logError(
      `No log file found at ${logFile}. Start Hive before streaming logs.`
    );
    return Promise.resolve(1);
  }

  const fromStart =
    process.env.HIVE_LOGS_FROM_START === "1" ||
    process.env.HIVE_LOGS_FROM_START === "true";

  logInfo(
    `Streaming logs from ${logFile}. Press Ctrl+C to stop.` +
      (fromStart
        ? ""
        : " (tailing recent output; set HIVE_LOGS_FROM_START=1 to print full log)")
  );

  let position = 0;

  if (!fromStart) {
    try {
      const stats = statSync(logFile);
      position = Math.max(0, stats.size - DEFAULT_LOG_TAIL_BYTES);
    } catch {
      position = 0;
    }
  }

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
  const stopResult = stopBackgroundProcess({ silent: true });
  if (stopResult === "failed") {
    logError("Unable to stop the running instance. Aborting upgrade.");
    return 1;
  }

  if (stopResult === "stopped") {
    logInfo("Stopped running instance.");
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

const bootstrapEffect = (options?: { forceForeground?: boolean }) =>
  Effect.tryPromise({
    try: () => bootstrap(options),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });

const streamLogsEffect = Effect.tryPromise({
  try: () => streamLogs(),
  catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
});

const runUpgradeEffect = Effect.tryPromise({
  try: () => runUpgrade(),
  catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
});

const stopCommandEffect = Effect.map(
  Effect.sync(() => stopBackgroundProcess()),
  (result) => (result === "failed" ? 1 : 0)
);

const webCommandEffect = Effect.gen(function* () {
  const ready = yield* ensureDaemonRunningEffect();
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
});

const desktopCommandEffect = Effect.gen(function* () {
  const ready = yield* ensureDaemonRunningEffect();
  if (!ready) {
    return 1;
  }

  const result = launchTauriApplication();
  if (!result.ok) {
    if (result.message) {
      logError(`Failed to launch Hive desktop: ${result.message}`);
    }
    return 1;
  }

  logSuccess("Launched Hive desktop application.");
  return 0;
});

const infoCommandEffect = Effect.sync(() => {
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
});

const completionsCommandEffect = (shell: string) =>
  Effect.sync(() => {
    const normalized = normalizeShell(shell);
    if (!normalized) {
      logError(
        `Unsupported shell "${shell}". Supported shells: ${supportedShellList()}`
      );
      return 1;
    }

    const script = renderCompletionScript(normalized);
    if (!script) {
      logError("Failed to render completion script.");
      return 1;
    }

    process.stdout.write(ensureTrailingNewline(script));
    return 0;
  });

const completionsInstallCommandEffect = (
  shell: string,
  destination?: string | null
) =>
  Effect.gen(function* () {
    const normalized = normalizeShell(shell);

    if (!normalized) {
      logError(
        `Unsupported shell "${shell}". Supported shells: ${supportedShellList()}`
      );
      return 1;
    }

    const targetPath =
      destination ?? getDefaultCompletionInstallPath(normalized);

    const result = yield* installCompletionScriptEffect(normalized, targetPath);
    if (!result.ok) {
      logError(`Failed to install completions: ${result.message}`);
      return 1;
    }

    logSuccess(
      `Installed hive completions for ${normalized} at ${result.path}`
    );
    logInfo("Restart your shell to load them.");
    return 0;
  });

const runCommandEffect = (
  effect: Effect.Effect<number, unknown>,
  label: string
) =>
  Effect.runPromise(
    Effect.catchAll(effect, (error) => {
      logError(`${label} failed: ${formatError(error)}`);
      return Effect.succeed(1);
    })
  );

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
    return Effect.runPromise(
      Effect.catchAll(
        bootstrapEffect({ forceForeground: Boolean(this.forceForeground) }),
        (error) => {
          logError(`Failed to start Hive: ${formatError(error)}`);
          return Effect.succeed(1);
        }
      )
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
    return runCommandEffect(stopCommandEffect, "stop");
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
    return runCommandEffect(streamLogsEffect, "logs");
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
    return runCommandEffect(webCommandEffect, "web");
  }
}

class DesktopCommand extends Command {
  static override paths = [["desktop"]];
  static override usage = Command.Usage({
    category: "Clients",
    description: "Launch the Hive desktop application.",
    details:
      "Starts the daemon if needed and opens the packaged desktop UI. Set HIVE_TAURI_BINARY to override the desktop executable path.",
    examples: [["Open desktop UI", "hive desktop"]],
  });

  override execute() {
    return runCommandEffect(desktopCommandEffect, "desktop");
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
    return runCommandEffect(runUpgradeEffect, "upgrade");
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
    return runCommandEffect(infoCommandEffect, "info");
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
    return runCommandEffect(
      completionsCommandEffect(this.shell),
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
    return runCommandEffect(
      completionsInstallCommandEffect(this.shell, this.destination),
      "completions install"
    );
  }
}

const cli = new Cli({
  binaryLabel: "Hive CLI",
  binaryName: "hive",
  binaryVersion: CLI_VERSION,
});

cli.register(StartCommand);
cli.register(StopCommand);
cli.register(LogsCommand);
cli.register(WebCommand);
cli.register(DesktopCommand);
cli.register(UpgradeCommand);
cli.register(InfoCommand);
cli.register(CompletionsCommand);
cli.register(CompletionsInstallCommand);
cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);

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
