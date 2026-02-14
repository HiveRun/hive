import { EventEmitter } from "node:events";

const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 36;
const MAX_TERMINAL_BUFFER_CHARS = 250_000;

type TerminalStatus = "running" | "exited";

export type ServiceTerminalSession = {
  sessionId: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  status: TerminalStatus;
  exitCode: number | null;
  startedAt: string;
};

export type ServiceTerminalEvent =
  | { type: "data"; chunk: string }
  | {
      type: "exit";
      exitCode: number;
      signal: number | string | null;
    };

type TerminalRecord = {
  sessionId: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  status: TerminalStatus;
  exitCode: number | null;
  startedAt: Date;
  output: string;
  kill?: (signal?: number | string) => void;
  resize?: (cols: number, rows: number) => void;
  write?: (data: string) => void;
};

type SpawnAttachment = {
  pid: number;
  kill?: (signal?: number | string) => void;
  resize?: (cols: number, rows: number) => void;
  write?: (data: string) => void;
};

export type ServiceTerminalRuntime = {
  startServiceSession(args: {
    serviceId: string;
    cwd: string;
    process: SpawnAttachment;
  }): ServiceTerminalSession;
  appendServiceOutput(serviceId: string, chunk: string): void;
  markServiceExit(args: {
    serviceId: string;
    exitCode: number;
    signal: number | string | null;
  }): void;
  getServiceSession(serviceId: string): ServiceTerminalSession | null;
  readServiceOutput(serviceId: string): string;
  subscribeToService(
    serviceId: string,
    listener: (event: ServiceTerminalEvent) => void
  ): () => void;
  writeService(serviceId: string, data: string): void;
  resizeService(serviceId: string, cols: number, rows: number): void;
  clearServiceSession(serviceId: string): void;

  startSetupSession(args: {
    cellId: string;
    cwd: string;
  }): ServiceTerminalSession;
  attachSetupProcess(args: { cellId: string; process: SpawnAttachment }): void;
  appendSetupOutput(cellId: string, chunk: string): void;
  appendSetupLine(cellId: string, message: string): void;
  markSetupExit(args: {
    cellId: string;
    exitCode: number;
    signal: number | string | null;
  }): void;
  getSetupSession(cellId: string): ServiceTerminalSession | null;
  readSetupOutput(cellId: string): string;
  subscribeToSetup(
    cellId: string,
    listener: (event: ServiceTerminalEvent) => void
  ): () => void;
  writeSetup(cellId: string, data: string): void;
  resizeSetup(cellId: string, cols: number, rows: number): void;
  clearSetupSession(cellId: string): void;

  stopAll(): void;
};

const toSession = (record: TerminalRecord): ServiceTerminalSession => ({
  sessionId: record.sessionId,
  pid: record.pid,
  cwd: record.cwd,
  cols: record.cols,
  rows: record.rows,
  status: record.status,
  exitCode: record.exitCode,
  startedAt: record.startedAt.toISOString(),
});

const appendOutput = (current: string, chunk: string): string => {
  if (!chunk.length) {
    return current;
  }

  const next = `${current}${chunk}`;
  if (next.length <= MAX_TERMINAL_BUFFER_CHARS) {
    return next;
  }

  return next.slice(next.length - MAX_TERMINAL_BUFFER_CHARS);
};

const createServiceChannel = (serviceId: string) => `service:${serviceId}`;
const createSetupChannel = (cellId: string) => `setup:${cellId}`;

const buildRecord = (
  cwd: string,
  process: SpawnAttachment,
  existingOutput = ""
): TerminalRecord => ({
  sessionId: `pty_${crypto.randomUUID()}`,
  pid: process.pid,
  cwd,
  cols: DEFAULT_TERMINAL_COLS,
  rows: DEFAULT_TERMINAL_ROWS,
  status: "running",
  exitCode: null,
  startedAt: new Date(),
  output: existingOutput,
  kill: process.kill,
  resize: process.resize,
  write: process.write,
});

export const createServiceTerminalRuntime = (): ServiceTerminalRuntime => {
  const serviceRecords = new Map<string, TerminalRecord>();
  const setupRecords = new Map<string, TerminalRecord>();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  const closeRecord = (record?: TerminalRecord) => {
    if (!record?.kill) {
      return;
    }

    try {
      record.kill();
    } catch {
      // ignore kill failures on already-exited processes
    }
  };

  const emitEvent = (channel: string, event: ServiceTerminalEvent): void => {
    emitter.emit(channel, event);
  };

  const resizeRecord = (record: TerminalRecord, cols: number, rows: number) => {
    record.cols = cols;
    record.rows = rows;
    record.resize?.(cols, rows);
  };

  const markExit = (
    record: TerminalRecord,
    channel: string,
    exitCode: number,
    signal: number | string | null
  ) => {
    if (record.status === "exited") {
      record.exitCode = exitCode;
      return;
    }
    record.status = "exited";
    record.exitCode = exitCode;
    record.kill = undefined;
    record.resize = undefined;
    record.write = undefined;
    emitEvent(channel, { type: "exit", exitCode, signal });
  };

  return {
    startServiceSession({ serviceId, cwd, process }) {
      closeRecord(serviceRecords.get(serviceId));
      const record = buildRecord(cwd, process);
      serviceRecords.set(serviceId, record);
      return toSession(record);
    },
    appendServiceOutput(serviceId, chunk) {
      const record = serviceRecords.get(serviceId);
      if (!record) {
        return;
      }
      record.output = appendOutput(record.output, chunk);
      emitEvent(createServiceChannel(serviceId), { type: "data", chunk });
    },
    markServiceExit({ serviceId, exitCode, signal }) {
      const record = serviceRecords.get(serviceId);
      if (!record) {
        return;
      }
      markExit(record, createServiceChannel(serviceId), exitCode, signal);
    },
    getServiceSession(serviceId) {
      const record = serviceRecords.get(serviceId);
      return record ? toSession(record) : null;
    },
    readServiceOutput(serviceId) {
      return serviceRecords.get(serviceId)?.output ?? "";
    },
    subscribeToService(serviceId, listener) {
      const channel = createServiceChannel(serviceId);
      emitter.on(channel, listener);
      return () => {
        emitter.off(channel, listener);
      };
    },
    writeService(serviceId, data) {
      const record = serviceRecords.get(serviceId);
      if (!record || record.status !== "running" || !record.write) {
        throw new Error("Service terminal is not accepting input");
      }
      record.write(data);
    },
    resizeService(serviceId, cols, rows) {
      const record = serviceRecords.get(serviceId);
      if (!record || record.status !== "running") {
        throw new Error("Service terminal is not running");
      }
      resizeRecord(record, cols, rows);
    },
    clearServiceSession(serviceId) {
      const record = serviceRecords.get(serviceId);
      closeRecord(record);
      serviceRecords.delete(serviceId);
    },

    startSetupSession({ cellId, cwd }) {
      closeRecord(setupRecords.get(cellId));
      const record = buildRecord(cwd, { pid: 0 });
      setupRecords.set(cellId, record);
      return toSession(record);
    },
    attachSetupProcess({ cellId, process }) {
      const current = setupRecords.get(cellId);
      if (!current) {
        setupRecords.set(cellId, buildRecord("", process));
        return;
      }
      current.pid = process.pid;
      current.kill = process.kill;
      current.resize = process.resize;
      current.write = process.write;
      current.status = "running";
      current.exitCode = null;
    },
    appendSetupOutput(cellId, chunk) {
      const record = setupRecords.get(cellId);
      if (!record) {
        return;
      }
      record.output = appendOutput(record.output, chunk);
      emitEvent(createSetupChannel(cellId), { type: "data", chunk });
    },
    appendSetupLine(cellId, message) {
      const chunk = `${message}\n`;
      const record = setupRecords.get(cellId);
      if (!record) {
        return;
      }
      record.output = appendOutput(record.output, chunk);
      emitEvent(createSetupChannel(cellId), { type: "data", chunk });
    },
    markSetupExit({ cellId, exitCode, signal }) {
      const record = setupRecords.get(cellId);
      if (!record) {
        return;
      }
      markExit(record, createSetupChannel(cellId), exitCode, signal);
    },
    getSetupSession(cellId) {
      const record = setupRecords.get(cellId);
      return record ? toSession(record) : null;
    },
    readSetupOutput(cellId) {
      return setupRecords.get(cellId)?.output ?? "";
    },
    subscribeToSetup(cellId, listener) {
      const channel = createSetupChannel(cellId);
      emitter.on(channel, listener);
      return () => {
        emitter.off(channel, listener);
      };
    },
    writeSetup(cellId, data) {
      const record = setupRecords.get(cellId);
      if (!record || record.status !== "running" || !record.write) {
        throw new Error("Setup terminal is not accepting input");
      }
      record.write(data);
    },
    resizeSetup(cellId, cols, rows) {
      const record = setupRecords.get(cellId);
      if (!record || record.status !== "running") {
        throw new Error("Setup terminal is not running");
      }
      resizeRecord(record, cols, rows);
    },
    clearSetupSession(cellId) {
      const record = setupRecords.get(cellId);
      closeRecord(record);
      setupRecords.delete(cellId);
    },

    stopAll() {
      for (const record of serviceRecords.values()) {
        closeRecord(record);
      }
      for (const record of setupRecords.values()) {
        closeRecord(record);
      }
      serviceRecords.clear();
      setupRecords.clear();
    },
  };
};

export const serviceTerminalRuntime = createServiceTerminalRuntime();

export const ServiceTerminalRuntimeTag = serviceTerminalRuntime;
