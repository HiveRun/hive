import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { constants as osConstants } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Context, Effect, Layer } from "effect";

import { HiveConfigService, resolveWorkspaceRoot } from "../config/context";
import { loadConfig } from "../config/loader";
import type { HiveConfig, ProcessService, Template } from "../config/schema";
import { db as defaultDb } from "../db";
import type { Cell } from "../schema/cells";
import type { CellService, ServiceStatus } from "../schema/services";
import { emitServiceUpdate } from "./events";
import { createPortManager } from "./port-manager";
import { createServiceRepository } from "./repository";

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
const DEFAULT_SHELL = process.env.SHELL || "/bin/bash";
const SIGNAL_CODES = osConstants?.signals ?? {};
const SERVICE_LOG_DIR = ".hive/logs";

function runWithCellLock(cellId: string, action: () => Promise<void>) {
  const current = cellServiceLocks.get(cellId) ?? Promise.resolve();
  const next = current.catch(() => null).then(action);
  cellServiceLocks.set(cellId, next);
  next.finally(() => {
    if (cellServiceLocks.get(cellId) === next) {
      cellServiceLocks.delete(cellId);
    }
  });
  return next;
}

function runWithServiceLock(serviceId: string, action: () => Promise<void>) {
  const current = serviceStartLocks.get(serviceId) ?? Promise.resolve();
  const next = current.catch(() => null).then(action);
  serviceStartLocks.set(serviceId, next);
  next.finally(() => {
    if (serviceStartLocks.get(serviceId) === next) {
      serviceStartLocks.delete(serviceId);
    }
  });
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
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => {
      server.close(() => resolvePort(false));
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolvePort(true));
    });
  });
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
};

export type ProcessHandle = {
  pid: number;
  kill: (signal?: number | string) => void;
  exited: Promise<number>;
};

export type SpawnProcess = (options: SpawnProcessOptions) => ProcessHandle;

export type RunCommand = (
  command: string,
  options: { cwd: string; env: Record<string, string> }
) => Promise<void>;

export type ServiceSupervisor = {
  bootstrap(): Promise<void>;
  ensureCellServices(args: { cell: Cell; template?: Template }): Promise<void>;
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
  commandWithLogging: string;
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

const defaultSpawnProcess: SpawnProcess = ({ command, cwd, env }) => {
  const child = Bun.spawn({
    cmd: [DEFAULT_SHELL, "-lc", command],
    cwd,
    env: { ...process.env, ...env },
    stdio: ["inherit", "inherit", "inherit"],
  });

  const kill: ProcessHandle["kill"] = (signal) => {
    const resolved = resolveSignalValue(signal);
    child.kill(resolved);
  };

  return {
    pid: child.pid,
    kill,
    exited: child.exited,
  };
};

const createDefaultRunCommand =
  (spawnProcess: SpawnProcess): RunCommand =>
  async (command, options) => {
    const proc = spawnProcess({
      command,
      cwd: options.cwd,
      env: options.env,
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

  const activeServices = new Map<string, ActiveServiceHandle>();
  const repository = createServiceRepository(db, now);
  const portManager = createPortManager({ db, now });
  const templateCache = new Map<string, Map<string, Template | undefined>>();

  async function bootstrap(): Promise<void> {
    const grouped = groupServicesByCell(await repository.fetchAllServices());

    for (const { cell, rows: cellRows } of grouped.values()) {
      if (cell.status === "archived") {
        continue;
      }

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
  }: {
    cell: Cell;
    template?: Template;
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
      await runTemplateSetupCommands(cell, resolvedTemplate, templateEnv);

      if (!resolvedTemplate.services) {
        return;
      }

      const prepared = await prepareProcessServices(cell, resolvedTemplate);
      if (!prepared.length) {
        return;
      }

      const portMap = await buildPortMap(prepared.map((entry) => entry.row));

      for (const { row, definition } of prepared) {
        await startOrFail(row, definition, templateEnv, portMap);
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

  async function startOrFail(
    row: ServiceRow,
    definition: ProcessService,
    templateEnv: Record<string, string>,
    portMap: Map<string, number>
  ) {
    try {
      await startService(row, definition, templateEnv, portMap);
    } catch (error) {
      logger.error("Failed to start service", {
        serviceId: row.service.id,
        cellId: row.cell.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async function runTemplateSetupCommands(
    cell: Cell,
    template: Template,
    templateEnv: Record<string, string>
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
    };

    const logPath = computeSetupLogPath(cell.workspacePath);
    ensureLogFile(logPath);
    logSetupEvent(
      logPath,
      `Starting template setup for ${template.id} (${template.setup.length} command${
        template.setup.length === 1 ? "" : "s"
      })`
    );

    const executeCommand = async (command: string) => {
      logSetupEvent(logPath, `Running: ${command}`);
      const commandWithLogging = wrapCommandWithLogging(command, logPath);

      try {
        await runCommand(commandWithLogging, {
          cwd: cell.workspacePath,
          env,
        });
        logSetupEvent(logPath, `Completed: ${command}`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");
        logSetupEvent(logPath, `Failed: ${command} (${message})`);
        throw new TemplateSetupError({
          command,
          templateId: template.id,
          workspacePath: cell.workspacePath,
          cause: error,
        });
      }
    };

    for (const command of template.setup) {
      await executeCommand(command);
    }

    logSetupEvent(logPath, `Template setup finished for ${template.id}`);
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

      ensureLogFile(computeServiceLogPath(cell.workspacePath, name));
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
      await stopService(row, true);
    }
  }

  async function shouldSkipStartService(row: ServiceRow): Promise<boolean> {
    if (row.service.pid && isProcessAlive(row.service.pid)) {
      return true;
    }

    if (typeof row.service.port === "number") {
      const portFree = await isPortFree(row.service.port);
      if (!portFree) {
        return true;
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

      const commandWithLogging = prepareLoggingCommand(
        serviceRow,
        definition.run
      );

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
        commandWithLogging,
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

  function prepareLoggingCommand(row: ServiceRow, command: string) {
    const logPath = computeServiceLogPath(
      row.cell.workspacePath,
      row.service.name
    );
    ensureLogFile(logPath);
    return wrapCommandWithLogging(command, logPath);
  }

  async function runServiceProcess({
    row,
    definition,
    env,
    cwd,
    commandWithLogging,
  }: ServiceProcessOptions) {
    try {
      await runServiceSetup(definition, cwd, env);

      const handle = spawnProcess({
        command: commandWithLogging,
        cwd,
        env,
      });

      activeServices.set(row.service.id, { handle });

      await repository.updateService(row.service.id, {
        status: "running",
        pid: handle.pid,
      });

      notifyServiceUpdate(row);

      handle.exited
        .then(async (code) => {
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
          activeServices.delete(row.service.id);
          logger.error("Service exited with error", {
            serviceId: row.service.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    } catch (error) {
      activeServices.delete(row.service.id);
      await markServiceError(
        row.service.id,
        row.cell.id,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async function runServiceSetup(
    definition: ProcessService,
    cwd: string,
    env: Record<string, string>
  ) {
    if (!definition.setup?.length) {
      return;
    }

    for (const setupCommand of definition.setup) {
      await runCommand(setupCommand, { cwd, env });
    }
  }

  async function stopService(
    row: ServiceRow,
    releasePort: boolean
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
      status: "stopped",
      pid: null,
    });

    notifyServiceUpdate(row);

    if (releasePort) {
      releasePortFor(row.service.id);
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
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
    await delay(FORCE_KILL_DELAY_MS);
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
    } catch {
      /* ignore forced termination errors */
    }
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

function computeServiceLogPath(
  workspacePath: string,
  serviceName: string
): string {
  const safeName = sanitizeServiceName(serviceName).toLowerCase() || "service";
  const logsDir = resolve(workspacePath, SERVICE_LOG_DIR);
  return resolve(logsDir, `${safeName}.log`);
}

function computeSetupLogPath(workspacePath: string): string {
  const logsDir = resolve(workspacePath, SERVICE_LOG_DIR);
  return resolve(logsDir, "setup.log");
}

function ensureLogFile(logPath: string): void {
  const directory = dirname(logPath);
  mkdirSync(directory, { recursive: true });
  if (!existsSync(logPath)) {
    writeFileSync(logPath, "");
  }
}

function logSetupEvent(logPath: string, message: string): void {
  const timestamp = new Date().toISOString();
  appendFileSync(logPath, `[${timestamp}] ${message}\n`);
}

function wrapCommandWithLogging(command: string, logPath: string): string {
  const directory = dirname(logPath);
  const quotedDir = JSON.stringify(directory);
  const quotedPath = JSON.stringify(logPath);
  return `set -o pipefail; mkdir -p ${quotedDir} && touch ${quotedPath} && ( ${command} ) 2>&1 | tee -a ${quotedPath}`;
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
  (...args: Args): Effect.Effect<void, ServiceSupervisorError> =>
    Effect.tryPromise({
      try: () => fn(...args),
      catch: (cause) => makeServiceSupervisorError(cause),
    });

export type ServiceSupervisorService = {
  readonly bootstrap: Effect.Effect<void, ServiceSupervisorError>;
  readonly ensureCellServices: (args: {
    cell: Cell;
    template?: Template;
  }) => Effect.Effect<void, ServiceSupervisorError>;
  readonly startCellService: (
    serviceId: string
  ) => Effect.Effect<void, ServiceSupervisorError>;
  readonly startCellServices: (
    cellId: string
  ) => Effect.Effect<void, ServiceSupervisorError>;
  readonly stopCellService: (
    serviceId: string,
    options?: { releasePorts?: boolean }
  ) => Effect.Effect<void, ServiceSupervisorError>;
  readonly stopCellServices: (
    cellId: string,
    options?: { releasePorts?: boolean }
  ) => Effect.Effect<void, ServiceSupervisorError>;
  readonly stopAll: Effect.Effect<void, ServiceSupervisorError>;
};

const makeEffectSupervisor = (
  supervisor: ServiceSupervisor
): ServiceSupervisorService => ({
  bootstrap: wrapSupervisorPromise(supervisor.bootstrap)(),
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
  stopAll: wrapSupervisorPromise(supervisor.stopAll)(),
});

export const ServiceSupervisorService =
  Context.GenericTag<ServiceSupervisorService>(
    "@hive/server/ServiceSupervisorService"
  );

export const ServiceSupervisorLayer = Layer.effect(
  ServiceSupervisorService,
  Effect.gen(function* () {
    const hiveConfigService = yield* HiveConfigService;
    const supervisor = createServiceSupervisor({
      loadHiveConfig: (workspaceRoot?: string) =>
        Effect.runPromise(hiveConfigService.load(workspaceRoot)),
    });
    return makeEffectSupervisor(supervisor);
  })
);
