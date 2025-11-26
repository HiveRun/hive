import "dotenv/config";
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
import { basename, dirname, join } from "node:path";

import {
  binaryDirectory,
  cleanupPidFile,
  DEFAULT_WEB_URL,
  pidFilePath,
  startServer,
} from "@synthetic/server";

const DEFAULT_INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/SyntheticRun/synthetic/main/scripts/install.sh | bash";
const LOCAL_INSTALL_SCRIPT_PATH = join(binaryDirectory, "install.sh");

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

const stopBackgroundProcess = (options?: { silent?: boolean }) => {
  const silent = options?.silent ?? false;
  const log = (message: string) => {
    if (!silent) {
      process.stdout.write(`${message}\n`);
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
    process.stderr.write(
      `Unable to read pid file ${pidFilePath}: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    return "failed" as const;
  }

  const pid = Number(pidText);
  if (!pid || Number.isNaN(pid)) {
    process.stderr.write(`Pid file ${pidFilePath} contains invalid data.\n`);
    cleanupPidFile();
    return "failed" as const;
  }

  try {
    process.kill(pid, "SIGTERM");
    log(`Stopped Synthetic (PID ${pid}).`);
  } catch (error) {
    process.stderr.write(
      `Failed to stop Synthetic (PID ${pid}): ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    return "failed" as const;
  }

  cleanupPidFile();
  return "stopped" as const;
};

const stopBackgroundServer = () => {
  const result = stopBackgroundProcess();
  process.exit(result === "failed" ? 1 : 0);
};

const streamLogs = () => {
  const logFile = resolveLogFilePath();
  if (!existsSync(logFile)) {
    process.stderr.write(
      `No log file found at ${logFile}. Start Synthetic before streaming logs.\n`
    );
    process.exit(1);
  }

  process.stdout.write(
    `Streaming logs from ${logFile}. Press Ctrl+C to stop.\n\n`
  );

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
      process.stderr.write(
        `Failed to read log updates: ${
          error instanceof Error ? error.message : String(error)
        }\n`
      );
    }
  });

  const cleanup = () => {
    watcher.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
};

const runUpgrade = () => {
  const stopResult = stopBackgroundProcess({ silent: true });
  if (stopResult === "failed") {
    process.stderr.write(
      "Unable to stop the running instance. Aborting upgrade.\n"
    );
    process.exit(1);
    return;
  }

  if (stopResult === "stopped") {
    process.stdout.write("Stopped running instance.\n");
  }

  const configuredCommand = process.env.SYNTHETIC_INSTALL_COMMAND;
  const storedInstallUrl = process.env.SYNTHETIC_INSTALL_URL;
  const env = { ...process.env };
  if (storedInstallUrl) {
    env.SYNTHETIC_INSTALL_URL = storedInstallUrl;
  }
  process.stdout.write("Downloading and installing the latest release...\n");

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
      process.stdout.write(
        "Synthetic upgraded successfully. Run `synthetic` to start the new version.\n"
      );
    } else {
      process.stderr.write(`Upgrade command exited with code ${exitCode}.\n`);
    }
    process.exit(exitCode);
  });
};

const printHelp = () => {
  const lines = [
    "Synthetic CLI",
    "",
    "Usage:",
    "  synthetic           Start the server and UI (background by default)",
    "  synthetic stop      Stop the background process",
    "  synthetic logs      Stream logs from the background process",
    "  synthetic upgrade   Reinstall using the stored installer metadata",
    "  synthetic help      Show this help output",
    "",
    "Flags:",
    "  --help, -h          Show this help output",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
};

const runtimeExecutable = basename(process.execPath).toLowerCase();
const isBunRuntime = runtimeExecutable.startsWith("bun");
const isCompiledRuntime = !isBunRuntime;
const isForcedForeground = process.env.SYNTHETIC_FOREGROUND === "1";
const shouldRunDetached = isCompiledRuntime && !isForcedForeground;

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
    process.stderr.write(
      `Failed to write pid file ${pidFilePath}: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
  }

  const lines = [
    "Synthetic is running in the background.",
    `UI: ${DEFAULT_WEB_URL}`,
    `Logs: ${logFile}`,
    `PID file: ${pidFilePath}`,
    "Stop with: synthetic stop",
    "Tail logs with: synthetic logs",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(0);
};

const cliArgs = process.argv.slice(2);
const primaryCliCommand = cliArgs[0];
const isStopCommand = primaryCliCommand === "stop";
const isLogsCommand = primaryCliCommand === "logs";
const isUpgradeCommand = primaryCliCommand === "upgrade";
const isHelpCommand = primaryCliCommand === "help";
const hasHelpFlag = cliArgs.includes("--help") || cliArgs.includes("-h");
const shouldShowHelp = isHelpCommand || hasHelpFlag;

const bootstrap = async () => {
  if (shouldRunDetached) {
    try {
      startDetachedServer();
      return;
    } catch (error) {
      process.stderr.write(
        `Failed to launch background process: ${
          error instanceof Error ? error.message : String(error)
        }. Falling back to foreground mode.\n`
      );
    }
  }

  await startServer();
};

const run = async () => {
  if (shouldShowHelp) {
    printHelp();
    process.exit(0);
    return;
  }

  if (isStopCommand) {
    stopBackgroundServer();
    return;
  }

  if (isLogsCommand) {
    streamLogs();
    return;
  }

  if (isUpgradeCommand) {
    runUpgrade();
    return;
  }

  await bootstrap();
};

run().catch((error) => {
  process.stderr.write(
    `Failed to start Synthetic: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }\n`
  );
  process.exit(1);
});
