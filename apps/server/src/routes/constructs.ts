import { logger } from "@bogeychan/elysia-logger";
import { eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { ensureAgentSession } from "../agents/service";
import { db } from "../db";
import {
  closeInstance,
  createOpencodeServer,
  createSessionWithMessage,
} from "../opencode/service";
import {
  ConstructListResponseSchema,
  ConstructResponseSchema,
  CreateConstructSchema,
  DeleteConstructsSchema,
} from "../schema/api";
import { constructs, type NewConstruct } from "../schema/constructs";
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
      let opencodeServerCreated = false;
      let recordCreated = false;

      const cleanupResources = async () => {
        if (opencodeServerCreated) {
          try {
            closeInstance(constructId);
          } catch (cleanupError) {
            log.warn(
              { cleanupError },
              "Failed to close OpenCode server during cleanup"
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

        // Create OpenCode server for this construct
        const opencodeInstance = await createOpencodeServer({
          directory: workspacePath,
        });
        opencodeServerCreated = true;

        // Create session and send description as initial message
        const { sessionId } = await createSessionWithMessage({
          client: opencodeInstance.client,
          title: body.name,
          message: body.description || undefined,
          directory: workspacePath,
        });

        const newConstruct: NewConstruct = {
          id: constructId,
          name: body.name,
          description: body.description ?? null,
          templateId: body.templateId,
          workspacePath,
          opencodeSessionId: sessionId,
          opencodeServerUrl: opencodeInstance.server.url,
          opencodeServerPort: opencodeInstance.server.port,
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
          closeInstance(construct.id);
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

        closeInstance(params.id);

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
