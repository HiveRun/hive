import { eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db";
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

function constructToResponse(construct: typeof constructs.$inferSelect) {
  return {
    id: construct.id,
    name: construct.name,
    description: construct.description,
    templateId: construct.templateId,
    workspacePath: construct.workspacePath,
    createdAt: construct.createdAt.toISOString(),
  };
}

export const constructsRoutes = new Elysia({ prefix: "/api/constructs" })
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
    async ({ body, set }) => {
      try {
        const worktreeService = createWorktreeManager();
        const now = new Date();
        const constructId = crypto.randomUUID();

        const workspacePath = await worktreeService.createWorktree(constructId);

        const newConstruct: NewConstruct = {
          id: constructId,
          name: body.name,
          description: body.description ?? null,
          templateId: body.templateId,
          workspacePath,
          createdAt: now,
        };

        const [created] = await db
          .insert(constructs)
          .values(newConstruct)
          .returning();

        if (!created) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to create construct" };
        }

        set.status = HTTP_STATUS.CREATED;
        return constructToResponse(created);
      } catch (_error) {
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
    async ({ body, set }) => {
      try {
        const uniqueIds = [...new Set(body.ids)];
        if (uniqueIds.length === 0) {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return { message: "At least one construct id is required" };
        }

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
          worktreeService.removeWorktree(construct.id);
        }

        const idsToDelete = constructsToDelete.map((construct) => construct.id);

        await db.delete(constructs).where(inArray(constructs.id, idsToDelete));

        return { deletedIds: idsToDelete };
      } catch (_error) {
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
    async ({ params, set }) => {
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

        const worktreeService = createWorktreeManager();
        await worktreeService.removeWorktree(params.id);

        await db.delete(constructs).where(eq(constructs.id, params.id));

        return { message: "Construct deleted successfully" };
      } catch (_error) {
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
