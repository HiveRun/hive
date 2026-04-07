export type SetupCommandProgressState =
  | "pending"
  | "running"
  | "done"
  | "error";

export type SetupCommandProgress = {
  command: string;
  state: SetupCommandProgressState;
};

const SETUP_RUN_START_MARKER = "[setup] Starting template setup for";
const SETUP_RUNNING_PREFIX = "[setup] Running: ";
const SETUP_COMPLETED_PREFIX = "[setup] Completed: ";
const SETUP_FAILED_PREFIX = "[setup] Failed: ";
const LINE_SPLIT_RE = /\r?\n/;
const FAILED_EXIT_SUFFIX_RE = /\s+\(exit\s+\d+\)$/;

export function buildSetupCommandProgress(args: {
  commands: string[];
  cellStatus?: string | null;
  setupLog: string | null | undefined;
}): SetupCommandProgress[] {
  const progress = args.commands.map((command) => ({
    command,
    state: "pending" as SetupCommandProgressState,
  }));

  const setupLog = latestSetupRunLog(args.setupLog);
  if (!(progress.length > 0 && setupLog)) {
    return progress;
  }

  for (const line of setupLog.split(LINE_SPLIT_RE)) {
    const nextState = parseSetupCommandState(line);
    if (!nextState) {
      continue;
    }

    const index = findCommandIndex(
      progress,
      nextState.command,
      nextState.preferredStates
    );
    if (index !== -1) {
      progress[index] = {
        command: progress[index]?.command ?? nextState.command,
        state: nextState.state,
      };
    }
  }

  reconcileTerminalLag(progress, args.cellStatus);

  return progress;
}

function latestSetupRunLog(setupLog: string | null | undefined): string {
  if (!setupLog) {
    return "";
  }

  const lastRunStart = setupLog.lastIndexOf(SETUP_RUN_START_MARKER);
  if (lastRunStart === -1) {
    return setupLog;
  }

  return setupLog.slice(lastRunStart);
}

function findCommandIndex(
  progress: SetupCommandProgress[],
  command: string,
  preferredStates: SetupCommandProgressState[]
): number {
  for (const preferredState of preferredStates) {
    const index = progress.findIndex(
      (item) => item.command === command && item.state === preferredState
    );

    if (index !== -1) {
      return index;
    }
  }

  return -1;
}

function reconcileTerminalLag(
  progress: SetupCommandProgress[],
  cellStatus: string | null | undefined
) {
  const lastRunningIndex = findLastRunningIndex(progress);
  if (lastRunningIndex === -1) {
    return;
  }

  if (cellStatus === "error") {
    progress[lastRunningIndex] = {
      command: progress[lastRunningIndex]?.command ?? "",
      state: "error",
    };
    return;
  }

  if (cellStatus === "ready") {
    progress[lastRunningIndex] = {
      command: progress[lastRunningIndex]?.command ?? "",
      state: "done",
    };
  }
}

function findLastRunningIndex(progress: SetupCommandProgress[]): number {
  for (let index = progress.length - 1; index >= 0; index -= 1) {
    if (progress[index]?.state === "running") {
      return index;
    }
  }

  return -1;
}

function parseSetupCommandState(line: string): {
  command: string;
  state: SetupCommandProgressState;
  preferredStates: SetupCommandProgressState[];
} | null {
  const runningCommand = commandAfterPrefix(line, SETUP_RUNNING_PREFIX);
  if (runningCommand) {
    return {
      command: runningCommand,
      state: "running",
      preferredStates: ["pending", "running"],
    };
  }

  const completedCommand = commandAfterPrefix(line, SETUP_COMPLETED_PREFIX);
  if (completedCommand) {
    return {
      command: completedCommand,
      state: "done",
      preferredStates: ["running", "pending"],
    };
  }

  const failedCommand = commandAfterPrefix(line, SETUP_FAILED_PREFIX);
  if (failedCommand) {
    return {
      command: failedCommand.replace(FAILED_EXIT_SUFFIX_RE, ""),
      state: "error",
      preferredStates: ["running", "pending"],
    };
  }

  return null;
}

function commandAfterPrefix(line: string, prefix: string): string | null {
  const prefixIndex = line.indexOf(prefix);
  if (prefixIndex === -1) {
    return null;
  }

  return line.slice(prefixIndex + prefix.length);
}
