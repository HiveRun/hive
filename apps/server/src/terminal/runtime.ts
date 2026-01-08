import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { Cell } from "../schema/cells";

const HIVE_TERMINAL_UNAVAILABLE_MESSAGE =
  "The Hive terminal is currently unavailable in this build.";

export type TerminalStreamKind = "stdout" | "stderr";

export type TerminalOutputEvent = {
  data: string;
  stream: TerminalStreamKind;
};

export type TerminalExitEvent = {
  code: number | null;
};

export type TerminalProcessHandle = {
  write: (data: string) => Promise<void>;
  dispose: () => Promise<void>;
};

export type TerminalProcessHooks = {
  onOutput: (event: TerminalOutputEvent) => void;
  onExit: (event: TerminalExitEvent) => void;
};

export type CreateTerminalProcessArgs = {
  cell: Cell;
  hooks: TerminalProcessHooks;
};

function ensureWorkspacePath(cell: Cell): string {
  const workspacePath = cell.workspacePath;
  if (!workspacePath) {
    throw new Error("Cell workspace path missing");
  }
  return workspacePath;
}

function buildBaseEnv(cell: Cell): Record<string, string> {
  const workspacePath = ensureWorkspacePath(cell);
  const hiveHome = resolve(workspacePath, ".hive", "home");
  mkdirSync(hiveHome, { recursive: true });

  return {
    HIVE_CELL_ID: cell.id,
    HIVE_SERVICE: "terminal",
    HIVE_HOME: hiveHome,
    HIVE_BROWSE_ROOT: workspacePath,
  };
}

export function createTerminalProcess(
  args: CreateTerminalProcessArgs
): TerminalProcessHandle {
  const { cell, hooks } = args;
  // Preserve the side effects of workspace directory preparation so that we
  // do not change expectations for existing cells, even though the terminal
  // itself is disabled.
  buildBaseEnv(cell);

  hooks.onOutput({
    data: `${HIVE_TERMINAL_UNAVAILABLE_MESSAGE}\n`,
    stream: "stderr",
  });
  hooks.onExit({ code: null });

  const write = async () => {
    // Terminal is disabled; ignore all input.
  };

  const dispose = async () => {
    // Nothing to dispose when the terminal is disabled.
  };

  return {
    write,
    dispose,
  };
}
