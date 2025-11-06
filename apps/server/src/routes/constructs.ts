import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db";
import { constructs, type NewConstruct } from "../schema/constructs";
import { createWorktreeService } from "../worktree/service";

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
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
    updatedAt: construct.updatedAt.toISOString(),
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
        200: t.Object({
          constructs: t.Array(
            t.Object({
              id: t.String(),
              name: t.String(),
              description: t.Union([t.String(), t.Null()]),
              templateId: t.String(),
              workspacePath: t.Union([t.String(), t.Null()]),
              createdAt: t.String(),
              updatedAt: t.String(),
            })
          ),
        }),
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
        200: t.Object({
          id: t.String(),
          name: t.String(),
          description: t.Union([t.String(), t.Null()]),
          templateId: t.String(),
          workspacePath: t.Union([t.String(), t.Null()]),
          createdAt: t.String(),
          updatedAt: t.String(),
        }),
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
        const now = new Date();
        const newConstruct: NewConstruct = {
          id: crypto.randomUUID(),
          name: body.name,
          description: body.description ?? null,
          templateId: body.templateId,
          createdAt: now,
          updatedAt: now,
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
      body: t.Object({
        name: t.String({
          minLength: 1,
          maxLength: 255,
        }),
        description: t.Optional(
          t.String({
            maxLength: 1000,
          })
        ),
        templateId: t.String({
          minLength: 1,
        }),
      }),
      response: {
        201: t.Object({
          id: t.String(),
          name: t.String(),
          description: t.Union([t.String(), t.Null()]),
          templateId: t.String(),
          workspacePath: t.Union([t.String(), t.Null()]),
          createdAt: t.String(),
          updatedAt: t.String(),
        }),
        400: t.Object({
          message: t.String(),
        }),
        500: t.Object({
          message: t.String(),
        }),
      },
    }
  )
  .put(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const existing = await db
          .select()
          .from(constructs)
          .where(eq(constructs.id, params.id))
          .limit(1);

        if (existing.length === 0) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Construct not found" };
        }

        const updatedConstruct = {
          name: body.name,
          description: body.description ?? null,
          templateId: body.templateId,
          updatedAt: new Date(),
        };

        const [updated] = await db
          .update(constructs)
          .set(updatedConstruct)
          .where(eq(constructs.id, params.id))
          .returning();

        if (!updated) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to update construct" };
        }

        return constructToResponse(updated);
      } catch (_error) {
        set.status = HTTP_STATUS.INTERNAL_ERROR;
        return { message: "Failed to update construct" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.String({
          minLength: 1,
          maxLength: 255,
        }),
        description: t.Optional(
          t.String({
            maxLength: 1000,
          })
        ),
        templateId: t.String({
          minLength: 1,
        }),
      }),
      response: {
        200: t.Object({
          id: t.String(),
          name: t.String(),
          description: t.Union([t.String(), t.Null()]),
          templateId: t.String(),
          workspacePath: t.Union([t.String(), t.Null()]),
          createdAt: t.String(),
          updatedAt: t.String(),
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
        const existing = await db
          .select()
          .from(constructs)
          .where(eq(constructs.id, params.id))
          .limit(1);

        if (existing.length === 0) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Construct not found" };
        }

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
  )
  .post(
    "/:id/worktree",
    async ({ params, body, set }) => {
      try {
        const worktreeService = createWorktreeService();

        // Check if construct exists
        const existing = await db
          .select()
          .from(constructs)
          .where(eq(constructs.id, params.id))
          .limit(1);

        if (existing.length === 0) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Construct not found" };
        }

        const construct = existing[0];

        // Check if worktree already exists
        if (construct?.workspacePath) {
          const exists = await worktreeService.worktreeExists(params.id);
          if (exists && !body.force) {
            set.status = HTTP_STATUS.CONFLICT;
            return { message: "Worktree already exists for this construct" };
          }
        }

        // Create worktree
        const worktreePath = await worktreeService.createWorktree(params.id, {
          branch: body.branch,
          force: body.force,
        });

        // Update construct with workspace path
        await db
          .update(constructs)
          .set({
            workspacePath: worktreePath,
            updatedAt: new Date(),
          })
          .where(eq(constructs.id, params.id));

        set.status = HTTP_STATUS.CREATED;
        return {
          message: "Worktree created successfully",
          constructId: params.id,
          workspacePath: worktreePath,
        };
      } catch (_error) {
        set.status = HTTP_STATUS.INTERNAL_ERROR;
        return { message: "Failed to create worktree" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        branch: t.Optional(t.String()),
        force: t.Optional(t.Boolean()),
      }),
      response: {
        201: t.Object({
          message: t.String(),
          constructId: t.String(),
          workspacePath: t.String(),
        }),
        404: t.Object({
          message: t.String(),
        }),
        409: t.Object({
          message: t.String(),
        }),
        500: t.Object({
          message: t.String(),
        }),
      },
    }
  )
  .delete(
    "/:id/worktree",
    async ({ params, set }) => {
      try {
        const worktreeService = createWorktreeService();

        // Check if construct exists
        const existing = await db
          .select()
          .from(constructs)
          .where(eq(constructs.id, params.id))
          .limit(1);

        if (existing.length === 0) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Construct not found" };
        }

        // Remove worktree
        await worktreeService.removeWorktree(params.id);

        // Update construct to remove workspace path
        await db
          .update(constructs)
          .set({
            workspacePath: null,
            updatedAt: new Date(),
          })
          .where(eq(constructs.id, params.id));

        return {
          message: "Worktree removed successfully",
          constructId: params.id,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: error.message };
        }

        set.status = HTTP_STATUS.INTERNAL_ERROR;
        return { message: "Failed to remove worktree" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      response: {
        200: t.Object({
          message: t.String(),
          constructId: t.String(),
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
  .get(
    "/:id/worktree",
    async ({ params, set }) => {
      try {
        const worktreeService = createWorktreeService();
        const worktreeInfo = await worktreeService.getWorktreeInfo(params.id);

        if (!worktreeInfo) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Worktree not found" };
        }

        return {
          id: worktreeInfo.id,
          path: worktreeInfo.path,
          branch: worktreeInfo.branch,
          commit: worktreeInfo.commit,
          isMain: worktreeInfo.isMain,
        };
      } catch (_error) {
        set.status = HTTP_STATUS.INTERNAL_ERROR;
        return { message: "Failed to get worktree info" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      response: {
        200: t.Object({
          id: t.String(),
          path: t.String(),
          branch: t.String(),
          commit: t.String(),
          isMain: t.Boolean(),
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
