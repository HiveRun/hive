import { EventEmitter } from "node:events";

export const DEFAULT_TERMINAL_COLS = 120;
export const DEFAULT_TERMINAL_ROWS = 36;

type TerminalStatus = "running" | "exited";

export type TerminalEvent<Session = TerminalSessionFields> =
  | { type: "data"; chunk: string }
  | { type: "session"; session: Session }
  | {
      type: "exit";
      exitCode: number;
      signal: number | string | null;
    };

export type TerminalSessionFields = {
  sessionId: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  status: TerminalStatus;
  exitCode: number | null;
  startedAt: string;
};

export type TerminalProcessControls = {
  kill?: (signal?: number | string) => void;
  resize?: (cols: number, rows: number) => void;
  write?: (data: string) => void;
};

export type PtyTerminalProcess = Required<TerminalProcessControls> & {
  pid: number;
  onData(listener: (chunk: string) => void): void;
  onExit(
    listener: (event: { exitCode: number; signal: unknown }) => void
  ): void;
};

export type TerminalRecordFields = Omit<TerminalSessionFields, "startedAt"> & {
  startedAt: Date;
  output: string;
} & TerminalProcessControls;

export type TerminalSessionService<Session, Event> = {
  getSession(id: string): Session | null;
  readOutput(id: string): string;
  subscribe(id: string, listener: (event: Event) => void): () => void;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  closeSession(id: string): void;
  stopAll(): void;
};

type TerminalStoreOptions<RecordType, Session> = {
  channelForId: (id: string) => string;
  trimOutput: (current: string, chunk: string) => string;
  toSession: (record: RecordType) => Session;
};

export const toTerminalSession = <Extra extends object = Record<never, never>>(
  record: TerminalRecordFields,
  extra?: Extra
): TerminalSessionFields & Extra => ({
  sessionId: record.sessionId,
  pid: record.pid,
  cwd: record.cwd,
  cols: record.cols,
  rows: record.rows,
  status: record.status,
  exitCode: record.exitCode,
  startedAt: record.startedAt.toISOString(),
  ...(extra ?? ({} as Extra)),
});

type TrimTerminalOutputOptions =
  | number
  | {
      maxChars: number;
      retainChars: number;
      resetSequence: string;
    };

export const trimTerminalOutput = (
  current: string,
  chunk: string,
  options: TrimTerminalOutputOptions
): string => {
  if (!chunk.length) {
    return current;
  }

  const maxChars = typeof options === "number" ? options : options.maxChars;
  const next = `${current}${chunk}`;
  if (next.length <= maxChars) {
    return next;
  }

  if (typeof options !== "number") {
    const retainStart = Math.max(0, next.length - options.retainChars);
    const newlineBoundary = next.indexOf("\n", retainStart);
    const sliceStart = newlineBoundary >= 0 ? newlineBoundary + 1 : retainStart;
    return `${options.resetSequence}${next.slice(sliceStart)}`;
  }

  return next.slice(next.length - maxChars);
};

const normalizeTerminalSignal = (signal: unknown): number | string | null =>
  typeof signal === "number" || typeof signal === "string" ? signal : null;

export const createTerminalRecordFields = (
  sessionId: string,
  cwd: string,
  process: { pid: number } & TerminalProcessControls,
  output = ""
): TerminalRecordFields => ({
  sessionId,
  pid: process.pid,
  cwd,
  cols: DEFAULT_TERMINAL_COLS,
  rows: DEFAULT_TERMINAL_ROWS,
  status: "running",
  exitCode: null,
  startedAt: new Date(),
  output,
  kill: process.kill,
  resize: process.resize,
  write: process.write,
});

export const createTerminalStore = <
  RecordType extends TerminalRecordFields,
  Session,
>({
  channelForId,
  trimOutput,
  toSession,
}: TerminalStoreOptions<RecordType, Session>) => {
  const records = new Map<string, RecordType>();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  const closeRecord = (record?: RecordType) => {
    if (!record?.kill) {
      return;
    }

    try {
      record.kill();
    } catch {
      // ignore kill failures on already-exited processes
    }
  };

  const emit = (id: string, event: TerminalEvent<Session>): void => {
    emitter.emit(channelForId(id), event);
  };

  return {
    records,
    set(id: string, record: RecordType) {
      records.set(id, record);
      emit(id, { type: "session", session: toSession(record) });
    },
    get(id: string): RecordType | undefined {
      return records.get(id);
    },
    close(id: string): void {
      const record = records.get(id);
      closeRecord(record);
      records.delete(id);
    },
    closeRecord,
    stopAll(): void {
      for (const record of records.values()) {
        closeRecord(record);
      }
      records.clear();
    },
    getSession(id: string): TerminalSessionFields | null {
      const record = records.get(id);
      return record ? toTerminalSession(record) : null;
    },
    readOutput(id: string): string {
      return records.get(id)?.output ?? "";
    },
    subscribe(
      id: string,
      listener: (event: TerminalEvent<Session>) => void
    ): () => void {
      const channel = channelForId(id);
      emitter.on(channel, listener);
      return () => {
        emitter.off(channel, listener);
      };
    },
    appendOutput(id: string, chunk: string): RecordType | undefined {
      const record = records.get(id);
      if (!record) {
        return;
      }
      record.output = trimOutput(record.output, chunk);
      emit(id, { type: "data", chunk });
      return record;
    },
    markExit(
      id: string,
      exitCode: number,
      signal: number | string | null
    ): void {
      const record = records.get(id);
      if (!record) {
        return;
      }
      if (record.status === "exited") {
        record.exitCode = exitCode;
        return;
      }
      record.status = "exited";
      record.exitCode = exitCode;
      record.kill = undefined;
      record.resize = undefined;
      record.write = undefined;
      emit(id, { type: "exit", exitCode, signal });
    },
    write(id: string, data: string, errorMessage: string): void {
      const record = records.get(id);
      if (!record || record.status !== "running" || !record.write) {
        throw new Error(errorMessage);
      }
      record.write(data);
    },
    resize(id: string, cols: number, rows: number, errorMessage: string): void {
      const record = records.get(id);
      if (!record || record.status !== "running") {
        throw new Error(errorMessage);
      }
      record.cols = cols;
      record.rows = rows;
      record.resize?.(cols, rows);
    },
  };
};

type PtySessionControllerOptions<
  Args extends { cellId: string },
  RecordType extends TerminalRecordFields,
  Session,
> = {
  channelForId: (id: string) => string;
  trimOutput: (current: string, chunk: string) => string;
  spawnPty: (args: Args) => PtyTerminalProcess;
  createRecord: (args: Args, pty: PtyTerminalProcess) => RecordType;
  toSession: (record: RecordType) => Session;
  canReuse?: (record: RecordType, args: Args) => boolean;
  onSessionStarted?: (record: RecordType) => void;
  runningErrorMessage: string;
};

export const createPtySessionController = <
  Args extends { cellId: string },
  RecordType extends TerminalRecordFields,
  Session,
>({
  channelForId,
  trimOutput,
  spawnPty,
  createRecord,
  toSession,
  canReuse = (record) => record.status === "running",
  onSessionStarted,
  runningErrorMessage,
}: PtySessionControllerOptions<Args, RecordType, Session>) => {
  const sessions = createTerminalStore<RecordType, Session>({
    channelForId,
    trimOutput,
    toSession,
  });
  const closeSession = (cellId: string) => {
    sessions.close(cellId);
  };

  return {
    sessions,
    ensureSession(args: Args): Session {
      const existing = sessions.get(args.cellId);
      if (existing && canReuse(existing, args)) {
        return toSession(existing);
      }

      if (existing) {
        closeSession(args.cellId);
      }

      const pty = spawnPty(args);
      const record = createRecord(args, pty);
      pty.onData((chunk) => {
        if (sessions.get(args.cellId) !== record) {
          return;
        }
        sessions.appendOutput(args.cellId, chunk);
      });
      pty.onExit(({ exitCode, signal }) => {
        if (sessions.get(args.cellId) !== record) {
          return;
        }
        sessions.markExit(
          args.cellId,
          exitCode,
          normalizeTerminalSignal(signal)
        );
      });
      sessions.set(args.cellId, record);
      onSessionStarted?.(record);
      return toSession(record);
    },
    getSession(cellId: string): Session | null {
      const record = sessions.get(cellId);
      return record ? toSession(record) : null;
    },
    readOutput(cellId: string): string {
      return sessions.readOutput(cellId);
    },
    subscribe(
      cellId: string,
      listener: (event: TerminalEvent<Session>) => void
    ): () => void {
      return sessions.subscribe(cellId, listener);
    },
    write(cellId: string, data: string): void {
      sessions.write(cellId, data, runningErrorMessage);
    },
    resize(cellId: string, cols: number, rows: number): void {
      sessions.resize(cellId, cols, rows, runningErrorMessage);
    },
    closeSession,
    stopAll(): void {
      sessions.stopAll();
    },
  };
};
