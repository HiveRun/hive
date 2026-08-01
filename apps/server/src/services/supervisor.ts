import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { resolve as resolvePath } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { type IExitEvent, spawn as spawnPty } from "bun-pty";
import { eq } from "drizzle-orm";

import { resolveWorkspaceRoot } from "../config/context";
import { loadConfig } from "../config/loader";
import type { HiveConfig, ProcessService, Template } from "../config/schema";
import {
  collectServiceGraphIssues,
  DEFAULT_SERVICE_PORT_NAME,
  getServiceDependencyClosure,
  resolveNamedPortDefinitions,
  sanitizeServiceEnvironmentName,
  topologicallySortServiceNames,
} from "../config/service-graph";
import { db as defaultDb } from "../db";
import { type Cell, cells } from "../schema/cells";
import type {
  CellService,
  CellServicePort,
  ServiceStatus,
} from "../schema/services";
import { ensureCellEnvironment } from "./cell-environment";
import { emitServiceUpdate } from "./events";
import {
  createPortManager,
  isPortFree,
  type ServicePortAllocation,
} from "./port-manager";
import { waitForServiceReadiness } from "./readiness";
import { createServiceRepository } from "./repository";
import {
  createServiceTerminalRuntime,
  type ServiceTerminalEvent,
  type ServiceTerminalRuntime,
  type ServiceTerminalSession,
  serviceTerminalRuntime,
} from "./service-terminal";

const AUTO_RESTART_STATUSES: ReadonlySet<ServiceStatus> = new Set([
  "pending",
  "starting",
  "running",
  "needs_resume",
]);

const cellServiceLocks = new Map<string, Promise<void>>();
const serviceStartLocks = new Map<string, Promise<void>>();

const STOP_TIMEOUT_MS = 2000;
const FORCE_KILL_DELAY_MS = 250;
const PROCESS_EXIT_POLL_INTERVAL_MS = 25;
const PERSISTED_PROCESS_POLL_INTERVAL_MS = 100;
const DEFAULT_TEMPLATE_SETUP_COMMAND_TIMEOUT_MS = 300_000;
const DEFAULT_TEMPLATE_TEARDOWN_COMMAND_TIMEOUT_MS = 300_000;
const DEFAULT_SERVICE_SETUP_COMMAND_TIMEOUT_MS = 300_000;
const DEFAULT_SERVICE_STOP_COMMAND_TIMEOUT_MS = 30_000;
const TEARDOWN_FINGERPRINT_LENGTH = 16;
const DEFAULT_SHELL = process.env.SHELL || "/bin/bash";
const TERMINAL_NAME = "xterm-256color";
const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 36;
const SERVICE_INSTANCE_ENV_KEY = "HIVE_SERVICE_INSTANCE_ID";
const SIGNAL_CODES = osConstants?.signals ?? {};

function resolvePositiveTimeout(
  environmentVariable: string,
  defaultTimeoutMs: number
): number {
  const raw = process.env[environmentVariable];
  if (!raw) {
    return defaultTimeoutMs;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultTimeoutMs;
}

function resolveTemplateSetupCommandTimeoutMs(): number {
  return resolvePositiveTimeout(
    "HIVE_TEMPLATE_SETUP_COMMAND_TIMEOUT_MS",
    DEFAULT_TEMPLATE_SETUP_COMMAND_TIMEOUT_MS
  );
}

function resolveTemplateTeardownCommandTimeoutMs(): number {
  return resolvePositiveTimeout(
    "HIVE_TEMPLATE_TEARDOWN_COMMAND_TIMEOUT_MS",
    DEFAULT_TEMPLATE_TEARDOWN_COMMAND_TIMEOUT_MS
  );
}

function resolveServiceStopCommandTimeoutMs(): number {
  return resolvePositiveTimeout(
    "HIVE_SERVICE_STOP_COMMAND_TIMEOUT_MS",
    DEFAULT_SERVICE_STOP_COMMAND_TIMEOUT_MS
  );
}

function resolveServiceSetupCommandTimeoutMs(): number {
  return resolvePositiveTimeout(
    "HIVE_SERVICE_SETUP_COMMAND_TIMEOUT_MS",
    DEFAULT_SERVICE_SETUP_COMMAND_TIMEOUT_MS
  );
}

function runWithLock(
  locks: Map<string, Promise<void>>,
  key: string,
  action: () => Promise<void>
) {
  const current = locks.get(key) ?? Promise.resolve();
  const next = current.catch(() => null).then(action);
  locks.set(key, next);
  const cleanup = () => {
    if (locks.get(key) === next) {
      locks.delete(key);
    }
  };
  next.then(cleanup, cleanup);
  return next;
}

function runWithCellLock(cellId: string, action: () => Promise<void>) {
  return runWithLock(cellServiceLocks, cellId, action);
}

function runWithServiceLock(serviceId: string, action: () => Promise<void>) {
  return runWithLock(serviceStartLocks, serviceId, action);
}

export class CommandExecutionError extends Error {
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number;

  constructor(params: { command: string; cwd: string; exitCode: number }) {
    super(
      `Command "${params.command}" failed with exit code ${params.exitCode} (cwd: ${params.cwd})`
    );
    this.name = "CommandExecutionError";
    this.command = params.command;
    this.cwd = params.cwd;
    this.exitCode = params.exitCode;
  }
}

export class TemplateSetupError extends Error {
  readonly command: string;
  readonly templateId: string;
  readonly workspacePath: string;
  readonly exitCode?: number;

  constructor(params: {
    command: string;
    templateId: string;
    workspacePath: string;
    cause?: unknown;
    exitCode?: number;
  }) {
    super(
      `Template setup command "${params.command}" failed for template "${params.templateId}"`,
      { cause: params.cause }
    );
    this.name = "TemplateSetupError";
    this.command = params.command;
    this.templateId = params.templateId;
    this.workspacePath = params.workspacePath;

    let derivedExitCode: number | undefined;
    if (typeof params.exitCode === "number") {
      derivedExitCode = params.exitCode;
    } else if (params.cause instanceof CommandExecutionError) {
      derivedExitCode = params.cause.exitCode;
    } else if (
      params.cause &&
      typeof params.cause === "object" &&
      typeof (params.cause as { exitCode?: unknown }).exitCode === "number"
    ) {
      derivedExitCode = (params.cause as { exitCode: number }).exitCode;
    }

    if (typeof derivedExitCode === "number") {
      this.exitCode = derivedExitCode;
    }
  }
}

export function isProcessAlive(pid?: number | null): boolean {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isPermissionError(error);
  }
}

function createPersistedProcessHandle(
  pid: number,
  isStillOwned: () => Promise<boolean>
): ProcessHandle {
  return {
    pid,
    exited: (async () => {
      while (isProcessAlive(pid)) {
        if (!(await isStillOwned())) {
          return -1;
        }
        await delay(PERSISTED_PROCESS_POLL_INTERVAL_MS);
      }
      while (isProcessGroupAlive(pid)) {
        await delay(PERSISTED_PROCESS_POLL_INTERVAL_MS);
      }
      return -1;
    })(),
    kill: (signal = "SIGTERM") => {
      try {
        process.kill(-pid, signal as NodeJS.Signals);
      } catch {
        process.kill(pid, signal as NodeJS.Signals);
      }
    },
  };
}

function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return isPermissionError(error);
  }
}

function isPermissionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EPERM"
  );
}

async function waitForHandleAndGroupExit(
  handle: ProcessHandle,
  timeoutMs: number
): Promise<boolean> {
  let leaderExited = false;
  handle.exited.then(
    () => {
      leaderExited = true;
    },
    () => {
      leaderExited = true;
    }
  );
  return await waitUntilProcessExit(
    () => leaderExited && !isProcessGroupAlive(handle.pid),
    timeoutMs
  );
}

async function waitUntilProcessExit(
  hasExited: () => boolean,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!hasExited()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return false;
    }
    await delay(Math.min(PROCESS_EXIT_POLL_INTERVAL_MS, remaining));
  }
  return true;
}

async function terminateProcessHandle(handle: ProcessHandle): Promise<void> {
  try {
    handle.kill("SIGTERM");
  } catch {
    // Continue to process-group verification and forced termination.
  }

  const leaderExited = await Promise.race([
    handle.exited.then(
      () => true,
      () => true
    ),
    delay(STOP_TIMEOUT_MS).then(() => false),
  ]);
  if (leaderExited && !isProcessGroupAlive(handle.pid)) {
    return;
  }

  try {
    handle.kill("SIGKILL");
  } catch {
    // The process may have exited between verification and signaling.
  }
  if (!(await waitForHandleAndGroupExit(handle, STOP_TIMEOUT_MS))) {
    throw new Error(`Process group ${handle.pid} did not exit after SIGKILL`);
  }
}

function resolveSignalValue(signal?: number | string): number | undefined {
  if (typeof signal === "string") {
    return SIGNAL_CODES[signal as keyof typeof SIGNAL_CODES];
  }
  return signal;
}

export type SpawnProcessOptions = {
  command: string;
  cwd: string;
  env: Record<string, string>;
  onData?: (chunk: string) => void;
  onExit?: (event: {
    exitCode: number;
    signal: number | string | null;
  }) => void;
  cols?: number;
  rows?: number;
};

export type ProcessHandle = {
  pid: number;
  kill: (signal?: number | string) => void;
  exited: Promise<number>;
  write?: (data: string) => void;
  resize?: (cols: number, rows: number) => void;
};

export type SpawnProcess = (options: SpawnProcessOptions) => ProcessHandle;

export type RunCommand = (
  command: string,
  options: {
    cwd: string;
    env: Record<string, string>;
    onData?: (chunk: string) => void;
    onExit?: (event: {
      exitCode: number;
      signal: number | string | null;
    }) => void;
    timeoutMs?: number;
  }
) => Promise<void>;

export type EnsureCellServicesTimingEvent = {
  step: string;
  status: "ok" | "error";
  durationMs: number;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type TemplateTeardownReason = "delete" | "provisioning_rollback";

type ServiceSupervisor = {
  bootstrap(): Promise<void>;
  ensureCellServices(args: {
    cell: Cell;
    template?: Template;
    onTimingEvent?: (event: EnsureCellServicesTimingEvent) => void;
  }): Promise<void>;
  startCellService(serviceId: string): Promise<void>;
  startCellServices(cellId: string): Promise<void>;
  stopCellService(
    serviceId: string,
    options?: { releasePorts?: boolean }
  ): Promise<void>;
  stopCellServices(
    cellId: string,
    options?: { releasePorts?: boolean }
  ): Promise<void>;
  runCellTeardown(args: {
    cell: Cell;
    template?: Template;
    reason: TemplateTeardownReason;
  }): Promise<void>;
  stopAll(): Promise<void>;
};

type SupervisorDependencies = {
  db: typeof defaultDb;
  spawnProcess: SpawnProcess;
  runCommand: RunCommand;
  now: () => Date;
  logger: ServiceLogger;
  loadHiveConfig: (workspaceRoot?: string) => Promise<HiveConfig>;
  terminalRuntime: ServiceTerminalRuntime;
  readProcessEnvironment: (
    pid: number
  ) => Promise<Record<string, string> | null>;
};

type ServiceLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
};

type ServiceRow = {
  service: CellService;
  cell: Cell;
};

type ActiveServiceHandle = {
  handle: ProcessHandle;
  persisted?: boolean;
};

type PersistedProcessIdentity =
  | "owned"
  | "different"
  | "exited"
  | "unverifiable";

type ServiceProcessOptions = {
  row: ServiceRow;
  definition: ProcessService;
  env: Record<string, string>;
  cwd: string;
  command: string;
  allocation: ServicePortAllocation;
  portMap: CellPortMap;
};

type CellPortMap = Map<string, ServicePortAllocation>;

function createDefaultLogger(): ServiceLogger {
  return {
    info(message, context) {
      process.stderr.write(
        `[services] ${message}${context ? ` ${JSON.stringify(context)}` : ""}\n`
      );
    },
    warn(message, context) {
      process.stderr.write(
        `[services] WARN ${message}${context ? ` ${JSON.stringify(context)}` : ""}\n`
      );
    },
    error(message, context) {
      process.stderr.write(
        `[services] ERROR ${message}${context ? ` ${JSON.stringify(context)}` : ""}\n`
      );
    },
  };
}

async function readDefaultProcessEnvironment(
  pid: number
): Promise<Record<string, string> | null> {
  if (process.platform !== "linux") {
    return null;
  }

  try {
    const content = await readFile(`/proc/${pid}/environ`, "utf8");
    return Object.fromEntries(
      content
        .split("\0")
        .filter(Boolean)
        .map((entry) => {
          const separator = entry.indexOf("=");
          return separator < 0
            ? [entry, ""]
            : [entry.slice(0, separator), entry.slice(separator + 1)];
        })
    );
  } catch {
    return null;
  }
}

const defaultSpawnProcess: SpawnProcess = ({
  command,
  cwd,
  env,
  onData,
  onExit,
  cols,
  rows,
}) => {
  const pty = spawnPty(DEFAULT_SHELL, ["-lc", command], {
    name: TERMINAL_NAME,
    cols: cols ?? DEFAULT_TERMINAL_COLS,
    rows: rows ?? DEFAULT_TERMINAL_ROWS,
    cwd,
    env: {
      ...process.env,
      ...env,
      TERM: TERMINAL_NAME,
    },
  });

  const pid = pty.pid;
  if (!pid) {
    throw new Error("Failed to spawn service process");
  }

  const exited = new Promise<number>((resolveExit) => {
    pty.onExit((event: IExitEvent) => {
      const exitCode = event.exitCode ?? -1;
      onExit?.({
        exitCode,
        signal:
          typeof event.signal === "number" || typeof event.signal === "string"
            ? event.signal
            : null,
      });
      resolveExit(exitCode);
    });
  });

  pty.onData((chunk: string) => {
    onData?.(chunk);
  });

  const sendSignal = (target: number, signal?: number | string): boolean => {
    const resolved = resolveSignalValue(signal);
    const signalValue: NodeJS.Signals | number | undefined =
      resolved ??
      (typeof signal === "string" ? (signal as NodeJS.Signals) : undefined);
    try {
      if (signalValue === undefined) {
        process.kill(target);
      } else {
        process.kill(target, signalValue);
      }
      return true;
    } catch {
      return false;
    }
  };

  const kill: ProcessHandle["kill"] = (signal) => {
    if (sendSignal(-pid, signal) || sendSignal(pid, signal)) {
      return;
    }

    try {
      pty.kill();
    } catch {
      // ignore kill failures on exited processes
    }
  };

  return {
    pid,
    kill,
    exited,
    resize(colsValue, rowsValue) {
      pty.resize(colsValue, rowsValue);
    },
    write(data) {
      pty.write(data);
    },
  };
};

const createDefaultRunCommand =
  (spawnProcess: SpawnProcess): RunCommand =>
  async (command, options) => {
    const proc = spawnProcess({
      command,
      cwd: options.cwd,
      env: options.env,
      onData: options.onData,
      onExit: options.onExit,
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const exited = proc.exited.then((code) => ({
      type: "exit" as const,
      exitCode: code,
    }));
    const result = options.timeoutMs
      ? await Promise.race([
          exited,
          new Promise<{ type: "timeout" }>((resolveTimeout) => {
            timeoutHandle = setTimeout(
              () => resolveTimeout({ type: "timeout" }),
              options.timeoutMs
            );
          }),
        ])
      : await exited;
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (result.type === "timeout") {
      await terminateProcessHandle(proc);
      throw new Error(
        `Command "${command}" timed out after ${options.timeoutMs}ms (cwd: ${options.cwd})`
      );
    }

    const exitCode = result.exitCode;
    if (exitCode !== 0) {
      throw new CommandExecutionError({
        command,
        cwd: options.cwd,
        exitCode,
      });
    }
  };

export function createServiceSupervisor(
  overrides: Partial<SupervisorDependencies> = {}
): ServiceSupervisor {
  const db = overrides.db ?? defaultDb;
  const logger = overrides.logger ?? createDefaultLogger();
  const spawnProcess = overrides.spawnProcess ?? defaultSpawnProcess;
  const runCommand =
    overrides.runCommand ?? createDefaultRunCommand(spawnProcess);
  const now = overrides.now ?? (() => new Date());
  const loadHiveConfig =
    overrides.loadHiveConfig ??
    ((workspaceRoot?: string) =>
      loadConfig(workspaceRoot ?? resolveWorkspaceRoot()));
  const terminalRuntime =
    overrides.terminalRuntime ?? createServiceTerminalRuntime();
  const readProcessEnvironment =
    overrides.readProcessEnvironment ?? readDefaultProcessEnvironment;

  const activeServices = new Map<string, ActiveServiceHandle>();
  const activeServiceStarts = new Map<string, ProcessHandle>();
  const activeServiceSetups = new Map<string, ActiveServiceHandle>();
  const retainedServiceSetups = new Map<string, ProcessHandle>();
  const activePersistedRecoveries = new Map<string, ActiveServiceHandle>();
  const activeTemplateSetups = new Map<string, ProcessHandle>();
  const cancelledTemplateSetups = new WeakSet<ProcessHandle>();
  const cellsStopping = new Set<string>();
  const servicesStopping = new Set<string>();
  const repository = createServiceRepository(db, now);
  const portManager = createPortManager({ db, now });
  const templateCache = new Map<string, Map<string, Template | undefined>>();
  let shuttingDown = false;

  function requireStartableSupervisor(): void {
    if (shuttingDown) {
      throw new Error("Service supervisor is shutting down");
    }
  }

  async function requireStartableCell(cellId: string): Promise<Cell> {
    requireStartableSupervisor();
    const [cell] = await db
      .select()
      .from(cells)
      .where(eq(cells.id, cellId))
      .limit(1);
    requireStartableSupervisor();
    if (!cell) {
      throw new Error(`Cell "${cellId}" no longer exists`);
    }
    if (cell.status === "deleting") {
      throw new Error(`Cell "${cellId}" is being deleted`);
    }
    return cell;
  }

  async function bootstrap(): Promise<void> {
    requireStartableSupervisor();
    const grouped = groupServicesByCell(await repository.fetchAllServices());

    for (const { cell } of grouped.values()) {
      await runWithCellLock(cell.id, async () => {
        const cellRows = await repository.fetchServicesForCell(cell.id);
        const currentCell = cellRows[0]?.cell;
        if (
          !currentCell ||
          currentCell.status === "deleting" ||
          currentCell.status === "error"
        ) {
          return;
        }
        const templateEnv = await loadTemplateEnvironment(currentCell);
        const portMap = await buildPortMap(cellRows);

        await restartServicesForCell({
          rows: cellRows,
          portMap,
          templateEnv,
        });
      });
    }
  }

  async function shouldSkipRestart(
    row: ServiceRow,
    requiredAsDependency: boolean,
    portMap: CellPortMap
  ): Promise<boolean> {
    if (
      !(requiredAsDependency || AUTO_RESTART_STATUSES.has(row.service.status))
    ) {
      return true;
    }

    if (await retainPersistedProcessDuringRestart(row, portMap)) {
      return true;
    }

    if (await hasOccupiedServicePort(row)) {
      logger.warn("Skipping service restart because port is already in use", {
        serviceId: row.service.id,
        cellId: row.cell.id,
        port: row.service.port,
      });
      return true;
    }

    return false;
  }

  async function retainPersistedProcessDuringRestart(
    row: ServiceRow,
    portMap: CellPortMap
  ): Promise<boolean> {
    if (!row.service.pid) {
      return false;
    }

    const identity = await resolvePersistedProcessIdentity(row);
    if (identity === "owned") {
      await adoptPersistedProcess(row, portMap);
      return true;
    }
    if (identity === "unverifiable") {
      logger.warn("Skipping restart of unverifiable persisted service PID", {
        serviceId: row.service.id,
        cellId: row.cell.id,
        pid: row.service.pid,
      });
      return true;
    }

    await normalizeServiceForRestart(row);
    return false;
  }

  async function adoptPersistedProcess(
    row: ServiceRow,
    portMap: CellPortMap
  ): Promise<void> {
    const pid = row.service.pid;
    if (!pid || activeServices.has(row.service.id)) {
      return;
    }
    const instanceId = row.service.env[SERVICE_INSTANCE_ENV_KEY];
    const handle = createPersistedProcessHandle(pid, async () => {
      const environment = await readProcessEnvironment(pid);
      return (
        environment === null ||
        Boolean(
          instanceId && environment[SERVICE_INSTANCE_ENV_KEY] === instanceId
        )
      );
    });
    activeServices.set(row.service.id, { handle, persisted: true });
    observePersistedProcessExit(row, handle);

    if (row.service.status === "running") {
      return;
    }
    activePersistedRecoveries.set(row.service.id, { handle, persisted: true });

    try {
      rejectCancelledPersistedRecovery(row, handle);
      await waitForPersistedProcessReadiness(row, handle, portMap);
      rejectCancelledPersistedRecovery(row, handle);
      await repository.updateService(row.service.id, {
        status: "running",
        pid,
        lastKnownError: null,
      });
      rejectCancelledPersistedRecovery(row, handle);
      activePersistedRecoveries.delete(row.service.id);
      row.service.status = "running";
      notifyServiceUpdate(row);
    } catch (error) {
      await handlePersistedRecoveryFailure(row, handle, error);
      throw error;
    }
  }

  async function handlePersistedRecoveryFailure(
    row: ServiceRow,
    handle: ProcessHandle,
    error: unknown
  ): Promise<void> {
    if (isServiceStopRequested(row)) {
      await cancelPersistedRecoveries([row.service.id]);
      return;
    }
    if (activePersistedRecoveries.get(row.service.id)?.handle !== handle) {
      return;
    }
    await terminateFailedPersistedRecovery(row, handle, error);
  }

  async function terminateFailedPersistedRecovery(
    row: ServiceRow,
    handle: ProcessHandle,
    error: unknown
  ): Promise<void> {
    let shouldTerminate: boolean;
    try {
      shouldTerminate = await shouldTerminatePersistedHandle(row, handle);
    } catch (identityError) {
      await persistFailedRecoveryTermination({
        row,
        handle,
        error,
        terminationError: identityError,
      });
      throw identityError;
    }
    if (!shouldTerminate) {
      forgetPersistedTracking(row.service.id, handle);
      await markServiceError(row.service.id, row.cell.id, formatError(error));
      return;
    }
    activePersistedRecoveries.delete(row.service.id);
    const active = activeServices.get(row.service.id);
    if (active?.handle === handle) {
      activeServices.delete(row.service.id);
    }
    try {
      await terminateHandle(handle);
    } catch (terminationError) {
      await persistFailedRecoveryTermination({
        row,
        handle,
        error,
        terminationError,
        active,
      });
      throw terminationError;
    }
    await markServiceError(row.service.id, row.cell.id, formatError(error));
  }

  function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function isServiceStopRequested(row: ServiceRow): boolean {
    return (
      shuttingDown ||
      cellsStopping.has(row.cell.id) ||
      servicesStopping.has(row.service.id)
    );
  }

  async function persistFailedRecoveryTermination(args: {
    row: ServiceRow;
    handle: ProcessHandle;
    error: unknown;
    terminationError: unknown;
    active?: ActiveServiceHandle;
  }): Promise<void> {
    const { row, handle, error, terminationError } = args;
    const active = args.active ?? activeServices.get(row.service.id);
    activePersistedRecoveries.set(row.service.id, {
      handle,
      persisted: true,
    });
    if (active?.handle === handle) {
      activeServices.set(row.service.id, active);
    }
    await repository.updateService(row.service.id, {
      status: "error",
      pid: handle.pid,
      lastKnownError: `${formatError(error)}; failed to terminate persisted process: ${formatError(terminationError)}`,
    });
    notifyServiceUpdate(row);
  }

  function rejectCancelledPersistedRecovery(
    row: ServiceRow,
    handle: ProcessHandle
  ): void {
    if (
      isServiceStopRequested(row) ||
      activePersistedRecoveries.get(row.service.id)?.handle !== handle ||
      activeServices.get(row.service.id)?.handle !== handle
    ) {
      throw new Error(`Service "${row.service.name}" recovery cancelled`);
    }
  }

  async function waitForPersistedProcessReadiness(
    row: ServiceRow,
    handle: ProcessHandle,
    portMap: CellPortMap
  ): Promise<void> {
    const definition = row.service.definition as ProcessService;
    if (!definition.readiness) {
      return;
    }
    const allocation = portMap.get(row.service.name);
    if (!allocation) {
      throw new Error(
        `Service "${row.service.name}" has no persisted port allocation`
      );
    }
    await waitForServiceReadiness({
      serviceName: row.service.name,
      readiness: definition.readiness,
      ports: allocation.ports,
      processExited: handle.exited,
      timeoutMs: definition.readyTimeoutMs,
    });
  }

  function observePersistedProcessExit(
    row: ServiceRow,
    handle: ProcessHandle
  ): void {
    handle.exited
      .then(async () => {
        if (!deleteActiveServiceHandle(row.service.id, handle)) {
          return;
        }
        activePersistedRecoveries.delete(row.service.id);
        if (isServiceStopRequested(row)) {
          return;
        }
        await markServiceError(
          row.service.id,
          row.cell.id,
          `Persisted process ${handle.pid} exited`
        );
      })
      .catch((error) => {
        logger.error("Persisted service exit monitor failed", {
          serviceId: row.service.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  async function normalizeServiceForRestart(row: ServiceRow): Promise<void> {
    if (!row.service.pid) {
      return;
    }

    await repository.updateService(row.service.id, {
      pid: null,
      status: "needs_resume",
    });
    row.service.pid = null;
    row.service.status = "needs_resume";
  }

  async function restartServicesForCell(args: {
    rows: ServiceRow[];
    portMap: CellPortMap;
    templateEnv: Record<string, string>;
  }) {
    const { rows, portMap, templateEnv } = args;
    const namesToRestart = resolveRestartServiceNames(rows);
    const failedServiceNames = new Set<string>();

    for (const row of sortServiceRows(rows)) {
      if (!namesToRestart.has(row.service.name)) {
        continue;
      }
      const definition = row.service.definition as ProcessService;
      const failedDependencies = (definition.dependsOn ?? []).filter(
        (dependency) => failedServiceNames.has(dependency)
      );
      if (failedDependencies.length > 0) {
        failedServiceNames.add(row.service.name);
        await markServiceError(
          row.service.id,
          row.cell.id,
          `Dependencies failed during restart: ${failedDependencies.join(", ")}`
        );
        continue;
      }
      const requiredAsDependency = !AUTO_RESTART_STATUSES.has(
        row.service.status
      );
      const restarted = await restartServiceDuringBootstrap({
        row,
        requiredAsDependency,
        portMap,
        templateEnv,
      });
      if (!restarted) {
        failedServiceNames.add(row.service.name);
      }
    }
  }

  async function restartServiceDuringBootstrap(args: {
    row: ServiceRow;
    requiredAsDependency: boolean;
    portMap: CellPortMap;
    templateEnv: Record<string, string>;
  }): Promise<boolean> {
    try {
      if (
        await shouldSkipRestart(
          args.row,
          args.requiredAsDependency,
          args.portMap
        )
      ) {
        return true;
      }
      await startService(args.row, undefined, args.templateEnv, args.portMap);
      return true;
    } catch (error) {
      if (shuttingDown) {
        throw error;
      }
      logger.error("Failed to restart service", {
        serviceId: args.row.service.id,
        cellId: args.row.cell.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  function ensureCellServices({
    cell,
    template,
    onTimingEvent,
  }: {
    cell: Cell;
    template?: Template;
    onTimingEvent?: (event: EnsureCellServicesTimingEvent) => void;
  }): Promise<void> {
    return runWithCellLock(cell.id, async () => {
      const currentCell = await requireStartableCell(cell.id);
      ensureCellEnvironment(currentCell.id, currentCell.workspacePath);
      const resolvedTemplate =
        template ??
        (await loadTemplateCached(
          currentCell.templateId,
          currentCell.workspaceRootPath ?? currentCell.workspacePath
        ));

      if (!resolvedTemplate) {
        return;
      }

      const templateEnv = resolvedTemplate.env ?? {};
      const serviceOrder = preflightTemplateServices(resolvedTemplate);
      const prepared = await prepareProcessServices(
        currentCell,
        resolvedTemplate
      );
      const portMap = await buildPortMap(prepared.map((entry) => entry.row));

      await runTemplateSetupCommands({
        cell: currentCell,
        template: resolvedTemplate,
        templateEnv,
        portMap,
        onTimingEvent,
      });

      const preparedByName = new Map(
        prepared.map((entry) => [entry.row.service.name, entry])
      );
      for (const serviceName of serviceOrder) {
        const entry = preparedByName.get(serviceName);
        if (!entry) {
          throw new Error(`Service "${serviceName}" was not prepared`);
        }
        const { row, definition } = entry;
        await startOrFail({
          row,
          definition,
          templateEnv,
          portMap,
          onTimingEvent,
        });
      }
    });
  }

  function runCellTeardown(args: {
    cell: Cell;
    template?: Template;
    reason: TemplateTeardownReason;
  }): Promise<void> {
    return runWithCellLock(args.cell.id, () => runCellTeardownUnlocked(args));
  }

  async function runCellTeardownUnlocked(args: {
    cell: Cell;
    template?: Template;
    reason: TemplateTeardownReason;
  }): Promise<void> {
    const template =
      args.template ??
      (await loadTemplateCached(
        args.cell.templateId,
        args.cell.workspaceRootPath ?? args.cell.workspacePath
      ));
    if (!template?.teardown?.length) {
      return;
    }
    if (
      args.cell.status === "spawning" &&
      !args.cell.baseCommit &&
      !existsSync(args.cell.workspacePath)
    ) {
      return;
    }

    const rows = await repository.fetchServicesForCell(args.cell.id);
    const portMap = await buildPersistedPortMap(rows);
    const environment = interpolatePorts(
      {
        ...(template.env ?? {}),
        ...buildBaseEnv({ serviceName: template.id, cell: args.cell }),
        ...buildSharedPortEnv(portMap),
        HIVE_MAIN_REPO: args.cell.workspaceRootPath ?? args.cell.workspacePath,
        HIVE_TEARDOWN_REASON: args.reason,
      },
      portMap,
      template.id
    );
    const timeoutMs = resolveTemplateTeardownCommandTimeoutMs();
    const commands = template.teardown.map((rawCommand) =>
      interpolatePortReferences(rawCommand, portMap, template.id)
    );
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          commands,
          environment: Object.fromEntries(
            Object.entries(environment).sort(([left], [right]) =>
              left.localeCompare(right)
            )
          ),
          reason: args.reason,
          templateId: template.id,
        })
      )
      .digest("hex")
      .slice(0, TEARDOWN_FINGERPRINT_LENGTH);
    const completedCommands = resolveCompletedTeardownCommands(
      args.cell.deletionPhase,
      fingerprint
    );

    for (const [index, command] of commands.entries()) {
      if (index < completedCommands) {
        continue;
      }
      await runTemplateTeardownCommand({
        cell: args.cell,
        command,
        environment,
        template,
        timeoutMs,
      });
      const deletionPhase = `teardown:${fingerprint}:${index + 1}` as const;
      await db
        .update(cells)
        .set({ deletionPhase })
        .where(eq(cells.id, args.cell.id));
      args.cell.deletionPhase = deletionPhase;
    }
  }

  function resolveCompletedTeardownCommands(
    phase: Cell["deletionPhase"],
    fingerprint: string
  ): number {
    const prefix = `teardown:${fingerprint}:`;
    if (!phase?.startsWith(prefix)) {
      return 0;
    }
    const completed = Number.parseInt(phase.slice(prefix.length), 10);
    return Number.isSafeInteger(completed) && completed >= 0 ? completed : 0;
  }

  async function runTemplateTeardownCommand(args: {
    cell: Cell;
    command: string;
    environment: Record<string, string>;
    template: Template;
    timeoutMs: number;
  }): Promise<void> {
    const process = spawnProcess({
      command: args.command,
      cwd: args.cell.workspacePath,
      env: args.environment,
    });
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const result = await Promise.race([
      process.exited.then((exitCode) => ({ type: "exit" as const, exitCode })),
      new Promise<{ type: "timeout" }>((resolveTimeout) => {
        timeoutHandle = setTimeout(
          () => resolveTimeout({ type: "timeout" }),
          args.timeoutMs
        );
      }),
    ]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    if (result.type === "timeout") {
      await terminateProcessHandle(process);
      throw new Error(
        `Template teardown command "${args.command}" timed out after ${args.timeoutMs}ms for template "${args.template.id}"`
      );
    }

    if (result.exitCode !== 0) {
      throw new Error(
        `Template teardown command "${args.command}" failed with exit code ${result.exitCode} for template "${args.template.id}"`
      );
    }

    logger.info("Template teardown command completed", {
      cellId: args.cell.id,
      templateId: args.template.id,
      command: args.command,
    });
  }

  async function prepareProcessServices(
    cell: Cell,
    template: Template
  ): Promise<Array<{ row: ServiceRow; definition: ProcessService }>> {
    const prepared: Array<{ row: ServiceRow; definition: ProcessService }> = [];

    for (const [name, definition] of Object.entries(template.services ?? {})) {
      if (definition.type !== "process") {
        throw new Error(
          `Unsupported service type "${definition.type}" for service "${name}"`
        );
      }

      const row = await ensureService(cell, name, definition);
      prepared.push({ row, definition });
    }

    return prepared;
  }

  async function startOrFail(args: {
    row: ServiceRow;
    definition: ProcessService;
    templateEnv: Record<string, string>;
    portMap: CellPortMap;
    onTimingEvent?: (event: EnsureCellServicesTimingEvent) => void;
  }) {
    const { row, definition, templateEnv, portMap, onTimingEvent } = args;
    const startedAt = Date.now();
    try {
      await startService(row, definition, templateEnv, portMap);
      const durationMs = Date.now() - startedAt;
      logger.info("Service startup completed", {
        serviceId: row.service.id,
        serviceName: row.service.name,
        cellId: row.cell.id,
        durationMs,
      });
      onTimingEvent?.({
        step: `service_start:${row.service.name}`,
        status: "ok",
        durationMs,
        metadata: {
          serviceId: row.service.id,
          serviceName: row.service.name,
        },
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logger.error("Failed to start service", {
        serviceId: row.service.id,
        cellId: row.cell.id,
        error: error instanceof Error ? error.message : String(error),
      });
      onTimingEvent?.({
        step: `service_start:${row.service.name}`,
        status: "error",
        durationMs,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          serviceId: row.service.id,
          serviceName: row.service.name,
        },
      });
      throw error;
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: setup flow must stream lifecycle, handle command failures, and preserve TemplateSetupError semantics.
  async function runTemplateSetupCommands(args: {
    cell: Cell;
    template: Template;
    templateEnv: Record<string, string>;
    portMap: CellPortMap;
    onTimingEvent?: (event: EnsureCellServicesTimingEvent) => void;
  }): Promise<void> {
    const { cell, template, templateEnv, portMap, onTimingEvent } = args;
    if (!template.setup?.length) {
      return;
    }

    if (!cell.workspacePath) {
      throw new Error("Cell workspace path missing");
    }

    const env = interpolatePorts(
      {
        ...templateEnv,
        ...buildBaseEnv({ serviceName: template.id, cell }),
        ...buildSharedPortEnv(portMap),
        HIVE_WORKTREE_SETUP: "true",
        HIVE_MAIN_REPO: cell.workspaceRootPath ?? cell.workspacePath,
        FORCE_COLOR: "1",
      },
      portMap,
      template.id
    );

    terminalRuntime.startSetupSession({
      cellId: cell.id,
      cwd: cell.workspacePath,
    });

    terminalRuntime.appendSetupLine(
      cell.id,
      `[setup] Starting template setup for ${template.id} (${template.setup.length} command${
        template.setup.length === 1 ? "" : "s"
      })`
    );

    const timeoutMs = resolveTemplateSetupCommandTimeoutMs();
    const setupStartedAt = Date.now();
    let setupFinished = false;

    try {
      for (const rawCommand of template.setup) {
        requireStartableSupervisor();
        const command = interpolatePortReferences(
          rawCommand,
          portMap,
          template.id
        );
        const commandStartedAt = Date.now();
        terminalRuntime.appendSetupLine(cell.id, `[setup] Running: ${command}`);
        const proc = spawnProcess({
          command,
          cwd: cell.workspacePath,
          env,
          onData: (chunk) => terminalRuntime.appendSetupOutput(cell.id, chunk),
        });
        activeTemplateSetups.set(cell.id, proc);
        observeTemplateSetupExit(cell.id, proc);

        terminalRuntime.attachSetupProcess({
          cellId: cell.id,
          process: {
            pid: proc.pid,
            kill: proc.kill,
            resize: proc.resize,
            write: proc.write,
          },
        });

        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<{ type: "timeout" }>(
          (resolveTimeout) => {
            timeoutHandle = setTimeout(() => {
              resolveTimeout({ type: "timeout" });
            }, timeoutMs);
          }
        );
        const exitResult = await Promise.race([
          proc.exited.then((code) => ({
            type: "exit" as const,
            exitCode: code,
          })),
          timeoutPromise,
        ]);
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (cancelledTemplateSetups.has(proc)) {
          throw new Error(`Template setup for cell "${cell.id}" cancelled`);
        }

        if (exitResult.type === "timeout") {
          const durationMs = Date.now() - commandStartedAt;
          await terminateProcessHandle(proc);
          deleteTrackedHandle(activeTemplateSetups, cell.id, proc);

          markTemplateSetupCommandFailure({
            cellId: cell.id,
            command,
            durationMs,
            exitCode: 124,
            line: `[setup] Timed out: ${command} after ${timeoutMs}ms`,
            error: `Template setup command timed out after ${timeoutMs}ms`,
            metadata: { timeoutMs },
            onTimingEvent,
            template,
          });
          throw new TemplateSetupError({
            command,
            templateId: template.id,
            workspacePath: cell.workspacePath,
            cause: new Error(
              `Template setup command timed out after ${timeoutMs}ms`
            ),
            exitCode: 124,
          });
        }

        deleteTrackedHandle(activeTemplateSetups, cell.id, proc);
        const exitCode = exitResult.exitCode;
        if (exitCode !== 0) {
          const durationMs = Date.now() - commandStartedAt;
          markTemplateSetupCommandFailure({
            cellId: cell.id,
            command,
            durationMs,
            exitCode,
            line: `[setup] Failed: ${command} (exit ${exitCode})`,
            error: `Template setup command failed with exit code ${exitCode}`,
            metadata: { exitCode },
            onTimingEvent,
            template,
          });
          throw new TemplateSetupError({
            command,
            templateId: template.id,
            workspacePath: cell.workspacePath,
            exitCode,
          });
        }

        terminalRuntime.appendSetupLine(
          cell.id,
          `[setup] Completed: ${command}`
        );
        const durationMs = Date.now() - commandStartedAt;
        logger.info("Template setup command completed", {
          cellId: cell.id,
          templateId: template.id,
          command,
          durationMs,
        });
        onTimingEvent?.({
          step: `template_setup:${command}`,
          status: "ok",
          durationMs,
          metadata: {
            command,
            templateId: template.id,
          },
        });
      }

      terminalRuntime.appendSetupLine(
        cell.id,
        `[setup] Template setup finished for ${template.id}`
      );
      terminalRuntime.markSetupExit({
        cellId: cell.id,
        exitCode: 0,
        signal: null,
      });
      logger.info("Template setup completed", {
        cellId: cell.id,
        templateId: template.id,
        durationMs: Date.now() - setupStartedAt,
        timeoutMs,
      });
      setupFinished = true;
      onTimingEvent?.({
        step: "template_setup_total",
        status: "ok",
        durationMs: Date.now() - setupStartedAt,
        metadata: {
          templateId: template.id,
          timeoutMs,
          commandCount: template.setup.length,
        },
      });
    } catch (error) {
      if (!setupFinished) {
        onTimingEvent?.({
          step: "template_setup_total",
          status: "error",
          durationMs: Date.now() - setupStartedAt,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            templateId: template.id,
            timeoutMs,
            commandCount: template.setup.length,
          },
        });
      }

      if (error instanceof TemplateSetupError) {
        throw error;
      }

      terminalRuntime.appendSetupLine(
        cell.id,
        `[setup] Failed: ${
          error instanceof Error ? error.message : String(error ?? "unknown")
        }`
      );
      terminalRuntime.markSetupExit({
        cellId: cell.id,
        exitCode: 1,
        signal: null,
      });
      throw error;
    }
  }

  function markTemplateSetupCommandFailure(args: {
    cellId: string;
    command: string;
    durationMs: number;
    exitCode: number;
    line: string;
    error: string;
    metadata: Record<string, unknown>;
    onTimingEvent?: (event: EnsureCellServicesTimingEvent) => void;
    template: Template;
  }) {
    terminalRuntime.appendSetupLine(args.cellId, args.line);
    terminalRuntime.markSetupExit({
      cellId: args.cellId,
      exitCode: args.exitCode,
      signal: null,
    });
    args.onTimingEvent?.({
      step: `template_setup:${args.command}`,
      status: "error",
      durationMs: args.durationMs,
      error: args.error,
      metadata: {
        command: args.command,
        ...args.metadata,
        templateId: args.template.id,
      },
    });
  }

  async function assertServiceDefinitionCanUpdate(
    record: CellService,
    cell: Cell,
    serviceName: string
  ): Promise<void> {
    if (activeServices.has(record.id)) {
      throw new Error(
        `Cannot update service "${serviceName}" while it is running; stop it before retrying setup`
      );
    }
    if (!record.pid) {
      return;
    }
    const row = { service: record, cell };
    const identity = await resolvePersistedProcessIdentity(row);
    if (identity === "owned") {
      throw new Error(
        `Cannot update service "${serviceName}" while it is running; stop it before retrying setup`
      );
    }
    if (identity === "unverifiable") {
      throw new Error(persistedIdentityError(row));
    }
    await clearStalePersistedPid(row);
  }

  async function ensureService(
    cell: Cell,
    name: string,
    definition: ProcessService
  ): Promise<ServiceRow> {
    let record = await repository.findByCellAndName(cell.id, name);
    const resolvedCwd = resolveServiceCwd(cell.workspacePath, definition.cwd);

    if (record) {
      const shouldUpdate = needsDefinitionUpdate(
        record,
        definition,
        resolvedCwd
      );
      if (shouldUpdate) {
        await assertServiceDefinitionCanUpdate(record, cell, name);
        record =
          (await repository.updateService(record.id, {
            command: definition.run,
            cwd: resolvedCwd,
            readyTimeoutMs: definition.readyTimeoutMs ?? null,
            definition,
          })) ?? record;
      }
    } else {
      record = await repository.insertService(cell, {
        id: randomUUID(),
        name,
        type: definition.type,
        command: definition.run,
        cwd: resolvedCwd,
        env: buildBaseEnv({ serviceName: name, cell }),
        port: null,
        pid: null,
        status: "pending",
        readyTimeoutMs: definition.readyTimeoutMs ?? null,
        definition,
        lastKnownError: null,
      });
    }

    if (!record) {
      throw new Error("Failed to ensure service record");
    }

    return { service: record, cell };
  }

  function startCellServices(cellId: string): Promise<void> {
    return runWithCellLock(cellId, async () => {
      await requireStartableCell(cellId);
      await startCellServicesUnlocked(cellId);
    });
  }

  async function startCellServicesUnlocked(cellId: string): Promise<void> {
    const rows = await repository.fetchServicesForCell(cellId);
    if (rows.length === 0) {
      return;
    }

    const cell = rows[0]?.cell;
    if (!cell) {
      return;
    }
    const template = await loadTemplateCached(
      cell.templateId,
      cell.workspaceRootPath ?? cell.workspacePath
    );
    const templateEnv = template?.env ?? {};
    const portMap = await buildPortMap(rows);

    for (const row of sortServiceRows(rows)) {
      await startService(row, undefined, templateEnv, portMap);
    }
  }

  async function stopCellServices(
    cellId: string,
    options?: { releasePorts?: boolean }
  ): Promise<void> {
    cellsStopping.add(cellId);
    try {
      const pendingRows = await repository.fetchServicesForCell(cellId);
      await cancelCellPreLockProcesses(
        cellId,
        pendingRows.map((row) => row.service.id)
      );
      await runWithCellLock(cellId, async () => {
        const rows = await repository.fetchServicesForCell(cellId);
        const portMap = await buildPersistedPortMap(rows);
        let firstError: unknown;

        for (const row of sortServiceRows(rows, true)) {
          try {
            await stopService(
              row,
              options?.releasePorts ?? false,
              "stopped",
              portMap
            );
          } catch (error) {
            firstError ??= error;
          }
        }
        if (firstError) {
          throw firstError;
        }
      });
    } finally {
      cellsStopping.delete(cellId);
    }
  }

  async function stopAll(): Promise<void> {
    shuttingDown = true;
    let firstError = await collectFirstError(undefined, () =>
      cancelTemplateSetups([...activeTemplateSetups.keys()])
    );
    firstError = await collectFirstError(firstError, () =>
      cancelPreLockProcesses([
        ...activeServiceStarts.keys(),
        ...activeServiceSetups.keys(),
        ...activePersistedRecoveries.keys(),
      ])
    );
    const grouped = groupServicesByCell(await repository.fetchAllServices());

    for (const { rows } of grouped.values()) {
      firstError = await collectFirstError(firstError, () =>
        stopShutdownGroup(rows)
      );
    }

    terminalRuntime.stopAll();
    if (firstError) {
      throw firstError;
    }
  }

  async function collectFirstError(
    current: unknown,
    action: () => Promise<unknown>
  ): Promise<unknown> {
    try {
      await action();
      return current;
    } catch (error) {
      return current ?? error;
    }
  }

  async function stopShutdownGroup(rows: ServiceRow[]): Promise<void> {
    const cellId = rows[0]?.cell.id;
    if (!cellId) {
      return;
    }
    if (activeTemplateSetups.has(cellId)) {
      const error = await stopRowsForShutdownUnlocked(rows);
      if (error) {
        throw error;
      }
      return;
    }
    await stopRowsForShutdown(cellId, rows);
  }

  async function shouldSkipStartService(row: ServiceRow): Promise<boolean> {
    if (
      activeServiceSetups.has(row.service.id) ||
      retainedServiceSetups.has(row.service.id)
    ) {
      return true;
    }
    if (activeServices.has(row.service.id)) {
      return true;
    }
    if (row.service.pid) {
      const identity = await resolvePersistedProcessIdentity(row);
      if (identity === "owned") {
        return true;
      }
      if (identity === "unverifiable") {
        throw new Error(persistedIdentityError(row));
      }
      await clearStalePersistedPid(row);
    }

    return false;
  }

  async function hasOccupiedServicePort(row: ServiceRow): Promise<boolean> {
    return (
      typeof row.service.port === "number" &&
      !(await isPortFree(row.service.port))
    );
  }

  async function startService(
    row: ServiceRow,
    definitionOverride?: ProcessService,
    templateEnv: Record<string, string> = {},
    portLookup?: CellPortMap
  ): Promise<void> {
    await runWithServiceLock(row.service.id, async () => {
      requireStartableSupervisor();
      const latestRow = await repository.fetchServiceRowById(row.service.id);
      const serviceRow = latestRow ?? row;
      const definition =
        definitionOverride ??
        (serviceRow.service.definition as ProcessService | null);

      if (!definition || definition.type !== "process") {
        throw new Error(
          `Unsupported service type "${definition?.type ?? serviceRow.service.type}" for service "${serviceRow.service.name}"`
        );
      }

      if (await shouldSkipStartService(serviceRow)) {
        return;
      }

      const allocation = await prepareServicePorts(
        serviceRow,
        definition,
        portLookup
      );
      const port = getPrimaryPort(serviceRow.service.name, allocation);
      const cwd = resolveServiceCwd(
        serviceRow.cell.workspacePath,
        definition.cwd
      );

      if (!(await ensureServiceDirectory(serviceRow, cwd))) {
        return;
      }

      const resolvedPortMap = new Map(portLookup ?? []);
      resolvedPortMap.set(serviceRow.service.name, allocation);
      const env = buildServiceEnv({
        serviceName: serviceRow.service.name,
        port,
        templateEnv,
        serviceEnv: definition.env ?? {},
        cell: serviceRow.cell,
        portMap: resolvedPortMap,
      });

      await repository.updateService(serviceRow.service.id, {
        status: "starting",
        env,
        port,
        pid: null,
        lastKnownError: null,
      });

      notifyServiceUpdate(serviceRow);

      await runServiceProcess({
        row: serviceRow,
        definition,
        env,
        cwd,
        command: interpolatePortReferences(
          definition.run,
          resolvedPortMap,
          serviceRow.service.name
        ),
        allocation,
        portMap: resolvedPortMap,
      });
    });
  }

  async function prepareServicePorts(
    row: ServiceRow,
    definition: ProcessService,
    portLookup?: CellPortMap
  ) {
    const allocation =
      portLookup?.get(row.service.name) ??
      (await portManager.ensureServicePorts(
        row.service,
        resolveNamedPortDefinitions(definition)
      ));
    row.service.port = getPrimaryPort(row.service.name, allocation);
    return allocation;
  }

  async function ensureServiceDirectory(row: ServiceRow, cwd: string) {
    if (existsSync(cwd)) {
      return true;
    }

    await markServiceError(
      row.service.id,
      row.cell.id,
      "Service working directory not found"
    );

    logger.error("Service directory missing", {
      serviceId: row.service.id,
      cwd,
    });

    return false;
  }

  async function runServiceProcess({
    row,
    definition,
    env,
    cwd,
    command,
    allocation,
    portMap,
  }: ServiceProcessOptions) {
    try {
      const processEnvironment = {
        ...env,
        [SERVICE_INSTANCE_ENV_KEY]: randomUUID(),
      };
      terminalRuntime.startServiceSession({
        serviceId: row.service.id,
        cwd,
        process: {
          pid: 0,
        },
      });
      terminalRuntime.appendServiceOutput(
        row.service.id,
        `[service:${row.service.name}] Starting ${command}\n`
      );

      await runServiceSetup({ row, definition, cwd, env, portMap });

      requireStartableSupervisor();
      const handle = spawnProcess({
        command,
        cwd,
        env: processEnvironment,
        onData: (chunk) =>
          terminalRuntime.appendServiceOutput(row.service.id, chunk),
        onExit: ({ exitCode, signal }) => {
          terminalRuntime.markServiceExit({
            serviceId: row.service.id,
            exitCode,
            signal,
          });
        },
      });

      terminalRuntime.startServiceSession({
        serviceId: row.service.id,
        cwd,
        process: {
          pid: handle.pid,
          kill: handle.kill,
          resize: handle.resize,
          write: handle.write,
        },
      });

      activeServices.set(row.service.id, { handle });
      activeServiceStarts.set(row.service.id, handle);
      row.service.env = processEnvironment;

      await repository.updateService(row.service.id, {
        status: "starting",
        pid: handle.pid,
        env: processEnvironment,
      });

      notifyServiceUpdate(row);

      let startupComplete = false;
      handle.exited
        .then(async (code) => {
          if (!clearActiveServiceProcess(row.service.id, handle)) {
            return;
          }

          await repository.updateService(row.service.id, {
            status: startupComplete && code === 0 ? "stopped" : "error",
            pid: null,
            lastKnownError:
              startupComplete && code === 0
                ? null
                : `Exited with code ${code ?? -1}`,
          });

          notifyServiceUpdate(row);
        })
        .catch((error) => {
          if (!clearActiveServiceProcess(row.service.id, handle)) {
            return;
          }

          logger.error("Service exited with error", {
            serviceId: row.service.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      if (definition.readiness) {
        await waitForServiceReadiness({
          serviceName: row.service.name,
          readiness: definition.readiness,
          ports: allocation.ports,
          processExited: handle.exited,
          timeoutMs: definition.readyTimeoutMs,
        });
      }

      requireActiveServiceHandle(row, handle);
      await repository.updateService(row.service.id, {
        status: "running",
        pid: handle.pid,
      });
      requireActiveServiceHandle(row, handle);
      startupComplete = true;
      deleteTrackedHandle(activeServiceStarts, row.service.id, handle);
      notifyServiceUpdate(row);
    } catch (error) {
      const active = activeServices.get(row.service.id);
      if (active) {
        await terminateHandle(active.handle);
        activeServices.delete(row.service.id);
        deleteTrackedHandle(activeServiceStarts, row.service.id, active.handle);
      }
      terminalRuntime.markServiceExit({
        serviceId: row.service.id,
        exitCode: 1,
        signal: null,
      });
      await markServiceError(
        row.service.id,
        row.cell.id,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  function deleteActiveServiceHandle(
    serviceId: string,
    handle: ProcessHandle
  ): boolean {
    const active = activeServices.get(serviceId);
    if (!active || active.handle !== handle) {
      return false;
    }

    activeServices.delete(serviceId);
    return true;
  }

  function clearActiveServiceProcess(
    serviceId: string,
    handle: ProcessHandle
  ): boolean {
    if (!deleteActiveServiceHandle(serviceId, handle)) {
      return false;
    }
    deleteTrackedHandle(activeServiceStarts, serviceId, handle);
    return true;
  }

  function requireActiveServiceHandle(
    row: ServiceRow,
    handle: ProcessHandle
  ): void {
    if (activeServices.get(row.service.id)?.handle !== handle) {
      throw new Error(
        `Service "${row.service.name}" exited before becoming ready`
      );
    }
  }

  async function runServiceSetup(args: {
    row: ServiceRow;
    definition: ProcessService;
    cwd: string;
    env: Record<string, string>;
    portMap: CellPortMap;
  }) {
    const { row, definition, cwd, env, portMap } = args;
    if (!definition.setup?.length) {
      return;
    }

    for (const rawSetupCommand of definition.setup) {
      requireStartableSupervisor();
      const setupCommand = interpolatePortReferences(
        rawSetupCommand,
        portMap,
        row.service.name
      );
      const startedAt = Date.now();
      terminalRuntime.appendServiceOutput(
        row.service.id,
        `[service:${row.service.name}] setup: ${setupCommand}\n`
      );
      await runServiceSetupCommand({ row, command: setupCommand, cwd, env });
      logger.info("Service setup command completed", {
        serviceId: row.service.id,
        serviceName: row.service.name,
        cellId: row.cell.id,
        command: setupCommand,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  async function runServiceSetupCommand(args: {
    row: ServiceRow;
    command: string;
    cwd: string;
    env: Record<string, string>;
  }): Promise<void> {
    const handle = spawnProcess({
      command: args.command,
      cwd: args.cwd,
      env: args.env,
      onData: (chunk) =>
        terminalRuntime.appendServiceOutput(args.row.service.id, chunk),
    });
    activeServiceSetups.set(args.row.service.id, { handle });
    if (isServiceStopRequested(args.row)) {
      await terminateTrackedServiceSetup(args.row.service.id, handle);
      throw new Error(`Service "${args.row.service.name}" setup cancelled`);
    }
    const timeoutMs = resolveServiceSetupCommandTimeoutMs();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const result = await Promise.race([
        handle.exited.then((exitCode) => ({
          type: "exit" as const,
          exitCode,
        })),
        new Promise<{ type: "timeout" }>((resolveTimeout) => {
          timeoutHandle = setTimeout(
            () => resolveTimeout({ type: "timeout" }),
            timeoutMs
          );
        }),
      ]);
      requireActiveServiceSetup(args.row, handle);
      if (result.type === "timeout") {
        await terminateTrackedServiceSetup(args.row.service.id, handle);
        throw new Error(
          `Service "${args.row.service.name}" setup command timed out after ${timeoutMs}ms`
        );
      }
      if (result.exitCode !== 0) {
        throw new CommandExecutionError({
          command: args.command,
          cwd: args.cwd,
          exitCode: result.exitCode,
        });
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      clearServiceSetupTracking(args.row.service.id, handle);
    }
  }

  async function terminateTrackedServiceSetup(
    serviceId: string,
    handle: ProcessHandle
  ): Promise<void> {
    try {
      await terminateProcessHandle(handle);
    } catch (error) {
      retainServiceSetup(serviceId, handle);
      throw error;
    }
    if (activeServiceSetups.get(serviceId)?.handle === handle) {
      activeServiceSetups.delete(serviceId);
    }
    if (retainedServiceSetups.get(serviceId) === handle) {
      retainedServiceSetups.delete(serviceId);
    }
  }

  function requireActiveServiceSetup(
    row: ServiceRow,
    handle: ProcessHandle
  ): void {
    const cancelled =
      activeServiceSetups.get(row.service.id)?.handle !== handle ||
      retainedServiceSetups.get(row.service.id) === handle ||
      isServiceStopRequested(row);
    if (cancelled) {
      throw new Error(`Service "${row.service.name}" setup cancelled`);
    }
  }

  function clearServiceSetupTracking(
    serviceId: string,
    handle: ProcessHandle
  ): void {
    if (
      retainedServiceSetups.get(serviceId) !== handle &&
      activeServiceSetups.get(serviceId)?.handle === handle
    ) {
      activeServiceSetups.delete(serviceId);
    }
  }

  function retainServiceSetup(serviceId: string, handle: ProcessHandle): void {
    if (retainedServiceSetups.get(serviceId) === handle) {
      return;
    }
    retainedServiceSetups.set(serviceId, handle);
    const clearAfterProcessGroupExit = async () => {
      await waitForTrackedProcessGroupExit(handle);
      if (retainedServiceSetups.get(serviceId) === handle) {
        retainedServiceSetups.delete(serviceId);
      }
      if (activeServiceSetups.get(serviceId)?.handle === handle) {
        activeServiceSetups.delete(serviceId);
      }
    };
    clearAfterProcessGroupExit().catch((error) => {
      logger.error("Retained service setup exit monitor failed", {
        serviceId,
        error: formatError(error),
      });
    });
  }

  async function cancelServiceSetups(serviceIds: string[]): Promise<void> {
    await runAllCollectingFirstError(serviceIds, cancelServiceSetup);
  }

  async function cancelServiceSetup(serviceId: string): Promise<void> {
    const active = activeServiceSetups.get(serviceId);
    if (!active) {
      return;
    }
    try {
      await terminateProcessHandle(active.handle);
    } catch (error) {
      retainServiceSetup(serviceId, active.handle);
      throw error;
    }
    if (activeServiceSetups.get(serviceId)?.handle === active.handle) {
      activeServiceSetups.delete(serviceId);
    }
    if (retainedServiceSetups.get(serviceId) === active.handle) {
      retainedServiceSetups.delete(serviceId);
    }
  }

  async function cancelPersistedRecoveries(
    serviceIds: string[]
  ): Promise<void> {
    await runAllCollectingFirstError(serviceIds, cancelPersistedRecovery);
  }

  async function cancelPersistedRecovery(serviceId: string): Promise<void> {
    const recovery = activePersistedRecoveries.get(serviceId);
    if (!recovery) {
      return;
    }
    const row = await repository.fetchServiceRowById(serviceId);
    if (
      !(row && (await shouldTerminatePersistedHandle(row, recovery.handle)))
    ) {
      forgetPersistedTracking(serviceId, recovery.handle);
      return;
    }
    await terminateTrackedPersistedRecovery(serviceId, recovery);
  }

  async function shouldTerminatePersistedHandle(
    row: ServiceRow,
    handle: ProcessHandle
  ): Promise<boolean> {
    const identity = await resolvePersistedProcessIdentity(row);
    if (identity === "unverifiable") {
      throw new Error(persistedIdentityError(row));
    }
    return (
      identity === "owned" ||
      (identity === "exited" && isProcessGroupAlive(handle.pid))
    );
  }

  function persistedIdentityError(row: ServiceRow): string {
    return `Cannot safely stop service "${row.service.name}" because persisted PID ${row.service.pid} is still running but its process identity cannot be verified`;
  }

  function forgetPersistedTracking(
    serviceId: string,
    handle: ProcessHandle
  ): void {
    activePersistedRecoveries.delete(serviceId);
    if (activeServices.get(serviceId)?.handle === handle) {
      activeServices.delete(serviceId);
    }
  }

  async function terminateTrackedPersistedRecovery(
    serviceId: string,
    recovery: ActiveServiceHandle
  ): Promise<void> {
    activePersistedRecoveries.delete(serviceId);
    const active = activeServices.get(serviceId);
    if (active?.handle === recovery.handle) {
      activeServices.delete(serviceId);
    }
    try {
      await terminateProcessHandle(recovery.handle);
    } catch (error) {
      activePersistedRecoveries.set(serviceId, recovery);
      if (active?.handle === recovery.handle) {
        activeServices.set(serviceId, active);
      }
      throw error;
    }
  }

  async function cancelPreLockProcesses(serviceIds: string[]): Promise<void> {
    await runAllCollectingFirstError(
      [cancelServiceStarts, cancelServiceSetups, cancelPersistedRecoveries],
      (cancel) => cancel(serviceIds)
    );
  }

  async function cancelCellPreLockProcesses(
    cellId: string,
    serviceIds: string[]
  ): Promise<void> {
    await runAllCollectingFirstError(
      [
        () => cancelTemplateSetup(cellId),
        () => cancelPreLockProcesses(serviceIds),
      ],
      (cancel) => cancel()
    );
  }

  async function cancelTemplateSetups(cellIds: string[]): Promise<void> {
    await runAllCollectingFirstError(cellIds, cancelTemplateSetup);
  }

  async function cancelTemplateSetup(cellId: string): Promise<void> {
    const handle = activeTemplateSetups.get(cellId);
    if (!handle) {
      return;
    }
    cancelledTemplateSetups.add(handle);
    await terminateProcessHandle(handle);
    deleteTrackedHandle(activeTemplateSetups, cellId, handle);
  }

  function observeTemplateSetupExit(
    cellId: string,
    handle: ProcessHandle
  ): void {
    const clearAfterProcessGroupExit = async () => {
      await waitForTrackedProcessGroupExit(handle);
      deleteTrackedHandle(activeTemplateSetups, cellId, handle);
    };
    clearAfterProcessGroupExit().catch((error) => {
      logger.error("Template setup exit monitor failed", {
        cellId,
        error: formatError(error),
      });
    });
  }

  async function cancelServiceStarts(serviceIds: string[]): Promise<void> {
    await runAllCollectingFirstError(serviceIds, async (serviceId) => {
      const handle = activeServiceStarts.get(serviceId);
      if (!handle) {
        return;
      }
      await terminateProcessHandle(handle);
      deleteTrackedHandle(activeServiceStarts, serviceId, handle);
      if (activeServices.get(serviceId)?.handle === handle) {
        activeServices.delete(serviceId);
      }
    });
  }

  async function runAllCollectingFirstError<Item>(
    items: Iterable<Item>,
    action: (item: Item) => Promise<unknown>
  ): Promise<void> {
    let firstError: unknown;
    for (const item of items) {
      firstError = await collectFirstError(firstError, () => action(item));
    }
    if (firstError) {
      throw firstError;
    }
  }

  async function waitForTrackedProcessGroupExit(
    handle: ProcessHandle
  ): Promise<void> {
    await handle.exited.catch(() => -1);
    while (isProcessGroupAlive(handle.pid)) {
      await delay(PROCESS_EXIT_POLL_INTERVAL_MS);
    }
  }

  function hasUnterminatedPreLockProcess(serviceId: string): boolean {
    return (
      activeServiceStarts.has(serviceId) ||
      activeServiceSetups.has(serviceId) ||
      retainedServiceSetups.has(serviceId) ||
      activePersistedRecoveries.has(serviceId)
    );
  }

  async function stopRowsForShutdown(
    cellId: string,
    rows: ServiceRow[]
  ): Promise<void> {
    let firstError: unknown;
    await runWithCellLock(cellId, async () => {
      firstError = await stopRowsForShutdownUnlocked(rows);
    });
    if (firstError) {
      throw firstError;
    }
  }

  async function stopRowsForShutdownUnlocked(
    rows: ServiceRow[]
  ): Promise<unknown> {
    let firstError: unknown;
    const portMap = await buildPersistedPortMap(rows);
    for (const row of sortServiceRows(rows, true)) {
      if (hasUnterminatedPreLockProcess(row.service.id)) {
        continue;
      }
      const statusAfterStop =
        row.service.status === "stopped" ? "stopped" : "needs_resume";
      try {
        await stopService(row, true, statusAfterStop, portMap);
      } catch (error) {
        firstError ??= error;
      }
    }
    return firstError;
  }

  function deleteTrackedHandle(
    handles: Map<string, ProcessHandle>,
    id: string,
    handle: ProcessHandle
  ): void {
    if (handles.get(id) === handle) {
      handles.delete(id);
    }
  }

  function shouldRunStopCommand(
    row: ServiceRow,
    active: ActiveServiceHandle | undefined
  ): boolean {
    return Boolean(
      active ||
        row.service.pid ||
        row.service.status === "running" ||
        row.service.status === "starting" ||
        row.service.status === "needs_resume"
    );
  }

  async function runServiceStopCommand(args: {
    row: ServiceRow;
    definition: ProcessService | null;
    active: ActiveServiceHandle | undefined;
    cwd: string;
    env: Record<string, string>;
    portMap: CellPortMap;
  }): Promise<unknown> {
    if (
      !(
        shouldRunStopCommand(args.row, args.active) &&
        args.definition?.type === "process" &&
        args.definition.stop
      )
    ) {
      return;
    }

    const command = interpolatePortReferences(
      args.definition.stop,
      args.portMap,
      args.row.service.name
    );
    try {
      await runCommand(command, {
        cwd: args.cwd,
        env: args.env,
        timeoutMs: resolveServiceStopCommandTimeoutMs(),
      });
    } catch (error) {
      logger.warn("Service stop command failed", {
        serviceId: args.row.service.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return error;
    }
  }

  async function stopService(
    row: ServiceRow,
    releasePort: boolean,
    statusAfterStop: ServiceStatus = "stopped",
    portMap: CellPortMap = new Map()
  ): Promise<void> {
    const definition = row.service.definition as ProcessService | null;
    const env = row.service.env;
    const cwd = resolveServiceCwd(row.cell.workspacePath, definition?.cwd);
    const active = activeServices.get(row.service.id);

    const stopCommandError = await runServiceStopCommand({
      row,
      definition,
      active,
      cwd,
      env,
      portMap,
    });

    await terminateServiceProcess(row, active);

    await repository.updateService(row.service.id, {
      status: statusAfterStop,
      pid: null,
    });

    terminalRuntime.markServiceExit({
      serviceId: row.service.id,
      exitCode: 0,
      signal: null,
    });

    notifyServiceUpdate(row);

    if (releasePort) {
      releasePortFor(row.service.id);
      terminalRuntime.clearServiceSession(row.service.id);
    }

    if (stopCommandError) {
      throw new Error(
        `Service "${row.service.name}" stop command failed: ${
          stopCommandError instanceof Error
            ? stopCommandError.message
            : String(stopCommandError)
        }`
      );
    }
  }

  async function terminateServiceProcess(
    row: ServiceRow,
    active: ActiveServiceHandle | undefined
  ): Promise<void> {
    if (active) {
      await terminateActiveServiceProcess(row, active);
      return;
    }

    await terminatePersistedServicePid(row);
  }

  async function terminateActiveServiceProcess(
    row: ServiceRow,
    active: ActiveServiceHandle
  ): Promise<void> {
    if (
      active.persisted &&
      !(await shouldTerminatePersistedHandle(row, active.handle))
    ) {
      activeServices.delete(row.service.id);
      return;
    }
    await terminateHandle(active.handle);
    activeServices.delete(row.service.id);
  }

  async function terminatePersistedServicePid(row: ServiceRow): Promise<void> {
    const persisted = await inspectPersistedServicePid(row);
    if (!persisted) {
      return;
    }
    if (persisted.identity === "owned") {
      await terminatePid(persisted.pid);
      return;
    }
    if (persisted.identity === "unverifiable") {
      throw new Error(persistedIdentityError(row));
    }
  }

  async function buildPortMap(rows: ServiceRow[]): Promise<CellPortMap> {
    const ports: CellPortMap = new Map();

    for (const row of rows) {
      await normalizePersistedPidForPortAllocation(row);
      const definition = row.service.definition as ProcessService;
      if (definition.type !== "process") {
        throw new Error(
          `Unsupported service type "${definition.type}" for service "${row.service.name}"`
        );
      }
      const allocation = await portManager.ensureServicePorts(
        row.service,
        resolveNamedPortDefinitions(definition)
      );
      row.service.port = getPrimaryPort(row.service.name, allocation);
      ports.set(row.service.name, allocation);
    }

    return ports;
  }

  async function normalizePersistedPidForPortAllocation(
    row: ServiceRow
  ): Promise<void> {
    const persisted = await inspectPersistedServicePid(row);
    if (
      persisted &&
      (persisted.identity === "different" || persisted.identity === "exited")
    ) {
      await clearStalePersistedPid(row);
    }
  }

  async function inspectPersistedServicePid(
    row: ServiceRow
  ): Promise<{ identity: PersistedProcessIdentity; pid: number } | null> {
    const pid = row.service.pid;
    if (!pid) {
      return null;
    }
    return { identity: await resolvePersistedProcessIdentity(row), pid };
  }

  async function clearStalePersistedPid(row: ServiceRow): Promise<void> {
    await repository.updateService(row.service.id, { pid: null });
    row.service.pid = null;
  }

  async function buildPersistedPortMap(
    rows: ServiceRow[]
  ): Promise<CellPortMap> {
    const claims = await repository.fetchPortsForServices(
      rows.map((row) => row.service.id)
    );
    const claimsByService = new Map<string, typeof claims>();
    for (const claim of claims) {
      const existing = claimsByService.get(claim.serviceId) ?? [];
      existing.push(claim);
      claimsByService.set(claim.serviceId, existing);
    }
    const ports: CellPortMap = new Map();

    for (const row of rows) {
      const serviceClaims = claimsByService.get(row.service.id) ?? [];
      const allocation = toPersistedPortAllocation(row.service, serviceClaims);
      if (allocation) {
        ports.set(row.service.name, allocation);
      }
    }

    return ports;
  }

  function releasePortFor(serviceId: string): void {
    portManager.releasePortFor(serviceId);
  }

  function notifyServiceUpdate(row: ServiceRow): void {
    emitServiceUpdate({
      cellId: row.cell.id,
      serviceId: row.service.id,
    });
  }

  async function loadTemplateCached(
    templateId: string,
    workspaceRootPath?: string
  ): Promise<Template | undefined> {
    const key = workspaceRootPath ?? "__default__";
    let workspaceTemplates = templateCache.get(key);
    if (!workspaceTemplates) {
      workspaceTemplates = new Map();
      templateCache.set(key, workspaceTemplates);
    }
    if (!workspaceTemplates.has(templateId)) {
      const config = await loadHiveConfig(workspaceRootPath);
      workspaceTemplates.set(templateId, config.templates[templateId]);
    }
    return workspaceTemplates.get(templateId);
  }

  async function loadTemplateEnvironment(cell: Cell) {
    const template = await loadTemplateCached(
      cell.templateId,
      cell.workspaceRootPath ?? cell.workspacePath
    );
    return template?.env ?? {};
  }

  async function startCellServiceById(serviceId: string): Promise<void> {
    const row = await repository.fetchServiceRowById(serviceId);
    if (!row) {
      throw new Error(`Service ${serviceId} not found`);
    }

    await runWithCellLock(row.cell.id, async () => {
      const cell = await requireStartableCell(row.cell.id);
      const currentRow = await repository.fetchServiceRowById(serviceId);
      if (!currentRow) {
        throw new Error(`Service ${serviceId} not found`);
      }
      const templateEnv = await loadTemplateEnvironment(cell);

      const siblings = await repository.fetchServicesForCell(cell.id);
      const portMap = await buildPortMap(siblings);
      const definitions = serviceDefinitionsForRows(siblings);
      for (const serviceName of getServiceDependencyClosure(
        definitions,
        currentRow.service.name
      )) {
        const dependencyRow = siblings.find(
          (sibling) => sibling.service.name === serviceName
        );
        if (!dependencyRow) {
          throw new Error(`Service "${serviceName}" not found`);
        }
        await startService(dependencyRow, undefined, templateEnv, portMap);
      }
    });
  }

  async function stopCellServiceById(
    serviceId: string,
    options?: { releasePorts?: boolean }
  ): Promise<void> {
    const row = await repository.fetchServiceRowById(serviceId);
    if (!row) {
      return;
    }

    servicesStopping.add(serviceId);
    try {
      await cancelPreLockProcesses([serviceId]);
      await runWithCellLock(row.cell.id, async () => {
        const currentRow = await repository.fetchServiceRowById(serviceId);
        if (!currentRow) {
          return;
        }
        const siblings = await repository.fetchServicesForCell(row.cell.id);
        await stopService(
          currentRow,
          options?.releasePorts ?? false,
          "stopped",
          await buildPersistedPortMap(siblings)
        );
      });
    } finally {
      servicesStopping.delete(serviceId);
    }
  }

  return {
    bootstrap,
    ensureCellServices,
    startCellService: startCellServiceById,
    startCellServices,
    stopCellService: stopCellServiceById,
    stopCellServices,
    runCellTeardown,
    stopAll,
  };

  async function markServiceError(
    serviceId: string,
    cellId: string,
    message: string
  ): Promise<void> {
    await repository.markError(serviceId, message);
    emitServiceUpdate({ cellId, serviceId });
  }

  async function terminateHandle(handle: ProcessHandle): Promise<void> {
    await terminateProcessHandle(handle);
  }

  async function terminatePid(pid: number): Promise<void> {
    const signalProcess = (target: number, signal: NodeJS.Signals) => {
      try {
        process.kill(target, signal);
        return true;
      } catch {
        return false;
      }
    };

    if (!(signalProcess(-pid, "SIGTERM") || signalProcess(pid, "SIGTERM"))) {
      return;
    }

    if (await waitForProcessTreeExit(pid, FORCE_KILL_DELAY_MS)) {
      return;
    }

    if (!signalProcess(-pid, "SIGKILL")) {
      signalProcess(pid, "SIGKILL");
    }
    if (!(await waitForProcessTreeExit(pid, STOP_TIMEOUT_MS))) {
      throw new Error(`Process group ${pid} did not exit after SIGKILL`);
    }
  }

  async function resolvePersistedProcessIdentity(
    row: ServiceRow
  ): Promise<PersistedProcessIdentity> {
    const pid = row.service.pid;
    const instanceId = row.service.env[SERVICE_INSTANCE_ENV_KEY];
    if (!pid) {
      return "exited";
    }

    if (instanceId) {
      const environment = await readProcessEnvironment(pid);
      if (environment) {
        return environment[SERVICE_INSTANCE_ENV_KEY] === instanceId
          ? "owned"
          : "different";
      }
    }

    return isProcessAlive(pid) ? "unverifiable" : "exited";
  }
}

async function waitForProcessTreeExit(
  pid: number,
  timeoutMs: number
): Promise<boolean> {
  return await waitUntilProcessExit(
    () => !(isProcessAlive(pid) || isProcessGroupAlive(pid)),
    timeoutMs
  );
}

function groupServicesByCell(
  rows: ServiceRow[]
): Map<string, { cell: Cell; rows: ServiceRow[] }> {
  const grouped = new Map<string, { cell: Cell; rows: ServiceRow[] }>();

  for (const row of rows) {
    const existing = grouped.get(row.cell.id);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    grouped.set(row.cell.id, { cell: row.cell, rows: [row] });
  }

  return grouped;
}

function preflightTemplateServices(template: Template): string[] {
  const services = template.services ?? {};
  for (const [serviceName, definition] of Object.entries(services)) {
    if (definition.type !== "process") {
      throw new Error(
        `Unsupported service type "${definition.type}" for service "${serviceName}"`
      );
    }
  }

  const processServices = services as Record<string, ProcessService>;
  const issue = collectServiceGraphIssues(processServices)[0];
  if (issue) {
    throw new Error(issue.message);
  }
  return topologicallySortServiceNames(processServices);
}

function serviceDefinitionsForRows(
  rows: ServiceRow[]
): Record<string, ProcessService> {
  const definitions: Record<string, ProcessService> = {};
  for (const row of rows) {
    const definition = row.service.definition;
    if (definition.type !== "process") {
      throw new Error(
        `Unsupported service type "${definition.type}" for service "${row.service.name}"`
      );
    }
    definitions[row.service.name] = definition;
  }
  return definitions;
}

function resolveRestartServiceNames(rows: ServiceRow[]): Set<string> {
  const definitions = serviceDefinitionsForRows(rows);
  const names = new Set<string>();
  for (const row of rows) {
    if (!AUTO_RESTART_STATUSES.has(row.service.status)) {
      continue;
    }
    for (const serviceName of getServiceDependencyClosure(
      definitions,
      row.service.name
    )) {
      names.add(serviceName);
    }
  }
  return names;
}

function sortServiceRows(rows: ServiceRow[], reverse = false): ServiceRow[] {
  const rowsByName = new Map(rows.map((row) => [row.service.name, row]));
  const names = topologicallySortServiceNames(serviceDefinitionsForRows(rows));
  if (reverse) {
    names.reverse();
  }
  return names.map((name) => {
    const row = rowsByName.get(name);
    if (!row) {
      throw new Error(`Service "${name}" not found`);
    }
    return row;
  });
}

function needsDefinitionUpdate(
  record: CellService,
  definition: ProcessService,
  cwd: string
): boolean {
  if (
    record.command !== definition.run ||
    record.cwd !== cwd ||
    (record.readyTimeoutMs ?? null) !== (definition.readyTimeoutMs ?? null)
  ) {
    return true;
  }

  const existingDefinition = JSON.stringify(record.definition);
  const nextDefinition = JSON.stringify(definition);
  return existingDefinition !== nextDefinition;
}

function resolveServiceCwd(workspacePath: string, cwd?: string): string {
  if (!cwd) {
    return workspacePath;
  }

  if (cwd.startsWith("/")) {
    return cwd;
  }

  return resolvePath(workspacePath, cwd);
}

function toPersistedPortAllocation(
  service: CellService,
  claims: CellServicePort[]
): ServicePortAllocation | undefined {
  if (claims.length === 0) {
    return service.port == null
      ? undefined
      : {
          primaryName: DEFAULT_SERVICE_PORT_NAME,
          ports: new Map([[DEFAULT_SERVICE_PORT_NAME, service.port]]),
        };
  }

  const primaryName =
    claims.find((claim) => claim.primary)?.name ?? claims[0]?.name;
  return primaryName
    ? {
        primaryName,
        ports: new Map(
          claims.map((claim) => [claim.name, claim.port] as const)
        ),
      }
    : undefined;
}

function buildBaseEnv({
  serviceName,
  cell,
}: {
  serviceName: string;
  cell: Cell;
}): Record<string, string> {
  const workspacePath = cell.workspacePath;
  if (!workspacePath) {
    throw new Error("Cell workspace path missing");
  }

  return {
    ...ensureCellEnvironment(cell.id, workspacePath),
    HIVE_SERVICE: serviceName,
    FORCE_COLOR: "1",
  };
}

function buildServiceEnv({
  serviceName,
  port,
  templateEnv,
  serviceEnv,
  cell,
  portMap,
}: {
  serviceName: string;
  port: number;
  templateEnv: Record<string, string>;
  serviceEnv: Record<string, string>;
  cell: Cell;
  portMap?: CellPortMap;
}): Record<string, string> {
  const upper = sanitizeServiceEnvironmentName(serviceName);
  const portString = String(port);

  const portLookup = new Map(portMap ?? new Map());

  const baseEnv = {
    ...templateEnv,
    ...serviceEnv,
    ...buildBaseEnv({ serviceName, cell }),
    ...buildSharedPortEnv(portLookup),
    PORT: portString,
    SERVICE_PORT: portString,
    [`${upper}_PORT`]: portString,
    FORCE_COLOR: "1",
  };

  const interpolatedEnv = interpolatePorts(baseEnv, portLookup, serviceName);

  return interpolatedEnv;
}

function buildSharedPortEnv(portLookup: CellPortMap): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [serviceName, allocation] of portLookup) {
    const serviceKey = sanitizeServiceEnvironmentName(serviceName);
    env[`${serviceKey}_PORT`] = String(getPrimaryPort(serviceName, allocation));
    for (const [portName, port] of allocation.ports) {
      env[`${serviceKey}_${sanitizeServiceEnvironmentName(portName)}_PORT`] =
        String(port);
    }
  }
  return env;
}

function getPrimaryPort(
  serviceName: string,
  allocation: ServicePortAllocation
): number {
  const port = allocation.ports.get(allocation.primaryName);
  if (port == null) {
    throw new Error(`Service "${serviceName}" has no primary port allocation`);
  }
  return port;
}

function interpolatePorts(
  env: Record<string, string>,
  portLookup: CellPortMap,
  serviceName: string
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = interpolatePortReferences(value, portLookup, serviceName);
  }

  return result;
}

function interpolatePortReferences(
  value: string,
  portLookup: CellPortMap,
  serviceName: string
): string {
  const tokenRegex =
    /\$(?:\{PORT(?::([A-Za-z0-9_-]+))?(?::([A-Za-z0-9_-]+))?\}|PORT(?::([A-Za-z0-9_-]+))?(?::([A-Za-z0-9_-]+))?)/g;

  return value.replace(
    tokenRegex,
    (match, ...captures: Array<string | undefined>) => {
      const [bracedService, bracedPort, bareService, barePort] = captures;
      const targetService = bracedService ?? bareService ?? serviceName;
      const targetPort = bracedPort ?? barePort;
      const allocation = portLookup.get(targetService);
      if (!allocation) {
        return match;
      }
      const port = allocation.ports.get(targetPort ?? allocation.primaryName);
      return port == null ? match : String(port);
    }
  );
}

export type ServiceSupervisorError = {
  readonly _tag: "ServiceSupervisorError";
  readonly cause: unknown;
};

const makeServiceSupervisorError = (
  cause: unknown
): ServiceSupervisorError => ({
  _tag: "ServiceSupervisorError",
  cause,
});

const wrapSupervisorPromise =
  <Args extends unknown[]>(fn: (...args: Args) => Promise<void>) =>
  async (...args: Args): Promise<void> => {
    try {
      await fn(...args);
    } catch (cause) {
      throw makeServiceSupervisorError(cause);
    }
  };

export type ServiceSupervisorService = {
  readonly bootstrap: () => Promise<void>;
  readonly ensureCellServices: (args: {
    cell: Cell;
    template?: Template;
    onTimingEvent?: (event: EnsureCellServicesTimingEvent) => void;
  }) => Promise<void>;
  readonly startCellService: (serviceId: string) => Promise<void>;
  readonly startCellServices: (cellId: string) => Promise<void>;
  readonly stopCellService: (
    serviceId: string,
    options?: { releasePorts?: boolean }
  ) => Promise<void>;
  readonly stopCellServices: (
    cellId: string,
    options?: { releasePorts?: boolean }
  ) => Promise<void>;
  readonly runCellTeardown: (args: {
    cell: Cell;
    template?: Template;
    reason: TemplateTeardownReason;
  }) => Promise<void>;
  readonly stopAll: () => Promise<void>;
  readonly getServiceTerminalSession: (
    serviceId: string
  ) => ServiceTerminalSession | null;
  readonly readServiceTerminalOutput: (serviceId: string) => string;
  readonly subscribeToServiceTerminal: (
    serviceId: string,
    listener: (event: ServiceTerminalEvent) => void
  ) => () => void;
  readonly resizeServiceTerminal: (
    serviceId: string,
    cols: number,
    rows: number
  ) => void;
  readonly writeServiceTerminalInput: (serviceId: string, data: string) => void;
  readonly clearServiceTerminal: (serviceId: string) => void;
  readonly getSetupTerminalSession: (
    cellId: string
  ) => ServiceTerminalSession | null;
  readonly readSetupTerminalOutput: (cellId: string) => string;
  readonly subscribeToSetupTerminal: (
    cellId: string,
    listener: (event: ServiceTerminalEvent) => void
  ) => () => void;
  readonly resizeSetupTerminal: (
    cellId: string,
    cols: number,
    rows: number
  ) => void;
  readonly writeSetupTerminalInput: (cellId: string, data: string) => void;
  readonly clearSetupTerminal: (cellId: string) => void;
};

const makeServiceSupervisorService = (
  supervisor: ServiceSupervisor,
  terminalRuntime: ServiceTerminalRuntime
): ServiceSupervisorService => ({
  bootstrap: wrapSupervisorPromise(supervisor.bootstrap),
  ensureCellServices: (args) =>
    wrapSupervisorPromise(supervisor.ensureCellServices)(args),
  startCellService: (serviceId) =>
    wrapSupervisorPromise(supervisor.startCellService)(serviceId),
  startCellServices: (cellId) =>
    wrapSupervisorPromise(supervisor.startCellServices)(cellId),
  stopCellService: (serviceId, options) =>
    wrapSupervisorPromise(supervisor.stopCellService)(serviceId, options),
  stopCellServices: (cellId, options) =>
    wrapSupervisorPromise(supervisor.stopCellServices)(cellId, options),
  runCellTeardown: (args) =>
    wrapSupervisorPromise(supervisor.runCellTeardown)(args),
  stopAll: wrapSupervisorPromise(supervisor.stopAll),
  getServiceTerminalSession: terminalRuntime.getServiceSession,
  readServiceTerminalOutput: terminalRuntime.readServiceOutput,
  subscribeToServiceTerminal: terminalRuntime.subscribeToService,
  resizeServiceTerminal: terminalRuntime.resizeService,
  writeServiceTerminalInput: terminalRuntime.writeService,
  clearServiceTerminal: terminalRuntime.clearServiceSession,
  getSetupTerminalSession: terminalRuntime.getSetupSession,
  readSetupTerminalOutput: terminalRuntime.readSetupOutput,
  subscribeToSetupTerminal: terminalRuntime.subscribeToSetup,
  resizeSetupTerminal: terminalRuntime.resizeSetup,
  writeSetupTerminalInput: terminalRuntime.writeSetup,
  clearSetupTerminal: terminalRuntime.clearSetupSession,
});

export const ServiceSupervisorService = makeServiceSupervisorService(
  createServiceSupervisor({ terminalRuntime: serviceTerminalRuntime }),
  serviceTerminalRuntime
);
