import type { ChildProcess } from "node:child_process";

type ForwardedChildOptions = {
  onSignal?: (signal: NodeJS.Signals) => void;
  processGroup?: boolean;
  shutdownTimeoutMs?: number;
};

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const PROCESS_GROUP_POLL_INTERVAL_MS = 50;
const SIGNAL_EXIT_CODE = 128;

const waitForExit = async (
  exit: Promise<number>,
  timeoutMs: number
): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const exited = await Promise.race([
    exit.then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref();
    }),
  ]);
  if (timer) {
    clearTimeout(timer);
  }
  return exited;
};

const isChildRunning = (child: ChildProcess): boolean =>
  child.exitCode === null && child.signalCode === null;

export const isProcessGroupRunning = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

export const terminateProcessGroup = async (
  pid: number,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS
): Promise<void> => {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) {
    throw new Error(`Refusing to terminate invalid process group ${pid}.`);
  }
  if (!isProcessGroupRunning(pid)) {
    return;
  }
  process.kill(-pid, "SIGTERM");
  if (!(await waitForProcessGroupExit(pid, shutdownTimeoutMs))) {
    process.kill(-pid, "SIGKILL");
    if (!(await waitForProcessGroupExit(pid, shutdownTimeoutMs))) {
      throw new Error(`Process group ${pid} did not stop.`);
    }
  }
};

const waitForProcessGroupExit = async (
  pid: number,
  timeoutMs: number
): Promise<boolean> => {
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; ) {
    if (!isProcessGroupRunning(pid)) {
      return true;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, PROCESS_GROUP_POLL_INTERVAL_MS)
    );
  }
  return !isProcessGroupRunning(pid);
};

export const signalChild = (
  child: ChildProcess,
  signal: NodeJS.Signals,
  processGroup = false
): void => {
  if (processGroup && process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through when the process group has already exited.
    }
  }
  if (isChildRunning(child)) {
    child.kill(signal);
  }
};

export const waitForChildExit = (child: ChildProcess): Promise<number> =>
  new Promise<number>((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code, signal) => {
      resolve(signal ? SIGNAL_EXIT_CODE : (code ?? 1));
    });
  });

export const terminateChild = async (
  child: ChildProcess,
  exit: Promise<number>,
  {
    processGroup = false,
    shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  }: ForwardedChildOptions = {}
): Promise<void> => {
  if (processGroup && process.platform !== "win32" && child.pid) {
    signalChild(child, "SIGTERM", true);
    if (!(await waitForProcessGroupExit(child.pid, shutdownTimeoutMs))) {
      signalChild(child, "SIGKILL", true);
      if (!(await waitForProcessGroupExit(child.pid, shutdownTimeoutMs))) {
        throw new Error(`Process group ${child.pid} did not stop.`);
      }
    }
    await exit;
    return;
  }

  if (!isChildRunning(child)) {
    await exit;
    return;
  }

  signalChild(child, "SIGTERM", processGroup);
  const exitedGracefully = await waitForExit(exit, shutdownTimeoutMs);
  if (!exitedGracefully) {
    signalChild(child, "SIGKILL", processGroup);
    if (!(await waitForExit(exit, shutdownTimeoutMs))) {
      throw new Error(`Process ${child.pid ?? "unknown"} did not stop.`);
    }
  }
};

export const forwardSignalsToChildren = (
  getChildren: () => ChildProcess[],
  {
    onSignal,
    processGroup = false,
    shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  }: ForwardedChildOptions = {}
): (() => void) => {
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
    const handler = () => {
      onSignal?.(signal);
      for (const child of getChildren()) {
        signalChild(child, signal, processGroup);
      }
      forceTimer ??= setTimeout(() => {
        for (const child of getChildren()) {
          signalChild(child, "SIGKILL", processGroup);
        }
      }, shutdownTimeoutMs);
      forceTimer.unref();
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  return () => {
    if (forceTimer) {
      clearTimeout(forceTimer);
    }
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
  };
};

export const waitForForwardedChild = async (
  child: ChildProcess,
  options: ForwardedChildOptions = {}
): Promise<number> => {
  const removeSignalHandlers = forwardSignalsToChildren(() => [child], options);
  const exit = waitForChildExit(child);
  try {
    return await exit;
  } finally {
    removeSignalHandlers();
    await terminateChild(child, exit, options);
  }
};
