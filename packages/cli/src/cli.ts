import { spawn } from "node:child_process";
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
import { basename, dirname, join, resolve } from "node:path";

import {
  binaryDirectory,
  cleanupPidFile,
  DEFAULT_WEB_URL,
  pidFilePath,
  startServer,
} from "@synthetic/server";
import { Builtins, Cli, Command, Option } from "clipanion";
import pc from "picocolors";

import { COMPLETION_SHELLS, renderCompletionScript } from "./completions";

const rawArgv = process.argv.slice(2);
if (process.env.SYNTHETIC_DEBUG_ARGS === "1") {
  process.stderr.write(`[synthetic argv] ${JSON.stringify(rawArgv)}\n`);
}
if (!process.env.SYNTHETIC_SHELL_MODE) {
  await import("dotenv/config");
}

const DEFAULT_INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/SyntheticRun/synthetic/main/scripts/install.sh | bash";
const LOCAL_INSTALL_SCRIPT_PATH = join(binaryDirectory, "install.sh");
const CLI_VERSION = process.env.SYNTHETIC_VERSION ?? "dev";

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

const printSummary = (title: string, rows: [string, string][]) => {
  const lines = [
    pc.bold(pc.green(title)),
    ...rows.map(
      ([label, value]) => `  ${pc.dim("•")} ${pc.dim(`${label}:`)} ${value}`
    ),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
};

const resolveSyntheticHomePath = () =>
  process.env.SYNTHETIC_HOME ?? join(homedir(), ".synthetic");

type CompletionShell = (typeof COMPLETION_SHELLS)[number];

const ensureTrailingNewline = (script: string) =>
  script.endsWith("\n") ? script : `${script}\n`;

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
      "synthetic"
    );
  }
  if (shell === "fish") {
    return join(home, ".config", "fish", "completions", "synthetic.fish");
  }
  const zshCustom = process.env.ZSH_CUSTOM;
  if (zshCustom) {
    return join(zshCustom, "completions", "_synthetic");
  }
  if (existsSync(join(home, ".oh-my-zsh"))) {
    return join(home, ".oh-my-zsh", "custom", "completions", "_synthetic");
  }
  return join(home, ".config", "zsh", "completions", "_synthetic");
};

const installCompletionScript = (
  shell: CompletionShell,
  targetPath?: string | null
) => {
  const script = renderCompletionScript(shell);
  if (!script) {
    return { ok: false, message: `Unsupported shell "${shell}".` } as const;
  }

  const resolvedPath = targetPath
    ? resolve(targetPath)
    : getDefaultCompletionInstallPath(shell);
  try {
    mkdirSync(dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, ensureTrailingNewline(script), "utf8");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error while writing completion script";
    return { ok: false, message } as const;
  }

  return { ok: true, path: resolvedPath } as const;
};

const resolveLogDirectory = () =>
  process.env.SYNTHETIC_LOG_DIR ?? join(binaryDirectory, "logs");
const resolveLogFilePath = () => join(resolveLogDirectory(), "synthetic.log");

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
    log("No running Synthetic instance found.");
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
    logSuccess(`Stopped Synthetic (PID ${pid}).`);
  } catch (error) {
    logError(
      `Failed to stop Synthetic (PID ${pid}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return "failed" as const;
  }

  cleanupPidFile();
  return "stopped" as const;
};

const streamLogs = () => {
  const logFile = resolveLogFilePath();
  if (!existsSync(logFile)) {
    logError(
      `No log file found at ${logFile}. Start Synthetic before streaming logs.`
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
  const stopResult = stopBackgroundProcess({ silent: true });
  if (stopResult === "failed") {
    logError("Unable to stop the running instance. Aborting upgrade.");
    return 1;
  }

  if (stopResult === "stopped") {
    logInfo("Stopped running instance.");
  }

  const configuredCommand = process.env.SYNTHETIC_INSTALL_COMMAND;
  const storedInstallUrl = process.env.SYNTHETIC_INSTALL_URL;
  const env = { ...process.env };
  if (storedInstallUrl) {
    env.SYNTHETIC_INSTALL_URL = storedInstallUrl;
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
          "Synthetic upgraded successfully. Run `synthetic` to start the new version."
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
const isForcedForeground = process.env.SYNTHETIC_FOREGROUND === "1";
const defaultShouldRunDetached = isCompiledRuntime && !isForcedForeground;

const startDetachedServer = () => {
  const logDir = resolveLogDirectory();
  ensureLogDirectory(logDir);
  const logFile = resolveLogFilePath();
  const stdoutFd = openSync(logFile, "a");
  const stderrFd = openSync(logFile, "a");

  const child = spawn(process.execPath, ["--foreground"], {
    cwd: binaryDirectory,
    env: {
      ...process.env,
      SYNTHETIC_FOREGROUND: "1",
    },
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
  });

  closeSync(stdoutFd);
  closeSync(stderrFd);

  child.unref();

  ensurePidDirectory();
  try {
    writeFileSync(pidFilePath, String(child.pid));
  } catch (error) {
    logError(
      `Failed to write pid file ${pidFilePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  printSummary("Synthetic is running in the background", [
    ["UI", DEFAULT_WEB_URL],
    ["Logs", logFile],
    ["PID file", pidFilePath],
    ["Stop", "synthetic stop"],
    ["Stream logs", "synthetic logs"],
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

  await startServer();
  return new Promise<never>(() => {
    /* Keep process alive while server runs in foreground */
  });
};

class StartCommand extends Command {
  static paths = [Command.Default];
  static usage = Command.Usage({
    category: "Runtime",
    description: "Start the Synthetic daemon and serve the UI.",
    details: `
Starts Synthetic in the background unless you pass --foreground. When running detached, logs and the PID file are stored in ~/.synthetic by default.
`,
    examples: [
      ["Start in background", "synthetic"],
      ["Force foreground mode", "synthetic --foreground"],
    ],
  });

  forceForeground = Option.Boolean("--foreground", {
    description: "Run in the foreground instead of background mode",
  });

  async execute() {
    await bootstrap({ forceForeground: Boolean(this.forceForeground) });
  }
}

class StopCommand extends Command {
  static paths = [["stop"]];
  static usage = Command.Usage({
    category: "Runtime",
    description: "Stop the background Synthetic daemon.",
    details:
      "Stops the detached background process by reading the PID file written by the start command.",
    examples: [["Stop running instance", "synthetic stop"]],
  });

  execute() {
    const result = stopBackgroundProcess();
    return Promise.resolve(result === "failed" ? 1 : 0);
  }
}

class LogsCommand extends Command {
  static paths = [["logs"]];
  static usage = Command.Usage({
    category: "Runtime",
    description: "Stream the Synthetic daemon log file.",
    details:
      "Tails the current log file and keeps the process running until you press Ctrl+C.",
    examples: [["Follow logs", "synthetic logs"]],
  });

  execute() {
    return streamLogs();
  }
}

class UpgradeCommand extends Command {
  static paths = [["upgrade"]];
  static usage = Command.Usage({
    category: "Runtime",
    description: "Download and install the latest Synthetic release.",
    details:
      "Stops the current daemon if running, then executes the configured installer command (curl | bash by default).",
    examples: [["Upgrade to latest version", "synthetic upgrade"]],
  });

  execute() {
    return runUpgrade();
  }
}

class InfoCommand extends Command {
  static paths = [["info"]];
  static usage = Command.Usage({
    category: "Diagnostics",
    description: "Print paths, version, and daemon status.",
    examples: [["Check current install", "synthetic info"]],
  });

  execute() {
    const syntheticHome = resolveSyntheticHomePath();
    const logDir = resolveLogDirectory();
    const logFile = resolveLogFilePath();
    const summaryRows: [string, string][] = [
      ["Version", CLI_VERSION],
      ["Synthetic home", syntheticHome],
      ["Release", binaryDirectory],
      ["Binary", process.execPath],
      ["Logs", logDir],
      ["Log file", logFile],
      ["PID file", pidFilePath],
      ["Daemon", describePidStatus()],
      ["Default UI", DEFAULT_WEB_URL],
    ];

    printSummary("Synthetic environment", summaryRows);
    return Promise.resolve(0);
  }
}

class CompletionsCommand extends Command {
  static paths = [["completions"]];
  static usage = Command.Usage({
    category: "Tooling",
    description: "Print the completion script for a supported shell.",
    examples: [["Generate zsh completions", "synthetic completions zsh"]],
  });

  shell = Option.String({
    name: "shell",
    required: true,
  });

  execute() {
    const normalized = normalizeShell(this.shell);
    if (!normalized) {
      logError(
        `Unsupported shell "${this.shell}". Supported shells: ${supportedShellList()}`
      );
      return Promise.resolve(1);
    }

    const script = renderCompletionScript(normalized);
    if (!script) {
      logError("Failed to render completion script.");
      return Promise.resolve(1);
    }

    process.stdout.write(ensureTrailingNewline(script));
    return Promise.resolve(0);
  }
}

class CompletionsInstallCommand extends Command {
  static paths = [["completions", "install"]];
  static usage = Command.Usage({
    category: "Tooling",
    description: "Install the completion script to a default or custom path.",
    details:
      "Detects common shell-specific directories (Oh My Zsh custom dir, ~/.local/share/bash-completion/completions, ~/.config/fish/completions, etc.). Pass a destination argument to override the target path.",
    examples: [
      ["Install completions for zsh", "synthetic completions install zsh"],
      [
        "Install to a custom location",
        "synthetic completions install zsh ~/.config/zsh/completions/_synthetic",
      ],
    ],
  });

  shell = Option.String({
    name: "shell",
    required: true,
  });

  destination = Option.String({
    name: "destination",
  });

  execute() {
    const normalized = normalizeShell(this.shell);
    if (!normalized) {
      logError(
        `Unsupported shell "${this.shell}". Supported shells: ${supportedShellList()}`
      );
      return Promise.resolve(1);
    }

    const result = installCompletionScript(normalized, this.destination);
    if (!result.ok) {
      logError(`Failed to install completions: ${result.message}`);
      return Promise.resolve(1);
    }

    logSuccess(
      `Installed synthetic completions for ${normalized} at ${result.path}`
    );
    logInfo("Restart your shell to load them.");
    return Promise.resolve(0);
  }
}

const cli = new Cli({
  binaryLabel: "Synthetic CLI",
  binaryName: "synthetic",
  binaryVersion: CLI_VERSION,
});

cli.register(StartCommand);
cli.register(StopCommand);
cli.register(LogsCommand);
cli.register(UpgradeCommand);
cli.register(InfoCommand);
cli.register(CompletionsCommand);
cli.register(CompletionsInstallCommand);
cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);

const runCli = async () => {
  try {
    const exitCode = await cli.run(rawArgv, Cli.defaultContext);
    if (typeof exitCode === "number") {
      process.exit(exitCode);
    }
  } catch (error) {
    logError(
      `Failed to start Synthetic: ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }`
    );
    process.exit(1);
  }
};

runCli();
