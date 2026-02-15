import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { constants as osConstants } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { type IExitEvent, spawn as spawnPty } from "bun-pty";

import { resolveWorkspaceRoot } from "../config/context";
import { loadConfig } from "../config/loader";
import type { HiveConfig, ProcessService, Template } from "../config/schema";
import { db as defaultDb } from "../db";
import type { Cell } from "../schema/cells";
import type { CellService, ServiceStatus } from "../schema/services";
import { emitServiceUpdate } from "./events";
import { createPortManager } from "./port-manager";
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
const DEFAULT_TEMPLATE_SETUP_COMMAND_TIMEOUT_MS = 300_000;
const DEFAULT_SHELL = process.env.SHELL || "/bin/bash";
const TERMINAL_NAME = "xterm-256color";
const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 36;
const SIGNAL_CODES = osConstants?.signals ?? {};

function resolveTemplateSetupCommandTimeoutMs(): number {
  const raw = process.env.HIVE_TEMPLATE_SETUP_COMMAND_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_TEMPLATE_SETUP_COMMAND_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TEMPLATE_SETUP_COMMAND_TIMEOUT_MS;
  }

  return parsed;
}

function runWithCellLock(cellId: string, action: () => Promise<void>) {
  const current = cellServiceLocks.get(cellId) ?? Promise.resolve();
  const next = current.catch(() => null).then(action);
  cellServiceLocks.set(cellId, next);
  next.then(
    () => {
      if (cellServiceLocks.get(cellId) === next) {
        cellServiceLocks.delete(cellId);
      }
    },
    () => {
      if (cellServiceLocks.get(cellId) === next) {
        cellServiceLocks.delete(cellId);
      }
    }
  );
  return next;
}

function runWithServiceLock(serviceId: string, action: () => Promise<void>) {
  const current = serviceStartLocks.get(serviceId) ?? Promise.resolve();
  const next = current.catch(() => null).then(action);
  serviceStartLocks.set(serviceId, next);
  next.then(
    () => {
      if (serviceStartLocks.get(serviceId) === next) {
        serviceStartLocks.delete(serviceId);
      }
    },
    () => {
      if (serviceStartLocks.get(serviceId) === next) {
        serviceStartLocks.delete(serviceId);
      }
    }
  );
  return next;
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
  } catch {
    return false;
  }
}

function isPortFree(port: number): Promise<boolean> {
  const supportsIpv6 = (code: string | undefined) =>
    code !== "EADDRNOTAVAIL" &&
    code !== "EAFNOSUPPORT" &&
    code !== "EPROTONOSUPPORT";

  const probeHost = (host: string): Promise<boolean> =>
    new Promise((resolvePort) => {
      const server = createServer();
      server.once("error", (error) => {
        const code = (error as NodeJS.ErrnoException).code;
        if (host === "::1" && !supportsIpv6(code)) {
          // IPv6 loopback isn't available on this host; don't block allocation.
          server.close(() => resolvePort(true));
          return;
        }
        server.close(() => resolvePort(false));
      });
      server.listen(port, host, () => {
        server.close(() => resolvePort(true));
      });
    });

  // Ensure the port isn't already claimed on either loopback family.
  return Promise.all([probeHost("127.0.0.1"), probeHost("::1")]).then(
    (results) => results.every(Boolean)
  );
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
  resize?: (cols: number, rows: number) => void;
  write?: (data: string) => void;
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
  }
) => Promise<void>;

export type EnsureCellServicesTimingEvent = {
  step: string;
  status: "ok" | "error";
  durationMs: number;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type ServiceSupervisor = {
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
  stopAll(): Promise<void>;
};

export type SupervisorDependencies = {
  db: typeof defaultDb;
  spawnProcess: SpawnProcess;
  runCommand: RunCommand;
  now: () => Date;
  logger: ServiceLogger;
  loadHiveConfig: (workspaceRoot?: string) => Promise<HiveConfig>;
  terminalRuntime: ServiceTerminalRuntime;
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
};

type ServiceProcessOptions = {
  row: ServiceRow;
  definition: ProcessService;
  env: Record<string, string>;
  cwd: string;
  command: string;
};

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

    const exitCode = await proc.exited;
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

  const activeServices = new Map<string, ActiveServiceHandle>();
  const repository = createServiceRepository(db, now);
  const portManager = createPortManager({ db, now });
  const templateCache = new Map<string, Map<string, Template | undefined>>();

  async function bootstrap(): Promise<void> {
    const grouped = groupServicesByCell(await repository.fetchAllServices());

    for (const { cell, rows: cellRows } of grouped.values()) {
      const template = await loadTemplateCached(
        cell.templateId,
        cell.workspaceRootPath ?? cell.workspacePath
      );
      const templateEnv = template?.env ?? {};
      const portMap = await buildPortMap(cellRows);

      await restartServicesForCell({
        rows: cellRows,
        portMap,
        templateEnv,
      });
    }
  }

  async function shouldSkipRestart(row: ServiceRow): Promise<boolean> {
    if (!AUTO_RESTART_STATUSES.has(row.service.status)) {
      return true;
    }

    if (row.service.pid && isProcessAlive(row.service.pid)) {
      return true;
    }

    if (!row.service.pid && typeof row.service.port === "number") {
      const portFree = await isPortFree(row.service.port);
      if (!portFree) {
        logger.warn("Skipping service restart because port is already in use", {
          serviceId: row.service.id,
          cellId: row.cell.id,
          port: row.service.port,
        });
        return true;
      }
    }

    return false;
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
    portMap: Map<string, number>;
    templateEnv: Record<string, string>;
  }) {
    const { rows, portMap, templateEnv } = args;

    for (const row of rows) {
      if (await shouldSkipRestart(row)) {
        continue;
      }

      await normalizeServiceForRestart(row);

      await startService(row, undefined, templateEnv, portMap).catch(
        (error) => {
          logger.error("Failed to restart service", {
            serviceId: row.service.id,
            cellId: row.cell.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      );
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
      const resolvedTemplate =
        template ??
        (await loadTemplateCached(
          cell.templateId,
          cell.workspaceRootPath ?? cell.workspacePath
        ));

      if (!resolvedTemplate) {
        return;
      }

      const templateEnv = resolvedTemplate.env ?? {};
      await runTemplateSetupCommands(
        cell,
        resolvedTemplate,
        templateEnv,
        onTimingEvent
      );

      if (!resolvedTemplate.services) {
        return;
      }

      const prepared = await prepareProcessServices(cell, resolvedTemplate);
      if (!prepared.length) {
        return;
      }

      const portMap = await buildPortMap(prepared.map((entry) => entry.row));

      for (const { row, definition } of prepared) {
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

  async function prepareProcessServices(
    cell: Cell,
    template: Template
  ): Promise<Array<{ row: ServiceRow; definition: ProcessService }>> {
    const prepared: Array<{ row: ServiceRow; definition: ProcessService }> = [];

    for (const [name, definition] of Object.entries(template.services ?? {})) {
      if (definition.type !== "process") {
        logger.warn("Unsupported service type. Skipping.", {
          cellId: cell.id,
          service: name,
          type: definition.type,
        });
        continue;
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
    portMap: Map<string, number>;
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
  async function runTemplateSetupCommands(
    cell: Cell,
    template: Template,
    templateEnv: Record<string, string>,
    onTimingEvent?: (event: EnsureCellServicesTimingEvent) => void
  ): Promise<void> {
    if (!template.setup?.length) {
      return;
    }

    if (!cell.workspacePath) {
      throw new Error("Cell workspace path missing");
    }

    const env = {
      ...buildBaseEnv({ serviceName: template.id, cell }),
      ...templateEnv,
      HIVE_WORKTREE_SETUP: "true",
      HIVE_MAIN_REPO: cell.workspaceRootPath ?? cell.workspacePath,
      FORCE_COLOR: "1",
    };

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
      for (const command of template.setup) {
        const commandStartedAt = Date.now();
        terminalRuntime.appendSetupLine(cell.id, `[setup] Running: ${command}`);
        const proc = spawnProcess({
          command,
          cwd: cell.workspacePath,
          env,
          onData: (chunk) => terminalRuntime.appendSetupOutput(cell.id, chunk),
        });

        terminalRuntime.attachSetupProcess({
          cellId: cell.id,
          process: {
            pid: proc.pid,
            kill: proc.kill,
            resize: proc.resize,
            write: proc.write,
          },
        });

        const exitResult = await Promise.race([
          proc.exited.then((code) => ({
            type: "exit" as const,
            exitCode: code,
          })),
          delay(timeoutMs).then(() => ({ type: "timeout" as const })),
        ]);

        if (exitResult.type === "timeout") {
          const durationMs = Date.now() - commandStartedAt;
          proc.kill("SIGTERM");
          const exitedAfterTerm = await Promise.race([
            proc.exited.then(() => true),
            delay(STOP_TIMEOUT_MS).then(() => false),
          ]);
          if (!exitedAfterTerm) {
            proc.kill("SIGKILL");
          }

          terminalRuntime.appendSetupLine(
            cell.id,
            `[setup] Timed out: ${command} after ${timeoutMs}ms`
          );
          terminalRuntime.markSetupExit({
            cellId: cell.id,
            exitCode: 124,
            signal: null,
          });
          onTimingEvent?.({
            step: `template_setup:${command}`,
            status: "error",
            durationMs,
            error: `Template setup command timed out after ${timeoutMs}ms`,
            metadata: {
              command,
              timeoutMs,
              templateId: template.id,
            },
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

        const exitCode = exitResult.exitCode;
        if (exitCode !== 0) {
          const durationMs = Date.now() - commandStartedAt;
          terminalRuntime.appendSetupLine(
            cell.id,
            `[setup] Failed: ${command} (exit ${exitCode})`
          );
          terminalRuntime.markSetupExit({
            cellId: cell.id,
            exitCode,
            signal: null,
          });
          onTimingEvent?.({
            step: `template_setup:${command}`,
            status: "error",
            durationMs,
            error: `Template setup command failed with exit code ${exitCode}`,
            metadata: {
              command,
              exitCode,
              templateId: template.id,
            },
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

    rememberPort(record);
    return { service: record, cell };
  }

  async function startCellServices(cellId: string): Promise<void> {
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

    for (const row of rows) {
      await startService(row, undefined, templateEnv, portMap);
    }
  }

  async function stopCellServices(
    cellId: string,
    options?: { releasePorts?: boolean }
  ): Promise<void> {
    const rows = await repository.fetchServicesForCell(cellId);

    for (const row of rows) {
      await stopService(row, options?.releasePorts ?? false);
    }
  }

  async function stopAll(): Promise<void> {
    const rows = await repository.fetchAllServices();

    for (const row of rows) {
      const statusAfterStop =
        row.service.status === "stopped" ? "stopped" : "needs_resume";
      await stopService(row, true, statusAfterStop);
    }

    terminalRuntime.stopAll();
  }

  async function shouldSkipStartService(row: ServiceRow): Promise<boolean> {
    if (row.service.pid && isProcessAlive(row.service.pid)) {
      return true;
    }

    if (typeof row.service.port === "number") {
      const portFree = await isPortFree(row.service.port);
      if (!portFree) {
        const status = row.service.status;
        if (
          status === "running" ||
          status === "starting" ||
          status === "needs_resume"
        ) {
          return true;
        }
      }
    }

    if (activeServices.has(row.service.id)) {
      return true;
    }

    return false;
  }

  async function startService(
    row: ServiceRow,
    definitionOverride?: ProcessService,
    templateEnv: Record<string, string> = {},
    portLookup?: Map<string, number>
  ): Promise<void> {
    await runWithServiceLock(row.service.id, async () => {
      const latestRow = await repository.fetchServiceRowById(row.service.id);
      const serviceRow = latestRow ?? row;
      const definition =
        definitionOverride ??
        (serviceRow.service.definition as ProcessService | null);

      if (!definition || definition.type !== "process") {
        logger.warn("Cannot start non-process service", {
          serviceId: serviceRow.service.id,
          cellId: serviceRow.cell.id,
        });
        return;
      }

      if (await shouldSkipStartService(serviceRow)) {
        return;
      }

      const port = await prepareServicePort(serviceRow, portLookup);
      const cwd = resolveServiceCwd(
        serviceRow.cell.workspacePath,
        definition.cwd
      );

      if (!(await ensureServiceDirectory(serviceRow, cwd))) {
        return;
      }

      const env = buildServiceEnv({
        serviceName: serviceRow.service.name,
        port,
        templateEnv,
        serviceEnv: definition.env ?? {},
        cell: serviceRow.cell,
        portMap: portLookup,
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
        command: definition.run,
      });
    });
  }

  async function prepareServicePort(
    row: ServiceRow,
    portLookup?: Map<string, number>
  ) {
    const port =
      portLookup?.get(row.service.name) ??
      (await portManager.ensureServicePort(row.service));
    row.service.port = port;
    return port;
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
  }: ServiceProcessOptions) {
    try {
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

      await runServiceSetup(row, definition, cwd, env);

      const handle = spawnProcess({
        command,
        cwd,
        env,
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

      await repository.updateService(row.service.id, {
        status: "running",
        pid: handle.pid,
      });

      notifyServiceUpdate(row);

      handle.exited
        .then(async (code) => {
          const active = activeServices.get(row.service.id);
          if (!active || active.handle !== handle) {
            return;
          }

          activeServices.delete(row.service.id);
          await repository.updateService(row.service.id, {
            status: code === 0 ? "stopped" : "error",
            pid: null,
            lastKnownError:
              code === 0 ? null : `Exited with code ${code ?? -1}`,
          });

          notifyServiceUpdate(row);
        })
        .catch((error) => {
          const active = activeServices.get(row.service.id);
          if (!active || active.handle !== handle) {
            return;
          }

          activeServices.delete(row.service.id);
          logger.error("Service exited with error", {
            serviceId: row.service.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    } catch (error) {
      activeServices.delete(row.service.id);
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

  async function runServiceSetup(
    row: ServiceRow,
    definition: ProcessService,
    cwd: string,
    env: Record<string, string>
  ) {
    if (!definition.setup?.length) {
      return;
    }

    for (const setupCommand of definition.setup) {
      const startedAt = Date.now();
      terminalRuntime.appendServiceOutput(
        row.service.id,
        `[service:${row.service.name}] setup: ${setupCommand}\n`
      );
      await runCommand(setupCommand, {
        cwd,
        env,
        onData: (chunk) =>
          terminalRuntime.appendServiceOutput(row.service.id, chunk),
      });
      logger.info("Service setup command completed", {
        serviceId: row.service.id,
        serviceName: row.service.name,
        cellId: row.cell.id,
        command: setupCommand,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  async function stopService(
    row: ServiceRow,
    releasePort: boolean,
    statusAfterStop: ServiceStatus = "stopped"
  ): Promise<void> {
    const definition = row.service.definition as ProcessService | null;
    const env = row.service.env;
    const cwd = resolveServiceCwd(row.cell.workspacePath, definition?.cwd);
    const active = activeServices.get(row.service.id);

    if (definition?.type === "process" && definition.stop) {
      await runCommand(definition.stop, { cwd, env }).catch((error) => {
        logger.warn("Service stop command failed", {
          serviceId: row.service.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    if (active) {
      await terminateHandle(active.handle);
      activeServices.delete(row.service.id);
    } else if (row.service.pid) {
      await terminatePid(row.service.pid);
    }

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
  }

  async function buildPortMap(
    rows: ServiceRow[]
  ): Promise<Map<string, number>> {
    const ports = new Map<string, number>();

    for (const row of rows) {
      const port = await portManager.ensureServicePort(row.service);
      row.service.port = port;
      ports.set(row.service.name, port);
    }

    return ports;
  }

  function rememberPort(service: CellService): void {
    if (typeof service.port === "number") {
      portManager.rememberSpecificPort(service.id, service.port);
    }
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

  async function startCellServiceById(serviceId: string): Promise<void> {
    const row = await repository.fetchServiceRowById(serviceId);
    if (!row) {
      throw new Error(`Service ${serviceId} not found`);
    }

    const template = await loadTemplateCached(
      row.cell.templateId,
      row.cell.workspaceRootPath ?? row.cell.workspacePath
    );
    const templateEnv = template?.env ?? {};

    const siblings = await repository.fetchServicesForCell(row.cell.id);
    const portMap = await buildPortMap(siblings);

    await startService(row, undefined, templateEnv, portMap);
  }

  async function stopCellServiceById(
    serviceId: string,
    options?: { releasePorts?: boolean }
  ): Promise<void> {
    const row = await repository.fetchServiceRowById(serviceId);
    if (!row) {
      return;
    }

    await stopService(row, options?.releasePorts ?? false);
  }

  return {
    bootstrap,
    ensureCellServices,
    startCellService: startCellServiceById,
    startCellServices,
    stopCellService: stopCellServiceById,
    stopCellServices,
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
    try {
      handle.kill("SIGTERM");
    } catch {
      /* ignore initial termination errors */
    }

    const exit = await Promise.race([
      handle.exited,
      delay(STOP_TIMEOUT_MS).then(() => -1),
    ]);

    if (exit === -1) {
      try {
        handle.kill("SIGKILL");
      } catch {
        /* ignore forced termination errors */
      }
      await handle.exited.catch(() => {
        /* swallow errors when waiting for exit */
      });
    }
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

    await delay(FORCE_KILL_DELAY_MS);

    if (!isProcessAlive(pid)) {
      return;
    }

    signalProcess(-pid, "SIGKILL");
    signalProcess(pid, "SIGKILL");
  }
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

  return resolve(workspacePath, cwd);
}

function sanitizeServiceName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
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

  const hiveHome = resolve(workspacePath, ".hive", "home");
  mkdirSync(hiveHome, { recursive: true });

  return {
    HIVE_CELL_ID: cell.id,
    HIVE_SERVICE: serviceName,
    HIVE_HOME: hiveHome,
    HIVE_BROWSE_ROOT: workspacePath,
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
  portMap?: Map<string, number>;
}): Record<string, string> {
  const upper = sanitizeServiceName(serviceName);
  const portString = String(port);

  const portLookup = new Map(portMap ?? new Map());
  portLookup.set(serviceName, port);

  const sharedPorts: Record<string, string> = {};
  if (portLookup.size > 0) {
    for (const [name, value] of portLookup.entries()) {
      sharedPorts[`${sanitizeServiceName(name)}_PORT`] = String(value);
    }
  }

  const baseEnv = {
    ...buildBaseEnv({ serviceName, cell }),
    ...templateEnv,
    ...serviceEnv,
    ...sharedPorts,
    PORT: portString,
    SERVICE_PORT: portString,
    [`${upper}_PORT`]: portString,
    FORCE_COLOR: "1",
  };

  const interpolatedEnv = interpolatePorts(baseEnv, portLookup, serviceName);

  return interpolatedEnv;
}

function interpolatePorts(
  env: Record<string, string>,
  portLookup: Map<string, number>,
  serviceName: string
): Record<string, string> {
  const tokenRegex = /\$(?:\{?PORT(?::([A-Za-z0-9_-]+))?\}?)/g;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      result[key] = value;
      continue;
    }
    const replaced = value.replace(tokenRegex, (_match, target?: string) => {
      const targetName = target ?? serviceName;
      const portValue = portLookup.get(targetName) ?? null;
      return portValue != null ? String(portValue) : _match;
    });
    result[key] = replaced;
  }

  return result;
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

export const serviceSupervisor = ServiceSupervisorService;
