import { Elysia, t } from "elysia";
import { createWorktreeService, type WorktreeInfo } from "../worktree/service";

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
} as const;

function worktreeInfoToResponse(info: WorktreeInfo) {
  return {
    id: info.id,
    path: info.path,
    branch: info.branch,
    commit: info.commit,
    isMain: info.isMain,
  };
}

export function createWorktreeRoutes(baseDir?: string) {
  const worktreeService = createWorktreeService(baseDir);

  return new Elysia({ prefix: "/api/worktrees" })
    .get(
      "/",
      async () => {
        const worktrees = await worktreeService.listWorktrees();
        return { worktrees: worktrees.map(worktreeInfoToResponse) };
      },
      {
        response: {
          200: t.Object({
            worktrees: t.Array(
              t.Object({
                id: t.String(),
                path: t.String(),
                branch: t.String(),
                commit: t.String(),
                isMain: t.Boolean(),
              })
            ),
          }),
        },
      }
    )
    .get(
      "/:constructId",
      async ({ params, set }) => {
        const worktreeInfo = await worktreeService.getWorktreeInfo(
          params.constructId
        );

        if (!worktreeInfo) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Worktree not found" };
        }

        return worktreeInfoToResponse(worktreeInfo);
      },
      {
        params: t.Object({
          constructId: t.String(),
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
        },
      }
    )
    .post(
      "/:constructId",
      async ({ params, body, set }) => {
        try {
          const worktreePath = await worktreeService.createWorktree(
            params.constructId,
            {
              branch: body.branch,
              force: body.force,
            }
          );

          set.status = HTTP_STATUS.CREATED;
          return {
            message: "Worktree created",
            constructId: params.constructId,
            path: worktreePath,
          };
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("already exists")
          ) {
            set.status = HTTP_STATUS.CONFLICT;
            return { message: error.message };
          }

          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to create worktree" };
        }
      },
      {
        params: t.Object({
          constructId: t.String(),
        }),
        body: t.Object({
          branch: t.Optional(t.String()),
          force: t.Optional(t.Boolean()),
        }),
        response: {
          201: t.Object({
            message: t.String(),
            constructId: t.String(),
            path: t.String(),
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
      "/:constructId",
      async ({ params, set }) => {
        try {
          await worktreeService.removeWorktree(params.constructId);
          return {
            message: "Worktree removed successfully",
            constructId: params.constructId,
          };
        } catch (error) {
          if (error instanceof Error && error.message.includes("not found")) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "Worktree not found" };
          }

          if (
            error instanceof Error &&
            error.message.includes("Cannot remove the main worktree")
          ) {
            set.status = HTTP_STATUS.CONFLICT;
            return { message: error.message };
          }

          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to remove worktree" };
        }
      },
      {
        params: t.Object({
          constructId: t.String(),
        }),
        response: {
          200: t.Object({
            message: t.String(),
            constructId: t.String(),
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
    .post(
      "/prune",
      async () => {
        await worktreeService.pruneWorktrees();
        return { message: "Worktrees pruned successfully" };
      },
      {
        response: {
          200: t.Object({
            message: t.String(),
          }),
        },
      }
    );
}
