import {
  createTerminalRecordFields,
  createTerminalStore,
  type TerminalEvent,
  type TerminalProcessControls,
  type TerminalRecordFields,
  type TerminalSessionFields,
  trimTerminalOutput,
} from "./terminal-store";

const MAX_TERMINAL_BUFFER_CHARS = 250_000;

export type ServiceTerminalSession = TerminalSessionFields;

export type ServiceTerminalEvent = TerminalEvent;

type TerminalRecord = TerminalRecordFields;

type SpawnAttachment = TerminalProcessControls & {
  pid: number;
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

const appendOutput = (current: string, chunk: string): string =>
  trimTerminalOutput(current, chunk, MAX_TERMINAL_BUFFER_CHARS);

const createServiceChannel = (serviceId: string) => `service:${serviceId}`;
const createSetupChannel = (cellId: string) => `setup:${cellId}`;

const buildRecord = (
  cwd: string,
  process: SpawnAttachment,
  existingOutput = ""
): TerminalRecord =>
  createTerminalRecordFields(
    `pty_${crypto.randomUUID()}`,
    cwd,
    process,
    existingOutput
  );

export const createServiceTerminalRuntime = (): ServiceTerminalRuntime => {
  const serviceRecords = createTerminalStore<TerminalRecord>({
    channelForId: createServiceChannel,
    trimOutput: appendOutput,
  });
  const setupRecords = createTerminalStore<TerminalRecord>({
    channelForId: createSetupChannel,
    trimOutput: appendOutput,
  });

  return {
    startServiceSession({ serviceId, cwd, process }) {
      serviceRecords.close(serviceId);
      const record = buildRecord(cwd, process);
      serviceRecords.set(serviceId, record);
      return serviceRecords.getSession(serviceId) as ServiceTerminalSession;
    },
    appendServiceOutput(serviceId, chunk) {
      serviceRecords.appendOutput(serviceId, chunk);
    },
    markServiceExit({ serviceId, exitCode, signal }) {
      serviceRecords.markExit(serviceId, exitCode, signal);
    },
    getServiceSession(serviceId) {
      return serviceRecords.getSession(serviceId);
    },
    readServiceOutput(serviceId) {
      return serviceRecords.readOutput(serviceId);
    },
    subscribeToService(serviceId, listener) {
      return serviceRecords.subscribe(serviceId, listener);
    },
    writeService(serviceId, data) {
      serviceRecords.write(
        serviceId,
        data,
        "Service terminal is not accepting input"
      );
    },
    resizeService(serviceId, cols, rows) {
      serviceRecords.resize(
        serviceId,
        cols,
        rows,
        "Service terminal is not running"
      );
    },
    clearServiceSession(serviceId) {
      serviceRecords.close(serviceId);
    },

    startSetupSession({ cellId, cwd }) {
      setupRecords.close(cellId);
      const record = buildRecord(cwd, { pid: 0 });
      setupRecords.set(cellId, record);
      return setupRecords.getSession(cellId) as ServiceTerminalSession;
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
      setupRecords.appendOutput(cellId, chunk);
    },
    appendSetupLine(cellId, message) {
      setupRecords.appendOutput(cellId, `${message}\n`);
    },
    markSetupExit({ cellId, exitCode, signal }) {
      setupRecords.markExit(cellId, exitCode, signal);
    },
    getSetupSession(cellId) {
      return setupRecords.getSession(cellId);
    },
    readSetupOutput(cellId) {
      return setupRecords.readOutput(cellId);
    },
    subscribeToSetup(cellId, listener) {
      return setupRecords.subscribe(cellId, listener);
    },
    writeSetup(cellId, data) {
      setupRecords.write(cellId, data, "Setup terminal is not accepting input");
    },
    resizeSetup(cellId, cols, rows) {
      setupRecords.resize(cellId, cols, rows, "Setup terminal is not running");
    },
    clearSetupSession(cellId) {
      setupRecords.close(cellId);
    },

    stopAll() {
      serviceRecords.stopAll();
      setupRecords.stopAll();
    },
  };
};

export const serviceTerminalRuntime = createServiceTerminalRuntime();
