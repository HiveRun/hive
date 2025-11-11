import { logger } from "@bogeychan/elysia-logger";
import { eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { closeAgentSession, ensureAgentSession } from "../agents/service";
import { db } from "../db";
import {
  ConstructListResponseSchema,
  ConstructResponseSchema,
  CreateConstructSchema,
  DeleteConstructsSchema,
} from "../schema/api";
import { constructs, type NewConstruct } from "../schema/constructs";
import {
  ensureServicesForConstruct,
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

const LOGGER_CONFIG = {
  level: process.env.LOG_LEVEL || "info",
  autoLogging: false,
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty" as const }
      : undefined,
} as const;

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
  .post(
    "/",
    async ({ body, set, log }) => {
      const worktreeService = createWorktreeManager();
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
        await ensureServicesForConstruct(created);
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
        const result = await db
          .select()
          .from(constructs)
          .where(eq(constructs.id, params.id))
          .limit(1);

        if (result.length === 0) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Construct not found" };
        }

        const construct = result[0];
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
