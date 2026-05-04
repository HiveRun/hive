import { spawn } from "bun-pty";
import type {
  PtyTerminalProcess,
  TerminalEvent,
  TerminalRecordFields,
  TerminalSessionFields,
  TerminalSessionService,
} from "./terminal-store";
import {
  createPtySessionController,
  createTerminalRecordFields,
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  toTerminalSession,
  trimTerminalOutput,
} from "./terminal-store";

const MAX_TERMINAL_BUFFER_CHARS = 250_000;
const TERMINAL_NAME = "xterm-256color";
const DEFAULT_SHELL =
  process.env.SHELL ??
  (process.platform === "win32"
    ? (process.env.COMSPEC ?? "powershell.exe")
    : "/bin/bash");

export type CellTerminalSession = TerminalSessionFields & {
  cellId: string;
};

export type CellTerminalEvent = TerminalEvent;

type CellTerminalRecord = TerminalRecordFields & {
  cellId: string;
};

type CellTerminalService = TerminalSessionService<
  CellTerminalSession,
  CellTerminalEvent
> & {
  ensureSession(args: {
    cellId: string;
    workspacePath: string;
  }): CellTerminalSession;
};

const appendBuffer = (current: string, chunk: string): string =>
  trimTerminalOutput(current, chunk, MAX_TERMINAL_BUFFER_CHARS);

const toSession = (record: CellTerminalRecord): CellTerminalSession =>
  toTerminalSession(record, { cellId: record.cellId });

const createChannel = (cellId: string): string => `cell:${cellId}`;

const createCellTerminalService = (): CellTerminalService =>
  createPtySessionController<
    { cellId: string; workspacePath: string },
    CellTerminalRecord,
    CellTerminalSession
  >({
    channelForId: createChannel,
    trimOutput: appendBuffer,
    spawnPty: ({ workspacePath }) =>
      spawn(DEFAULT_SHELL, [], {
        name: TERMINAL_NAME,
        cols: DEFAULT_TERMINAL_COLS,
        rows: DEFAULT_TERMINAL_ROWS,
        cwd: workspacePath,
        env: {
          ...process.env,
          TERM: TERMINAL_NAME,
        },
      }) as PtyTerminalProcess,
    createRecord: ({ cellId, workspacePath }, pty) => ({
      ...createTerminalRecordFields(
        `terminal_${crypto.randomUUID()}`,
        workspacePath,
        {
          pid: pty.pid,
          kill: () => pty.kill(),
          resize: (cols, rows) => pty.resize(cols, rows),
          write: (data) => pty.write(data),
        }
      ),
      cellId,
    }),
    toSession,
    runningErrorMessage: "Terminal session is not running",
  }) satisfies CellTerminalService;

export const cellTerminalService = createCellTerminalService();
