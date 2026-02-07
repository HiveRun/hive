import { EventEmitter } from "node:events";

import { type IExitEvent, type IPty, spawn } from "bun-pty";
import { Context, Layer } from "effect";

const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 36;
const MAX_TERMINAL_BUFFER_CHARS = 2_000_000;
const BUFFER_RETAIN_CHARS = 1_600_000;
const TERMINAL_RESET_SEQUENCE = "\x1bc";
const TERMINAL_NAME = "xterm-256color";
const INSTALL_HINT = "curl -fsSL https://opencode.ai/install | bash";

export type ChatTerminalStatus = "running" | "exited";

export type ChatTerminalSession = {
  sessionId: string;
  cellId: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  status: ChatTerminalStatus;
  exitCode: number | null;
  startedAt: string;
};

export type ChatTerminalEvent =
  | { type: "data"; chunk: string }
  | {
      type: "exit";
      exitCode: number;
      signal: number | string | null;
    };

type ChatTerminalRecord = {
  sessionId: string;
  cellId: string;
  cwd: string;
  pty: IPty;
  cols: number;
  rows: number;
  status: ChatTerminalStatus;
  exitCode: number | null;
  startedAt: Date;
  buffer: string;
  opencodeSessionId: string;
  opencodeServerUrl: string;
};

export type ChatTerminalService = {
  ensureSession(args: {
    cellId: string;
    workspacePath: string;
    opencodeSessionId: string;
    opencodeServerUrl: string;
  }): ChatTerminalSession;
  getSession(cellId: string): ChatTerminalSession | null;
  readOutput(cellId: string): string;
  subscribe(
    cellId: string,
    listener: (event: ChatTerminalEvent) => void
  ): () => void;
  write(cellId: string, data: string): void;
  resize(cellId: string, cols: number, rows: number): void;
  closeSession(cellId: string): void;
  stopAll(): void;
};

const toSession = (record: ChatTerminalRecord): ChatTerminalSession => ({
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

  const retainStart = Math.max(0, next.length - BUFFER_RETAIN_CHARS);
  const newlineBoundary = next.indexOf("\n", retainStart);
  const sliceStart = newlineBoundary >= 0 ? newlineBoundary + 1 : retainStart;
  const trimmed = next.slice(sliceStart);

  return `${TERMINAL_RESET_SEQUENCE}${trimmed}`;
};

const normalizeSignal = (
  signal: IExitEvent["signal"]
): number | string | null =>
  typeof signal === "number" || typeof signal === "string" ? signal : null;

const createChannel = (cellId: string): string => `chat:${cellId}`;

const resolveOpencodeBinary = (): string => {
  const configured = process.env.HIVE_OPENCODE_BIN?.trim();
  return configured && configured.length > 0 ? configured : "opencode";
};

const createSpawnErrorMessage = (binary: string, error: unknown): string => {
  const reason = error instanceof Error ? error.message : String(error);
  return `Failed to start OpenCode chat terminal using '${binary}'. ${reason}. Install OpenCode with '${INSTALL_HINT}' or set HIVE_OPENCODE_BIN to the executable path.`;
};

const createChatTerminalService = (): ChatTerminalService => {
  const sessions = new Map<string, ChatTerminalRecord>();
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

  const ensureSession: ChatTerminalService["ensureSession"] = ({
    cellId,
    workspacePath,
    opencodeSessionId,
    opencodeServerUrl,
  }) => {
    const existing = sessions.get(cellId);
    if (
      existing &&
      existing.status === "running" &&
      existing.cwd === workspacePath &&
      existing.opencodeSessionId === opencodeSessionId &&
      existing.opencodeServerUrl === opencodeServerUrl
    ) {
      return toSession(existing);
    }

    if (existing) {
      closeSession(cellId);
    }

    const opencodeBinary = resolveOpencodeBinary();

    let pty: IPty;
    try {
      pty = spawn(
        opencodeBinary,
        [
          "attach",
          opencodeServerUrl,
          "--dir",
          workspacePath,
          "--session",
          opencodeSessionId,
        ],
        {
          name: TERMINAL_NAME,
          cols: DEFAULT_TERMINAL_COLS,
          rows: DEFAULT_TERMINAL_ROWS,
          cwd: workspacePath,
          env: {
            ...process.env,
            TERM: TERMINAL_NAME,
          },
        }
      );
    } catch (error) {
      throw new Error(createSpawnErrorMessage(opencodeBinary, error));
    }

    const record: ChatTerminalRecord = {
      sessionId: `chat_terminal_${crypto.randomUUID()}`,
      cellId,
      pty,
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
      cwd: workspacePath,
      status: "running",
      exitCode: null,
      startedAt: new Date(),
      buffer: "",
      opencodeSessionId,
      opencodeServerUrl,
    };

    pty.onData((chunk: string) => {
      record.buffer = appendBuffer(record.buffer, chunk);
      emitter.emit(createChannel(cellId), {
        type: "data",
        chunk,
      } satisfies ChatTerminalEvent);
    });

    pty.onExit(({ exitCode, signal }: IExitEvent) => {
      record.status = "exited";
      record.exitCode = exitCode;
      emitter.emit(createChannel(cellId), {
        type: "exit",
        exitCode,
        signal: normalizeSignal(signal),
      } satisfies ChatTerminalEvent);
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
        throw new Error("Chat terminal session is not running");
      }
      record.pty.write(data);
    },
    resize(cellId, cols, rows) {
      const record = sessions.get(cellId);
      if (!record || record.status !== "running") {
        throw new Error("Chat terminal session is not running");
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

export const ChatTerminalServiceTag = Context.GenericTag<ChatTerminalService>(
  "@hive/server/ChatTerminalService"
);

export const ChatTerminalServiceLayer = Layer.succeed(
  ChatTerminalServiceTag,
  createChatTerminalService()
);
