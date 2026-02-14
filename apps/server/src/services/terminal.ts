import { EventEmitter } from "node:events";

import { type IExitEvent, type IPty, spawn } from "bun-pty";

const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 36;
const MAX_TERMINAL_BUFFER_CHARS = 250_000;
const TERMINAL_NAME = "xterm-256color";
const DEFAULT_SHELL =
  process.env.SHELL ??
  (process.platform === "win32"
    ? (process.env.COMSPEC ?? "powershell.exe")
    : "/bin/bash");

export type CellTerminalStatus = "running" | "exited";

export type CellTerminalSession = {
  sessionId: string;
  cellId: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  status: CellTerminalStatus;
  exitCode: number | null;
  startedAt: string;
};

export type CellTerminalEvent =
  | { type: "data"; chunk: string }
  | {
      type: "exit";
      exitCode: number;
      signal: number | string | null;
    };

type CellTerminalRecord = {
  sessionId: string;
  cellId: string;
  cwd: string;
  pty: IPty;
  cols: number;
  rows: number;
  status: CellTerminalStatus;
  exitCode: number | null;
  startedAt: Date;
  buffer: string;
};

export type CellTerminalService = {
  ensureSession(args: {
    cellId: string;
    workspacePath: string;
  }): CellTerminalSession;
  getSession(cellId: string): CellTerminalSession | null;
  readOutput(cellId: string): string;
  subscribe(
    cellId: string,
    listener: (event: CellTerminalEvent) => void
  ): () => void;
  write(cellId: string, data: string): void;
  resize(cellId: string, cols: number, rows: number): void;
  closeSession(cellId: string): void;
  stopAll(): void;
};

const toSession = (record: CellTerminalRecord): CellTerminalSession => ({
  sessionId: record.sessionId,
  cellId: record.cellId,
  pid: record.pty.pid,
  cwd: record.cwd,
  cols: record.cols,
  rows: record.rows,
  status: record.status,
  exitCode: record.exitCode,
  startedAt: record.startedAt.toISOString(),
});

const appendBuffer = (current: string, chunk: string): string => {
  if (!chunk.length) {
    return current;
  }

  const next = `${current}${chunk}`;
  if (next.length <= MAX_TERMINAL_BUFFER_CHARS) {
    return next;
  }

  return next.slice(next.length - MAX_TERMINAL_BUFFER_CHARS);
};

const normalizeSignal = (
  signal: IExitEvent["signal"]
): number | string | null =>
  typeof signal === "number" || typeof signal === "string" ? signal : null;

const createChannel = (cellId: string): string => `cell:${cellId}`;

const createCellTerminalService = (): CellTerminalService => {
  const sessions = new Map<string, CellTerminalRecord>();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  const closeSession = (cellId: string) => {
    const record = sessions.get(cellId);
    if (!record) {
      return;
    }

    try {
      record.pty.kill();
    } catch {
      // ignore kill failures on already-exited sessions
    }

    sessions.delete(cellId);
  };

  const ensureSession: CellTerminalService["ensureSession"] = ({
    cellId,
    workspacePath,
  }) => {
    const existing = sessions.get(cellId);
    if (existing && existing.status === "running") {
      return toSession(existing);
    }

    if (existing) {
      closeSession(cellId);
    }

    const pty = spawn(DEFAULT_SHELL, [], {
      name: TERMINAL_NAME,
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
      cwd: workspacePath,
      env: {
        ...process.env,
        TERM: TERMINAL_NAME,
      },
    });

    const record: CellTerminalRecord = {
      sessionId: `terminal_${crypto.randomUUID()}`,
      cellId,
      pty,
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
      cwd: workspacePath,
      status: "running",
      exitCode: null,
      startedAt: new Date(),
      buffer: "",
    };

    pty.onData((chunk: string) => {
      record.buffer = appendBuffer(record.buffer, chunk);
      emitter.emit(createChannel(cellId), {
        type: "data",
        chunk,
      } satisfies CellTerminalEvent);
    });

    pty.onExit(({ exitCode, signal }: IExitEvent) => {
      record.status = "exited";
      record.exitCode = exitCode;
      emitter.emit(createChannel(cellId), {
        type: "exit",
        exitCode,
        signal: normalizeSignal(signal),
      } satisfies CellTerminalEvent);
    });

    sessions.set(cellId, record);

    return toSession(record);
  };

  return {
    ensureSession,
    getSession(cellId) {
      const record = sessions.get(cellId);
      return record ? toSession(record) : null;
    },
    readOutput(cellId) {
      return sessions.get(cellId)?.buffer ?? "";
    },
    subscribe(cellId, listener) {
      const channel = createChannel(cellId);
      emitter.on(channel, listener);
      return () => {
        emitter.off(channel, listener);
      };
    },
    write(cellId, data) {
      const record = sessions.get(cellId);
      if (!record || record.status !== "running") {
        throw new Error("Terminal session is not running");
      }
      record.pty.write(data);
    },
    resize(cellId, cols, rows) {
      const record = sessions.get(cellId);
      if (!record || record.status !== "running") {
        throw new Error("Terminal session is not running");
      }
      record.cols = cols;
      record.rows = rows;
      record.pty.resize(cols, rows);
    },
    closeSession,
    stopAll() {
      for (const cellId of [...sessions.keys()]) {
        closeSession(cellId);
      }
    },
  };
};

export const cellTerminalService = createCellTerminalService();
