import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { join } from "node:path";
import { wait } from "./wait";

const SIGTERM_EXIT_CODE = 143;

export type ManagedProcess = {
  name: string;
  child: ReturnType<typeof spawn>;
  stdoutPath: string;
  stderrPath: string;
  processGroupId: number | null;
};

export type ProcessEntry = {
  pid: number;
  args: string;
};

export type CommandOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  label: string;
  streamOutput?: boolean;
  timeoutMs?: number;
};

type ManagedProcessOptions = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logsDir: string;
  name: string;
};

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions
): Promise<void> {
  await runCommandInternal(command, args, options);
}

export async function runCommandCapture(
  command: string,
  args: string[],
  options: CommandOptions
): Promise<string> {
  const output = await runCommandInternal(command, args, options);
  return output.trim();
}

export function runInheritedCommand(options: {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  failureExitCode: number;
}): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        resolve(options.failureExitCode);
        return;
      }

      resolve(code ?? options.failureExitCode);
    });

    child.on("error", () => {
      resolve(options.failureExitCode);
    });
  });
}

export function startManagedProcess(
  options: ManagedProcessOptions
): ManagedProcess {
  const stdoutPath = join(options.logsDir, `${options.name}.stdout.log`);
  const stderrPath = join(options.logsDir, `${options.name}.stderr.log`);
  const stdoutStream = createWriteStream(stdoutPath, { flags: "a" });
  const stderrStream = createWriteStream(stderrPath, { flags: "a" });

  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.pipe(stdoutStream);
  child.stderr?.pipe(stderrStream);

  child.on("exit", (code) => {
    stdoutStream.end();
    stderrStream.end();
    if (code !== null && code !== 0 && code !== SIGTERM_EXIT_CODE) {
      process.stderr.write(
        `${options.name} exited unexpectedly with code ${String(code)}\n`
      );
    }
  });

  return {
    name: options.name,
    child,
    stdoutPath,
    stderrPath,
    processGroupId: process.platform !== "win32" ? (child.pid ?? null) : null,
  };
}

export async function stopManagedProcess(
  managedProcess: ManagedProcess,
  options: { cleanupTimeoutMs: number; warnOnMissingLogs?: boolean }
): Promise<void> {
  const { child, name, stdoutPath, stderrPath, processGroupId } =
    managedProcess;
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      sendManagedProcessSignal(child, processGroupId, "SIGKILL");
    }, options.cleanupTimeoutMs);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    sendManagedProcessSignal(child, processGroupId, "SIGTERM");
  });

  if (options.warnOnMissingLogs) {
    const missingLogs = [stdoutPath, stderrPath].filter(
      (path) => !existsSync(path)
    );
    if (missingLogs.length > 0) {
      process.stderr.write(
        `Warning: missing ${name} log files: ${missingLogs.join(", ")}\n`
      );
    }
  }
}

export async function stopManagedProcesses(
  managedProcesses: ManagedProcess[],
  stopProcess: (managedProcess: ManagedProcess) => Promise<void>
): Promise<void> {
  await Promise.all([...managedProcesses].reverse().map(stopProcess));
}

export function createManagedProcessStopper(options: {
  cleanupTimeoutMs: number;
  warnOnMissingLogs?: boolean;
}): (managedProcess: ManagedProcess) => Promise<void> {
  return (managedProcess) => stopManagedProcess(managedProcess, options);
}

export async function startProcessWithRetries(options: {
  attempts: number;
  retryDelayMs: number;
  startProcess: () => ManagedProcess;
  stopProcess: (managedProcess: ManagedProcess) => Promise<void>;
  waitUntilReady: () => Promise<void>;
}): Promise<ManagedProcess> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const managedProcess = options.startProcess();

    try {
      await options.waitUntilReady();
      return managedProcess;
    } catch (error) {
      await options.stopProcess(managedProcess);

      lastError =
        error instanceof Error
          ? error
          : new Error(`Server startup attempt ${String(attempt)} failed`);

      if (attempt >= options.attempts) {
        break;
      }

      process.stderr.write(
        `Server startup attempt ${String(attempt)} failed, retrying...\n`
      );
      await wait(options.retryDelayMs);
    }
  }

  throw (
    lastError ?? new Error("Server failed to start and no error was captured")
  );
}

export function readProcessTable(): ProcessEntry[] {
  let output = "";
  try {
    output = execFileSync("ps", ["-eo", "pid,args"], {
      encoding: "utf8",
    });
  } catch {
    return [];
  }

  const entries: ProcessEntry[] = [];
  for (const line of output.split("\n").slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const firstSpace = trimmed.indexOf(" ");
    if (firstSpace <= 0) {
      continue;
    }

    const pid = Number(trimmed.slice(0, firstSpace));
    const args = trimmed.slice(firstSpace + 1).trim();
    if (!(Number.isFinite(pid) && args)) {
      continue;
    }

    entries.push({ args, pid });
  }

  return entries;
}

export async function terminateProcessIds(
  pids: number[],
  options: { terminateWaitMs: number }
): Promise<number> {
  const uniquePids = [...new Set(pids)].filter((pid) => Number.isFinite(pid));
  if (uniquePids.length === 0) {
    return 0;
  }

  for (const pid of uniquePids) {
    sendSignalSafe(pid, "SIGTERM");
  }

  await wait(options.terminateWaitMs);

  const stillRunning = new Set(readProcessTable().map((entry) => entry.pid));
  const remaining = uniquePids.filter((pid) => stillRunning.has(pid));

  for (const pid of remaining) {
    sendSignalSafe(pid, "SIGKILL");
  }

  return uniquePids.length;
}

async function runCommandInternal(
  command: string,
  args: string[],
  options: CommandOptions
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";
    const timeout =
      typeof options.timeoutMs === "number"
        ? setTimeout(() => {
            child.kill("SIGKILL");
          }, options.timeoutMs)
        : null;

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      if (options.streamOutput) {
        process.stdout.write(chunk);
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (options.streamOutput) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    child.on("exit", (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `${options.label} failed (exit ${String(
            code
          )})\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
        )
      );
    });
  });
}

function sendManagedProcessSignal(
  child: ReturnType<typeof spawn>,
  processGroupId: number | null,
  signal: NodeJS.Signals
): void {
  if (processGroupId) {
    try {
      process.kill(-processGroupId, signal);
      return;
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
  }

  if (child.exitCode !== null || child.killed) {
    return;
  }

  try {
    child.kill(signal);
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
  }
}

function sendSignalSafe(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
  }
}

function isMissingProcessError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ESRCH"
  );
}
