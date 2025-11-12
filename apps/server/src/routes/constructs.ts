import { promises as fs } from "node:fs";
import { createConnection } from "node:net";
import { resolve as resolvePath } from "node:path";
import { logger } from "@bogeychan/elysia-logger";
import { and, eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { closeAgentSession, ensureAgentSession } from "../agents/service";
import { getSyntheticConfig } from "../config/context";
import { db } from "../db";

import {
  ConstructListResponseSchema,
  ConstructResponseSchema,
  ConstructServiceListResponseSchema,
  ConstructServiceSchema,
  CreateConstructSchema,
  DeleteConstructsSchema,
} from "../schema/api";
import {
  type ConstructStatus,
  constructs,
  type NewConstruct,
} from "../schema/constructs";
import { constructServices } from "../schema/services";
import {
  CommandExecutionError,
  ensureServicesForConstruct,
  isProcessAlive,
  startServiceById,
  stopServiceById,
  stopServicesForConstruct,
  TemplateSetupError,
} from "../services/supervisor";
import { createWorktreeManager } from "../worktree/manager";

export type ConstructRouteDependencies = {
  db: typeof db;
  getSyntheticConfig: typeof getSyntheticConfig;
  ensureAgentSession: typeof ensureAgentSession;
  closeAgentSession: typeof closeAgentSession;
  createWorktreeManager: typeof createWorktreeManager;
  ensureServicesForConstruct: typeof ensureServicesForConstruct;
  startServiceById: typeof startServiceById;
  stopServiceById: typeof stopServiceById;
  stopServicesForConstruct: typeof stopServicesForConstruct;
};

const defaultConstructRouteDependencies: ConstructRouteDependencies = {
  db,
  getSyntheticConfig,
  ensureAgentSession,
  closeAgentSession,
  createWorktreeManager,
  ensureServicesForConstruct,
  startServiceById,
  stopServiceById,
  stopServicesForConstruct,
};

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
} as const;

const ErrorResponseSchema = t.Object({
  message: t.String(),
  details: t.Optional(t.String()),
});

const LOG_TAIL_MAX_BYTES = 64_000;
const LOG_TAIL_MAX_LINES = 200;
const LOG_LINE_SPLIT_RE = /\r?\n/;
const SERVICE_LOG_DIR = ".synthetic/logs";
const PORT_CHECK_TIMEOUT_MS = 500;

const LOGGER_CONFIG = {
  level: process.env.LOG_LEVEL || "info",
  autoLogging: false,
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty" as const }
      : undefined,
} as const;

function isPortActive(port?: number | null): Promise<boolean> {
  if (!port) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port })
      .once("connect", () => {
        socket.end();
        resolve(true);
      })
      .once("error", () => {
        resolve(false);
      })
      .once("timeout", () => {
        socket.destroy();
        resolve(false);
      });

    socket.setTimeout(PORT_CHECK_TIMEOUT_MS);
  });
}

function constructToResponse(construct: typeof constructs.$inferSelect) {
  return {
    id: construct.id,
    name: construct.name,
    description: construct.description,
    templateId: construct.templateId,
    workspacePath: construct.workspacePath,
    opencodeSessionId: construct.opencodeSessionId,
    opencodeServerUrl: construct.opencodeServerUrl,
    opencodeServerPort: construct.opencodeServerPort,
    createdAt: construct.createdAt.toISOString(),
    status: construct.status,
    lastSetupError: construct.lastSetupError ?? undefined,
  };
}

export function createConstructsRoutes(
  overrides: Partial<ConstructRouteDependencies> = {}
) {
  const deps = { ...defaultConstructRouteDependencies, ...overrides };
  const {
    db: database,
    getSyntheticConfig: loadSyntheticConfig,
    ensureAgentSession: ensureSession,
    closeAgentSession: closeSession,
    createWorktreeManager: buildWorktreeManager,
    ensureServicesForConstruct: ensureServices,
    startServiceById: startService,
    stopServiceById: stopService,
    stopServicesForConstruct: stopConstructServicesFn,
  } = deps;

  return new Elysia({ prefix: "/api/constructs" })
    .use(logger(LOGGER_CONFIG))
    .get(
      "/",
      async () => {
        const allConstructs = await database.select().from(constructs);
        return { constructs: allConstructs.map(constructToResponse) };
      },
      {
        response: {
          200: ConstructListResponseSchema,
        },
      }
    )
    .get(
      "/:id",
      async ({ params, set }) => {
        const result = await database
          .select()
          .from(constructs)
          .where(eq(constructs.id, params.id))
          .limit(1);

        if (result.length === 0) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Construct not found" };
        }

        const [construct] = result;
        if (!construct) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to load construct" };
        }

        return constructToResponse(construct);
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        response: {
          200: ConstructResponseSchema,
          404: t.Object({
            message: t.String(),
          }),
        },
      }
    )
    .get(
      "/:id/services",
      async ({ params, set }) => {
        const construct = await loadConstructById(database, params.id);
        if (!construct) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Construct not found" };
        }

        const rows = await fetchServiceRows(database, params.id);
        const services = await Promise.all(
          rows.map((row) => serializeService(database, row))
        );

        return { services };
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: ConstructServiceListResponseSchema,
          404: t.Object({ message: t.String() }),
        },
      }
    )
    .post(
      "/:id/services/:serviceId/start",
      async ({ params, set }) => {
        const row = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!row) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" };
        }

        await startService(params.serviceId);
        const updated = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!updated) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" };
        }

        return serializeService(database, updated);
      },
      {
        params: t.Object({ id: t.String(), serviceId: t.String() }),
        response: {
          200: ConstructServiceSchema,
          404: t.Object({ message: t.String() }),
        },
      }
    )
    .post(
      "/:id/services/:serviceId/stop",
      async ({ params, set }) => {
        const row = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!row) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" };
        }

        await stopService(params.serviceId);
        const updated = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!updated) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" };
        }

        return serializeService(database, updated);
      },
      {
        params: t.Object({ id: t.String(), serviceId: t.String() }),
        response: {
          200: ConstructServiceSchema,
          404: t.Object({ message: t.String() }),
        },
      }
    )
    .post(
      "/",
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: provisioning flow requires coordinated cleanup and recovery branches
      async ({ body, set, log }) => {
        const syntheticConfig = await loadSyntheticConfig();
        const template = syntheticConfig.templates[body.templateId];
        if (!template) {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return { message: "Template not found" };
        }

        const worktreeService = buildWorktreeManager(
          process.cwd(),
          syntheticConfig
        );
        const now = new Date();
        const constructId = crypto.randomUUID();
        let worktreeCreated = false;
        let recordCreated = false;
        let servicesStarted = false;
        let createdConstruct: typeof constructs.$inferSelect | null = null;

        const stopServicesIfNeeded = async () => {
          if (!servicesStarted) {
            return;
          }

          try {
            await stopConstructServicesFn(constructId, {
              releasePorts: true,
            });
          } catch (cleanupError) {
            log.warn(
              { cleanupError },
              "Failed to stop services during construct creation cleanup"
            );
          }
        };

        const removeWorktreeIfNeeded = () => {
          if (!worktreeCreated) {
            return;
          }

          try {
            worktreeService.removeWorktree(constructId);
          } catch (cleanupError) {
            log.warn(
              { cleanupError },
              "Failed to remove worktree during construct creation cleanup"
            );
          }
        };

        const deleteRecordIfNeeded = async () => {
          if (!recordCreated) {
            return;
          }

          try {
            await database
              .delete(constructs)
              .where(eq(constructs.id, constructId));
          } catch (cleanupError) {
            log.warn(
              { cleanupError },
              "Failed to delete construct row during cleanup"
            );
          }
        };

        const cleanupResources = async (
          options: { preserveRecord?: boolean; preserveWorktree?: boolean } = {}
        ) => {
          await stopServicesIfNeeded();

          if (!options.preserveWorktree) {
            removeWorktreeIfNeeded();
          }

          if (!options.preserveRecord) {
            await deleteRecordIfNeeded();
          }
        };

        try {
          const workspacePath = await worktreeService.createWorktree(
            constructId,
            {
              templateId: body.templateId,
            }
          );
          worktreeCreated = true;

          const newConstruct: NewConstruct = {
            id: constructId,
            name: body.name,
            description: body.description ?? null,
            templateId: body.templateId,
            workspacePath,
            opencodeSessionId: null,
            opencodeServerUrl: null,
            opencodeServerPort: null,
            createdAt: now,
            status: "pending",
            lastSetupError: null,
          };

          const [created] = await database
            .insert(constructs)
            .values(newConstruct)
            .returning();

          if (!created) {
            throw new Error("Failed to create construct record");
          }

          createdConstruct = created;
          recordCreated = true;

          await ensureSession(constructId);
          await ensureServices(created, template);

          servicesStarted = true;
          await updateConstructProvisioningStatus(
            database,
            constructId,
            "ready"
          );

          set.status = HTTP_STATUS.CREATED;
          return constructToResponse({
            ...created,
            status: "ready",
            lastSetupError: null,
          });
        } catch (error) {
          const payload = buildConstructCreationErrorPayload(error);
          const preserveResources = shouldPreserveConstructWorkspace(error);

          if (preserveResources && recordCreated && createdConstruct) {
            const lastSetupError = deriveSetupErrorDetails(payload);

            await updateConstructProvisioningStatus(
              database,
              constructId,
              "error",
              lastSetupError
            );

            await cleanupResources({
              preserveRecord: true,
              preserveWorktree: true,
            });

            const erroredConstruct = {
              ...createdConstruct,
              status: "error",
              lastSetupError,
            };

            if (error instanceof Error) {
              log.error(error, "Construct setup failed; workspace preserved");
            } else {
              log.error(
                { error },
                "Construct setup failed; workspace preserved"
              );
            }

            set.status = HTTP_STATUS.CREATED;
            return constructToResponse(erroredConstruct);
          }

          await cleanupResources();

          if (error instanceof Error) {
            log.error(error, "Failed to create construct");
          } else {
            log.error({ error }, "Failed to create construct");
          }

          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return payload;
        }
      },
      {
        body: CreateConstructSchema,
        response: {
          201: ConstructResponseSchema,
          400: t.Object({
            message: t.String(),
          }),
          500: ErrorResponseSchema,
        },
      }
    )
    .delete(
      "/",
      async ({ body, set, log }) => {
        try {
          const uniqueIds = [...new Set(body.ids)];

          const constructsToDelete = await database
            .select({
              id: constructs.id,
              workspacePath: constructs.workspacePath,
            })
            .from(constructs)
            .where(inArray(constructs.id, uniqueIds));

          if (constructsToDelete.length === 0) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "No constructs found for provided ids" };
          }

          const worktreeService = buildWorktreeManager();

          for (const construct of constructsToDelete) {
            await closeSession(construct.id);
            try {
              await stopConstructServicesFn(construct.id, {
                releasePorts: true,
              });
            } catch (error) {
              log.warn(
                { error, constructId: construct.id },
                "Failed to stop services before deletion"
              );
            }
            await removeConstructWorkspace(worktreeService, construct, log);
          }

          const idsToDelete = constructsToDelete.map(
            (construct) => construct.id
          );

          await database
            .delete(constructs)
            .where(inArray(constructs.id, idsToDelete));

          return { deletedIds: idsToDelete };
        } catch (error) {
          if (error instanceof Error) {
            log.error(error, "Failed to delete constructs");
          } else {
            log.error({ error }, "Failed to delete constructs");
          }
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to delete constructs" };
        }
      },
      {
        body: DeleteConstructsSchema,
        response: {
          200: t.Object({
            deletedIds: t.Array(t.String()),
          }),
          400: t.Object({
            message: t.String(),
          }),
          404: t.Object({
            message: t.String(),
          }),
          500: ErrorResponseSchema,
        },
      }
    )
    .delete(
      "/:id",
      async ({ params, set, log }) => {
        try {
          const construct = await loadConstructById(database, params.id);
          if (!construct) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "Construct not found" };
          }

          await closeSession(params.id);
          try {
            await stopConstructServicesFn(params.id, { releasePorts: true });
          } catch (error) {
            log.warn(
              { error, constructId: params.id },
              "Failed to stop services before construct removal"
            );
          }

          const worktreeService = buildWorktreeManager();
          await removeConstructWorkspace(worktreeService, construct, log);

          await database.delete(constructs).where(eq(constructs.id, params.id));

          return { message: "Construct deleted successfully" };
        } catch (error) {
          if (error instanceof Error) {
            log.error(error, "Failed to delete construct");
          } else {
            log.error({ error }, "Failed to delete construct");
          }
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to delete construct" };
        }
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        response: {
          200: t.Object({
            message: t.String(),
          }),
          404: t.Object({
            message: t.String(),
          }),
          500: ErrorResponseSchema,
        },
      }
    );
}

export const constructsRoutes = createConstructsRoutes();

type ErrorPayload = {
  message: string;
  details?: string;
};

type ConstructWorkspaceRecord = Pick<
  typeof constructs.$inferSelect,
  "id" | "workspacePath"
>;

type LoggerLike = {
  warn: (obj: Record<string, unknown>, message?: string) => void;
};

function shouldPreserveConstructWorkspace(
  error: unknown
): error is TemplateSetupError {
  return error instanceof TemplateSetupError;
}

function deriveSetupErrorDetails(payload: ErrorPayload): string {
  const details = payload.details?.trim();
  return details?.length ? details : payload.message;
}

async function updateConstructProvisioningStatus(
  database: typeof db,
  constructId: string,
  status: ConstructStatus,
  lastSetupError?: string | null
): Promise<void> {
  await database
    .update(constructs)
    .set({ status, lastSetupError: lastSetupError ?? null })
    .where(eq(constructs.id, constructId));
}

function buildConstructCreationErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof TemplateSetupError) {
    const details = [
      `Template ID: ${error.templateId}`,
      `Workspace: ${error.workspacePath}`,
      `Command: ${error.command}`,
    ];

    const stack = formatStackTrace(error);
    const causeStack = formatStackTrace(
      error.cause instanceof Error ? error.cause : undefined
    );

    if (stack) {
      details.push("", stack);
    }

    if (causeStack && causeStack !== stack) {
      details.push("", `Caused by:\n${causeStack}`);
    }

    return { message: error.message, details: details.join("\n") };
  }

  if (error instanceof CommandExecutionError) {
    const details = [
      `Command: ${error.command}`,
      `cwd: ${error.cwd}`,
      `Exit code: ${error.exitCode}`,
    ];

    const stack = formatStackTrace(error);
    if (stack) {
      details.push("", stack);
    }

    return { message: error.message, details: details.join("\n") };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      details: formatStackTrace(error),
    };
  }

  return { message: "Failed to create construct" };
}

function formatStackTrace(error?: Error): string | undefined {
  if (!error) {
    return;
  }

  return error.stack ?? error.message;
}

async function removeConstructWorkspace(
  worktreeService: ReturnType<typeof createWorktreeManager>,
  construct: ConstructWorkspaceRecord,
  log: LoggerLike
) {
  try {
    worktreeService.removeWorktree(construct.id);
    return;
  } catch (error) {
    log.warn(
      { error, constructId: construct.id },
      "Failed to remove git worktree, attempting filesystem cleanup"
    );
  }

  if (!construct.workspacePath) {
    return;
  }

  try {
    await fs.rm(construct.workspacePath, { recursive: true, force: true });
  } catch (error) {
    log.warn(
      {
        error,
        constructId: construct.id,
        workspacePath: construct.workspacePath,
      },
      "Failed to remove construct workspace directory"
    );
  }
}

async function loadConstructById(
  database: typeof db,
  constructId: string
): Promise<typeof constructs.$inferSelect | null> {
  const [construct] = await database
    .select()
    .from(constructs)
    .where(eq(constructs.id, constructId))
    .limit(1);

  return construct ?? null;
}

function fetchServiceRows(database: typeof db, constructId: string) {
  return database
    .select({ service: constructServices, construct: constructs })
    .from(constructServices)
    .innerJoin(constructs, eq(constructs.id, constructServices.constructId))
    .where(eq(constructServices.constructId, constructId));
}

async function fetchServiceRow(
  database: typeof db,
  constructId: string,
  serviceId: string
) {
  const [row] = await database
    .select({ service: constructServices, construct: constructs })
    .from(constructServices)
    .innerJoin(constructs, eq(constructs.id, constructServices.constructId))
    .where(
      and(
        eq(constructServices.constructId, constructId),
        eq(constructServices.id, serviceId)
      )
    )
    .limit(1);

  return row ?? null;
}

async function serializeService(
  database: typeof db,
  row: {
    service: typeof constructServices.$inferSelect;
    construct: typeof constructs.$inferSelect;
  }
) {
  const { service, construct } = row;
  const logPath = computeServiceLogPath(construct.workspacePath, service.name);
  const recentLogs = await readLogTail(logPath);
  const processAlive = isProcessAlive(service.pid);
  const portReachable =
    typeof service.port === "number"
      ? await isPortActive(service.port)
      : undefined;

  let derivedStatus = service.status;
  let derivedLastKnownError = service.lastKnownError;

  if (service.status === "running" && !processAlive) {
    derivedStatus = "error";
    derivedLastKnownError =
      service.lastKnownError ?? "Process exited unexpectedly";
  } else if (service.status === "error" && processAlive) {
    derivedStatus = "running";
    derivedLastKnownError = null;
  }

  const derivedPid = processAlive ? service.pid : null;
  const shouldPersist =
    derivedStatus !== service.status ||
    derivedLastKnownError !== service.lastKnownError ||
    derivedPid !== (service.pid ?? null);

  if (shouldPersist) {
    await database
      .update(constructServices)
      .set({
        status: derivedStatus,
        lastKnownError: derivedLastKnownError,
        pid: derivedPid,
        updatedAt: new Date(),
      })
      .where(eq(constructServices.id, service.id));
  }

  return {
    id: service.id,
    name: service.name,
    type: service.type,
    status: derivedStatus,
    port: service.port ?? undefined,
    pid: derivedPid ?? undefined,
    command: service.command,
    cwd: service.cwd,
    logPath,
    lastKnownError: derivedLastKnownError,
    env: service.env,
    updatedAt: service.updatedAt.toISOString(),
    recentLogs,
    processAlive,
    portReachable,
  };
}

async function readLogTail(logPath?: string | null): Promise<string | null> {
  if (!logPath) {
    return null;
  }

  try {
    const file = await fs.open(logPath, "r");
    try {
      const stats = await file.stat();
      const totalBytes = Number(stats.size ?? 0);
      if (totalBytes === 0) {
        return "";
      }
      const bytesToRead = Math.min(totalBytes, LOG_TAIL_MAX_BYTES);
      const start = totalBytes - bytesToRead;
      const buffer = Buffer.alloc(bytesToRead);
      await file.read(buffer, 0, bytesToRead, start);
      const lines = buffer.toString("utf8").split(LOG_LINE_SPLIT_RE);
      return lines.slice(-LOG_TAIL_MAX_LINES).join("\n").trimEnd();
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

function computeServiceLogPath(
  workspacePath: string,
  serviceName: string
): string {
  const safe = sanitizeServiceNameForLogs(serviceName);
  return resolvePath(workspacePath, SERVICE_LOG_DIR, `${safe}.log`);
}

function sanitizeServiceNameForLogs(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  return normalized.length > 0 ? normalized : "service";
}
