import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { constants as osConstants } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { getSyntheticConfig } from "../config/context";
import type { ProcessService, Template } from "../config/schema";
import { db as defaultDb } from "../db";
import type { Construct } from "../schema/constructs";
import { constructs } from "../schema/constructs";
import {
  type ConstructService,
  constructServices,
  type ServiceStatus,
} from "../schema/services";

const AUTO_RESTART_STATUSES: ReadonlySet<ServiceStatus> = new Set([
  "pending",
  "starting",
  "running",
  "needs_resume",
]);

const STOP_TIMEOUT_MS = 2000;
const FORCE_KILL_DELAY_MS = 250;
const DEFAULT_SHELL = process.env.SHELL || "/bin/bash";
const SIGNAL_CODES = osConstants?.signals ?? {};
const SERVICE_LOG_DIR = ".synthetic/logs";

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
  ensureConstructServices(args: {
    construct: Construct;
    template?: Template;
  }): Promise<void>;
  stopConstructServices(
    constructId: string,
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
};

type ServiceLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
};

type ServiceRow = {
  service: ConstructService;
  construct: Construct;
};

type ActiveServiceHandle = {
  handle: ProcessHandle;
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
      throw new Error(`Command "${command}" exited with code ${exitCode}`);
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

  const activeServices = new Map<string, ActiveServiceHandle>();
  const servicePortMap = new Map<string, number>();
  const reservedPorts = new Set<number>();
  const templateCache = new Map<string, Template | undefined>();

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: needs to orchestrate multi-service restart
  async function bootstrap(): Promise<void> {
    const rows = await db
      .select()
      .from(constructServices)
      .innerJoin(constructs, eq(constructs.id, constructServices.constructId));

    const grouped = groupServicesByConstruct(rows.map(mapRow));

    for (const { construct, rows: constructRows } of grouped.values()) {
      const template = await loadTemplateCached(construct.templateId);
      const templateEnv = template?.env ?? {};
      const portMap = await buildPortMap(constructRows);

      for (const row of constructRows) {
        if (!AUTO_RESTART_STATUSES.has(row.service.status)) {
          continue;
        }

        try {
          await startService(row, undefined, templateEnv, portMap);
        } catch (error) {
          logger.error("Failed to restart service", {
            serviceId: row.service.id,
            constructId: row.construct.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: consolidates template validation with creation
  async function ensureConstructServices({
    construct,
    template,
  }: {
    construct: Construct;
    template?: Template;
  }): Promise<void> {
    const resolvedTemplate =
      template ?? (await loadTemplateCached(construct.templateId));

    if (!resolvedTemplate?.services) {
      return;
    }

    const templateEnv = resolvedTemplate.env ?? {};
    const prepared: Array<{ row: ServiceRow; definition: ProcessService }> = [];

    for (const [name, definition] of Object.entries(
      resolvedTemplate.services
    )) {
      if (definition.type !== "process") {
        logger.warn("Unsupported service type. Skipping.", {
          constructId: construct.id,
          service: name,
          type: definition.type,
        });
        continue;
      }

      const row = await ensureService(construct, name, definition);
      prepared.push({ row, definition });
    }

    if (!prepared.length) {
      return;
    }

    const portMap = await buildPortMap(prepared.map((entry) => entry.row));

    for (const { row, definition } of prepared) {
      try {
        await startService(row, definition, templateEnv, portMap);
      } catch (error) {
        logger.error("Failed to start service", {
          serviceId: row.service.id,
          constructId: row.construct.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  }

  async function ensureService(
    construct: Construct,
    name: string,
    definition: ProcessService
  ): Promise<ServiceRow> {
    let record = await findServiceRecord(construct.id, name);
    const resolvedCwd = resolveServiceCwd(
      construct.workspacePath,
      definition.cwd
    );

    if (record) {
      const shouldUpdate = needsDefinitionUpdate(
        record,
        definition,
        resolvedCwd
      );
      if (shouldUpdate) {
        await db
          .update(constructServices)
          .set({
            command: definition.run,
            cwd: resolvedCwd,
            readyTimeoutMs: definition.readyTimeoutMs ?? null,
            definition,
            updatedAt: now(),
          })
          .where(eq(constructServices.id, record.id));

        record = {
          ...record,
          command: definition.run,
          cwd: resolvedCwd,
          readyTimeoutMs: definition.readyTimeoutMs ?? null,
          definition,
        };
      }
    } else {
      record = await createServiceRecord(
        construct,
        name,
        definition,
        resolvedCwd
      );
    }

    rememberPort(record);
    return { service: record, construct };
  }

  async function stopConstructServices(
    constructId: string,
    options?: { releasePorts?: boolean }
  ): Promise<void> {
    const rows = await db
      .select()
      .from(constructServices)
      .innerJoin(constructs, eq(constructs.id, constructServices.constructId))
      .where(eq(constructServices.constructId, constructId));

    for (const row of rows) {
      await stopService(mapRow(row), options?.releasePorts ?? false);
    }
  }

  async function stopAll(): Promise<void> {
    const rows = await db
      .select()
      .from(constructServices)
      .innerJoin(constructs, eq(constructs.id, constructServices.constructId));

    for (const row of rows) {
      await stopService(mapRow(row), true);
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: service startup requires sequencing setup, env, and monitoring
  async function startService(
    row: ServiceRow,
    definitionOverride?: ProcessService,
    templateEnv: Record<string, string> = {},

    portLookup?: Map<string, number>
  ): Promise<void> {
    const definition =
      definitionOverride ?? (row.service.definition as ProcessService | null);

    if (!definition || definition.type !== "process") {
      logger.warn("Cannot start non-process service", {
        serviceId: row.service.id,
        constructId: row.construct.id,
      });
      return;
    }

    if (activeServices.has(row.service.id)) {
      return;
    }

    const port =
      portLookup?.get(row.service.name) ??
      (await ensureServicePort(row.service));
    row.service.port = port;

    const cwd = resolveServiceCwd(row.construct.workspacePath, definition.cwd);

    if (!existsSync(cwd)) {
      await markServiceError(
        row.service.id,
        "Service working directory not found"
      );
      logger.error("Service directory missing", {
        serviceId: row.service.id,
        cwd,
      });
      return;
    }

    const env = buildServiceEnv({
      serviceName: row.service.name,
      port,
      templateEnv,
      serviceEnv: definition.env ?? {},
      construct: row.construct,
      portMap: portLookup,
    });

    const logPath = computeServiceLogPath(
      row.construct.workspacePath,
      row.service.name
    );
    ensureLogFile(logPath);
    const commandWithLogging = wrapCommandWithLogging(definition.run, logPath);

    await db
      .update(constructServices)
      .set({
        status: "starting",
        env,
        port,
        pid: null,
        lastKnownError: null,
        updatedAt: now(),
      })
      .where(eq(constructServices.id, row.service.id));

    try {
      if (definition.setup?.length) {
        for (const setupCommand of definition.setup) {
          await runCommand(setupCommand, { cwd, env });
        }
      }

      const handle = spawnProcess({
        command: commandWithLogging,
        cwd,
        env,
      });

      activeServices.set(row.service.id, { handle });

      await db
        .update(constructServices)
        .set({
          status: "running",
          pid: handle.pid,
          updatedAt: now(),
        })
        .where(eq(constructServices.id, row.service.id));

      handle.exited
        .then(async (code) => {
          activeServices.delete(row.service.id);
          await db
            .update(constructServices)
            .set({
              status: code === 0 ? "stopped" : "error",
              pid: null,
              lastKnownError:
                code === 0 ? null : `Exited with code ${code ?? -1}`,
              updatedAt: now(),
            })
            .where(eq(constructServices.id, row.service.id));
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
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async function stopService(
    row: ServiceRow,
    releasePort: boolean
  ): Promise<void> {
    const definition = row.service.definition as ProcessService | null;
    const env = row.service.env;
    const cwd = resolveServiceCwd(row.construct.workspacePath, definition?.cwd);
    const active = activeServices.get(row.service.id);

    try {
      if (definition?.type === "process" && definition.stop) {
        await runCommand(definition.stop, { cwd, env });
      }
    } catch (error) {
      logger.warn("Service stop command failed", {
        serviceId: row.service.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (active) {
      await terminateHandle(active.handle);
      activeServices.delete(row.service.id);
    } else if (row.service.pid) {
      await terminatePid(row.service.pid);
    }

    await db
      .update(constructServices)
      .set({
        status: "stopped",
        pid: null,
        updatedAt: now(),
      })
      .where(eq(constructServices.id, row.service.id));

    if (releasePort) {
      releasePortFor(row.service.id);
    }
  }

  async function ensureServicePort(service: ConstructService): Promise<number> {
    const existing = service.port ?? servicePortMap.get(service.id);

    if (typeof existing === "number") {
      const available = await ensurePortAvailable(existing, service.pid);
      if (available) {
        rememberSpecificPort(service.id, existing);
        return existing;
      }

      releasePortFor(service.id);
    }

    const port = await findFreePort();
    rememberSpecificPort(service.id, port);

    await db
      .update(constructServices)
      .set({ port, updatedAt: now() })
      .where(eq(constructServices.id, service.id));

    return port;
  }

  async function buildPortMap(
    rows: ServiceRow[]
  ): Promise<Map<string, number>> {
    const ports = new Map<string, number>();

    for (const row of rows) {
      const port = await ensureServicePort(row.service);
      row.service.port = port;
      ports.set(row.service.name, port);
    }

    return ports;
  }

  function rememberPort(service: ConstructService): void {
    if (typeof service.port === "number") {
      rememberSpecificPort(service.id, service.port);
    }
  }

  function rememberSpecificPort(serviceId: string, port: number): void {
    servicePortMap.set(serviceId, port);
    reservedPorts.add(port);
  }

  function releasePortFor(serviceId: string): void {
    const port = servicePortMap.get(serviceId);
    if (typeof port === "number") {
      reservedPorts.delete(port);
      servicePortMap.delete(serviceId);
    }
  }

  async function findServiceRecord(
    constructId: string,
    serviceName: string
  ): Promise<ConstructService | undefined> {
    const [record] = await db
      .select()
      .from(constructServices)
      .where(
        and(
          eq(constructServices.constructId, constructId),
          eq(constructServices.name, serviceName)
        )
      )
      .limit(1);

    return record;
  }

  async function createServiceRecord(
    construct: Construct,
    name: string,
    definition: ProcessService,
    cwd: string
  ): Promise<ConstructService> {
    const timestamp = now();
    const env = buildBaseEnv({ serviceName: name, construct });
    ensureLogFile(computeServiceLogPath(construct.workspacePath, name));

    const [record] = await db
      .insert(constructServices)
      .values({
        id: randomUUID(),
        constructId: construct.id,
        name,
        type: definition.type,
        command: definition.run,
        cwd,
        env,
        status: "pending",
        readyTimeoutMs: definition.readyTimeoutMs ?? null,
        definition,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();

    if (!record) {
      throw new Error("Failed to create service record");
    }

    return record;
  }

  async function loadTemplateCached(
    templateId: string
  ): Promise<Template | undefined> {
    if (!templateCache.has(templateId)) {
      templateCache.set(templateId, await loadTemplate(templateId));
    }
    return templateCache.get(templateId);
  }

  async function loadTemplate(
    templateId: string
  ): Promise<Template | undefined> {
    const config = await getSyntheticConfig();
    return config.templates[templateId];
  }

  async function ensurePortAvailable(
    port: number,
    pid: number | null
  ): Promise<boolean> {
    const available = await isPortFree(port);
    if (available) {
      return true;
    }

    if (pid) {
      await terminatePid(pid);
      return isPortFree(port);
    }

    return false;
  }

  async function findFreePort(): Promise<number> {
    while (true) {
      const candidate = await allocatePort();
      if (!reservedPorts.has(candidate)) {
        return candidate;
      }
    }
  }

  return {
    bootstrap,
    ensureConstructServices,
    stopConstructServices,
    stopAll,
  };

  async function markServiceError(
    serviceId: string,
    message: string
  ): Promise<void> {
    await db
      .update(constructServices)
      .set({
        status: "error",
        pid: null,
        lastKnownError: message,
        updatedAt: now(),
      })
      .where(eq(constructServices.id, serviceId));
  }

  async function terminateHandle(handle: ProcessHandle): Promise<void> {
    try {
      handle.kill("SIGTERM");
    } catch {
      // Process already stopped
    }

    const exit = await Promise.race([
      handle.exited,
      delay(STOP_TIMEOUT_MS).then(() => -1),
    ]);

    if (exit === -1) {
      try {
        handle.kill("SIGKILL");
      } catch {
        // Process already stopped
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
      // Process already stopped
    }
    await delay(FORCE_KILL_DELAY_MS);
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already stopped
    }
  }

  function allocatePort(): Promise<number> {
    return new Promise((resolvePort, rejectPort) => {
      const server = createServer();
      server.once("error", (error) => {
        server.close(() => rejectPort(error));
      });
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === "object") {
          const port = address.port;
          server.close(() => resolvePort(port));
        } else {
          server.close(() => resolvePort(0));
        }
      });
    });
  }

  function mapRow(row: {
    construct_services: ConstructService;
    constructs: Construct;
  }): ServiceRow {
    return {
      service: row.construct_services,
      construct: row.constructs,
    };
  }

  function groupServicesByConstruct(
    rows: ServiceRow[]
  ): Map<string, { construct: Construct; rows: ServiceRow[] }> {
    const grouped = new Map<
      string,
      { construct: Construct; rows: ServiceRow[] }
    >();

    for (const row of rows) {
      const existing = grouped.get(row.construct.id);
      if (existing) {
        existing.rows.push(row);
        continue;
      }
      grouped.set(row.construct.id, { construct: row.construct, rows: [row] });
    }

    return grouped;
  }
}

function needsDefinitionUpdate(
  record: ConstructService,
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
  construct,
}: {
  serviceName: string;
  construct: Construct;
}): Record<string, string> {
  return {
    SYNTHETIC_CONSTRUCT_ID: construct.id,
    SYNTHETIC_SERVICE: serviceName,
  };
}

function buildServiceEnv({
  serviceName,
  port,
  templateEnv,
  serviceEnv,
  construct,
  portMap,
}: {
  serviceName: string;
  port: number;
  templateEnv: Record<string, string>;
  serviceEnv: Record<string, string>;
  construct: Construct;
  portMap?: Map<string, number>;
}): Record<string, string> {
  const upper = sanitizeServiceName(serviceName);
  const portString = String(port);

  const sharedPorts: Record<string, string> = {};
  if (portMap) {
    for (const [name, value] of portMap.entries()) {
      sharedPorts[`${sanitizeServiceName(name)}_PORT`] = String(value);
    }
  }

  return {
    ...buildBaseEnv({ serviceName, construct }),
    ...templateEnv,
    ...serviceEnv,
    ...sharedPorts,
    PORT: portString,
    SERVICE_PORT: portString,
    [`${upper}_PORT`]: portString,
  };
}

function computeServiceLogPath(
  workspacePath: string,
  serviceName: string
): string {
  const safeName = sanitizeServiceName(serviceName).toLowerCase() || "service";
  const logsDir = resolve(workspacePath, SERVICE_LOG_DIR);
  return resolve(logsDir, `${safeName}.log`);
}

function ensureLogFile(logPath: string): void {
  const directory = dirname(logPath);
  mkdirSync(directory, { recursive: true });
  if (!existsSync(logPath)) {
    writeFileSync(logPath, "");
  }
}

function wrapCommandWithLogging(command: string, logPath: string): string {
  const directory = dirname(logPath);
  const quotedDir = JSON.stringify(directory);
  const quotedPath = JSON.stringify(logPath);
  return `set -o pipefail; mkdir -p ${quotedDir} && touch ${quotedPath} && ( ${command} ) 2>&1 | tee -a ${quotedPath}`;
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

const defaultSupervisor = createServiceSupervisor();

export const bootstrapServiceSupervisor = (): Promise<void> =>
  defaultSupervisor.bootstrap();
export const ensureServicesForConstruct = (
  construct: Construct,
  template?: Template
): Promise<void> =>
  defaultSupervisor.ensureConstructServices({ construct, template });
export const stopServicesForConstruct = (
  constructId: string,
  options?: { releasePorts?: boolean }
): Promise<void> =>
  defaultSupervisor.stopConstructServices(constructId, options);
export const stopAllServices = (): Promise<void> => defaultSupervisor.stopAll();
