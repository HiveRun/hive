import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { Cell } from "../schema/cells";

const DEFAULT_SHELL = process.env.SHELL || "/bin/bash";
const STOP_TIMEOUT_MS = 2000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

async function terminateChild(child: Bun.Subprocess): Promise<void> {
  let exited = false;

  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore initial termination errors */
  }

  const exit = await Promise.race([
    child.exited.then((code) => {
      exited = true;
      return code;
    }),
    new Promise<number>((resolveTimeout) => {
      setTimeout(() => resolveTimeout(-1), STOP_TIMEOUT_MS);
    }),
  ]);

  if (exit === -1 && !exited) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore forced termination errors */
    }
    try {
      await child.exited;
    } catch {
      /* swallow errors when waiting for exit */
    }
  }
}

async function forwardStream(
  stream: ReadableStream<Uint8Array> | null,
  kind: TerminalStreamKind,
  hooks: TerminalProcessHooks
): Promise<void> {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value?.length) {
        continue;
      }
      const data = textDecoder.decode(value);
      if (!data) {
        continue;
      }
      hooks.onOutput({ data, stream: kind });
    }
  } catch {
    // Stream closures and errors are surfaced via onExit
  } finally {
    reader.releaseLock();
  }
}

export function createTerminalProcess(
  args: CreateTerminalProcessArgs
): TerminalProcessHandle {
  const { cell, hooks } = args;
  const workspacePath = ensureWorkspacePath(cell);
  const baseEnv = buildBaseEnv(cell);

  const child = Bun.spawn({
    cmd: [DEFAULT_SHELL, "-l"],
    cwd: workspacePath,
    env: {
      ...process.env,
      ...baseEnv,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  let closed = false;

  const stdin = child.stdin as unknown as {
    write(chunk: Uint8Array): Promise<void> | Promise<number>;
    end(): Promise<void> | void;
  } | null;

  const write = async (data: string) => {
    if (!stdin || closed || !data) {
      return;
    }
    try {
      const payload = textEncoder.encode(data);
      await stdin.write(payload);
    } catch {
      // Writing after exit or on error should be a no-op for callers
    }
  };

  const dispose = async () => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      await stdin?.end();
    } catch {
      /* ignore writer close errors */
    }
    await terminateChild(child);
  };

  // Start background forwarding tasks; they intentionally run without awaiting
  forwardStream(child.stdout, "stdout", hooks).catch(() => {
    /* errors are handled via exit handling */
  });
  forwardStream(child.stderr, "stderr", hooks).catch(() => {
    /* errors are handled via exit handling */
  });

  child.exited
    .then((code) => {
      closed = true;
      hooks.onExit({ code });
    })
    .catch(() => {
      closed = true;
      hooks.onExit({ code: null });
    });

  return {
    write,
    dispose,
  };
}
