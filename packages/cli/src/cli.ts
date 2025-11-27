const rawArgv = process.argv.slice(2);
if (!process.env.SYNTHETIC_SHELL_MODE) {
  await import("dotenv/config");
}

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
import { basename, dirname, join } from "node:path";

import {
  binaryDirectory,
  cleanupPidFile,
  DEFAULT_WEB_URL,
  pidFilePath,
  startServer,
} from "@synthetic/server";
import { Cli, Command, Option } from "clipanion";
import pc from "picocolors";

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

const renderHelp = () => {
  const lines = [
    pc.bold(pc.green("Synthetic CLI")),
    "",
    pc.bold("Usage"),
    "  synthetic [--foreground]",
    "  synthetic stop",
    "  synthetic logs",
    "  synthetic upgrade",
    "  synthetic info",
    "  synthetic completions <shell>",
    "",
    pc.bold("Options"),
    "  --foreground    Run in the foreground instead of background mode",
    "  --help, -h      Show this help output",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
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
    return 1;
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

  readNewData();

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

  const cleanup = () => {
    watcher.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return 0;
};

const runUpgrade = () => {
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

  child.on("exit", (code) => {
    const exitCode = code ?? 0;
    if (exitCode === 0) {
      logSuccess(
        "Synthetic upgraded successfully. Run `synthetic` to start the new version."
      );
    } else {
      logError(`Upgrade command exited with code ${exitCode}.`);
    }
    process.exit(exitCode);
  });

  return 0;
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

  forceForeground = Option.Boolean("--foreground", {
    description: "Run in the foreground instead of background mode",
  });

  async execute() {
    await bootstrap({ forceForeground: Boolean(this.forceForeground) });
  }
}

class StopCommand extends Command {
  static paths = [["stop"]];

  execute() {
    const result = stopBackgroundProcess();
    return Promise.resolve(result === "failed" ? 1 : 0);
  }
}

class LogsCommand extends Command {
  static paths = [["logs"]];

  execute() {
    return Promise.resolve(streamLogs());
  }
}

class UpgradeCommand extends Command {
  static paths = [["upgrade"]];

  execute() {
    return Promise.resolve(runUpgrade());
  }
}

class InfoCommand extends Command {
  static paths = [["info"]];

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

const wantsHelp =
  rawArgv.includes("--help") || rawArgv.includes("-h") || rawArgv[0] === "help";

if (wantsHelp) {
  renderHelp();
  process.exit(0);
}

const runCli = async () => {
  try {
    const exitCode = await cli.run(rawArgv);
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
