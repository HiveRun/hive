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
import { constructs, type NewConstruct } from "../schema/constructs";
import { constructServices } from "../schema/services";
import {
  ensureServicesForConstruct,
  isProcessAlive,
  startServiceById,
  stopServiceById,
  stopServicesForConstruct,
} from "../services/supervisor";
import { createWorktreeManager } from "../worktree/manager";

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
} as const;

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
  };
}

export const constructsRoutes = new Elysia({ prefix: "/api/constructs" })
  .use(logger(LOGGER_CONFIG))
  .get(
    "/",
    async () => {
      const allConstructs = await db.select().from(constructs);
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
      const result = await db
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
      const construct = await loadConstructById(params.id);
      if (!construct) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Construct not found" };
      }

      const rows = await fetchServiceRows(params.id);
      const services = await Promise.all(rows.map(serializeService));
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
      const row = await fetchServiceRow(params.id, params.serviceId);
      if (!row) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Service not found" };
      }

      await startServiceById(params.serviceId);
      const updated = await fetchServiceRow(params.id, params.serviceId);
      if (!updated) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Service not found" };
      }

      return serializeService(updated);
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
      const row = await fetchServiceRow(params.id, params.serviceId);
      if (!row) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Service not found" };
      }

      await stopServiceById(params.serviceId);
      const updated = await fetchServiceRow(params.id, params.serviceId);
      if (!updated) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Service not found" };
      }

      return serializeService(updated);
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
    async ({ body, set, log }) => {
      const syntheticConfig = await getSyntheticConfig();
      const template = syntheticConfig.templates[body.templateId];
      if (!template) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return { message: "Template not found" };
      }

      const worktreeService = createWorktreeManager(
        process.cwd(),
        syntheticConfig
      );
      const now = new Date();
      const constructId = crypto.randomUUID();
      let worktreeCreated = false;
      let recordCreated = false;
      let servicesStarted = false;

      const cleanupResources = async () => {
        if (servicesStarted) {
          try {
            await stopServicesForConstruct(constructId, { releasePorts: true });
          } catch (cleanupError) {
            log.warn(
              { cleanupError },
              "Failed to stop services during construct creation cleanup"
            );
          }
        }

        if (worktreeCreated) {
          try {
            worktreeService.removeWorktree(constructId);
          } catch (cleanupError) {
            log.warn(
              { cleanupError },
              "Failed to remove worktree during construct creation cleanup"
            );
          }
        }

        if (recordCreated) {
          try {
            await db.delete(constructs).where(eq(constructs.id, constructId));
          } catch (cleanupError) {
            log.warn(
              { cleanupError },
              "Failed to delete construct row during cleanup"
            );
          }
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
        };

        const [created] = await db
          .insert(constructs)
          .values(newConstruct)
          .returning();

        if (!created) {
          throw new Error("Failed to create construct record");
        }

        recordCreated = true;

        await ensureAgentSession(constructId);
        await ensureServicesForConstruct(created, template);
        servicesStarted = true;

        set.status = HTTP_STATUS.CREATED;
        return constructToResponse(created);
      } catch (error) {
        await cleanupResources();

        if (error instanceof Error) {
          log.error(error, "Failed to create construct");
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: error.message };
        }

        log.error({ error }, "Failed to create construct");
        set.status = HTTP_STATUS.INTERNAL_ERROR;
        return { message: "Failed to create construct" };
      }
    },
    {
      body: CreateConstructSchema,
      response: {
        201: ConstructResponseSchema,
        400: t.Object({
          message: t.String(),
        }),
        500: t.Object({
          message: t.String(),
        }),
      },
    }
  )
  .delete(
    "/",
    async ({ body, set, log }) => {
      try {
        const uniqueIds = [...new Set(body.ids)];

        const constructsToDelete = await db
          .select({
            id: constructs.id,
          })
          .from(constructs)
          .where(inArray(constructs.id, uniqueIds));

        if (constructsToDelete.length === 0) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "No constructs found for provided ids" };
        }

        const worktreeService = createWorktreeManager();

        for (const construct of constructsToDelete) {
          await closeAgentSession(construct.id);
          try {
            await stopServicesForConstruct(construct.id, {
              releasePorts: true,
            });
          } catch (error) {
            log.warn(
              { error, constructId: construct.id },
              "Failed to stop services before deletion"
            );
          }
          worktreeService.removeWorktree(construct.id);
        }

        const idsToDelete = constructsToDelete.map((construct) => construct.id);

        await db.delete(constructs).where(inArray(constructs.id, idsToDelete));

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
        500: t.Object({
          message: t.String(),
        }),
      },
    }
  )
  .delete(
    "/:id",
    async ({ params, set, log }) => {
      try {
        const construct = await loadConstructById(params.id);
        if (!construct) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Construct not found" };
        }

        await closeAgentSession(params.id);
        try {
          await stopServicesForConstruct(params.id, { releasePorts: true });
        } catch (error) {
          log.warn(
            { error, constructId: params.id },
            "Failed to stop services before construct removal"
          );
        }

        const worktreeService = createWorktreeManager();
        await worktreeService.removeWorktree(params.id);

        await db.delete(constructs).where(eq(constructs.id, params.id));

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
        500: t.Object({
          message: t.String(),
        }),
      },
    }
  );

async function loadConstructById(
  constructId: string
): Promise<typeof constructs.$inferSelect | null> {
  const [construct] = await db
    .select()
    .from(constructs)
    .where(eq(constructs.id, constructId))
    .limit(1);

  return construct ?? null;
}

function fetchServiceRows(constructId: string) {
  return db
    .select({ service: constructServices, construct: constructs })
    .from(constructServices)
    .innerJoin(constructs, eq(constructs.id, constructServices.constructId))
    .where(eq(constructServices.constructId, constructId));
}

async function fetchServiceRow(constructId: string, serviceId: string) {
  const [row] = await db
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

async function serializeService(row: {
  service: typeof constructServices.$inferSelect;
  construct: typeof constructs.$inferSelect;
}) {
  const { service, construct } = row;
  const logPath = computeServiceLogPath(construct.workspacePath, service.name);
  const recentLogs = await readLogTail(logPath);
  const processAlive = isProcessAlive(service.pid);
  const portActive = service.port ? await isPortActive(service.port) : true;
  const shouldFlagError =
    service.status === "running" && !(processAlive && portActive);

  let derivedStatus = service.status;
  let derivedLastKnownError = service.lastKnownError;

  if (shouldFlagError) {
    derivedStatus = "error";
    derivedLastKnownError =
      service.lastKnownError ??
      (processAlive
        ? "Service port is not accepting connections"
        : "Process exited unexpectedly");

    await db
      .update(constructServices)
      .set({
        status: derivedStatus,
        lastKnownError: derivedLastKnownError,
        pid: processAlive ? service.pid : null,
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
    pid: service.pid ?? undefined,
    command: service.command,
    cwd: service.cwd,
    logPath,
    lastKnownError: derivedLastKnownError,
    env: service.env,
    updatedAt: service.updatedAt.toISOString(),
    recentLogs,
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
