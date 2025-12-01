import { Elysia, t } from "elysia";
import { runServerEffect } from "../runtime";
import { browseWorkspaceDirectories } from "../workspaces/browser";
import {
  activateWorkspaceEffect,
  ensureWorkspaceRegisteredEffect,
  getWorkspaceRegistryEffect,
  registerWorkspaceEffect,
  updateWorkspaceLabelEffect,
} from "../workspaces/registry";
import { removeWorkspaceCascade } from "../workspaces/removal";

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
} as const;

const WorkspaceSchema = t.Object({
  id: t.String(),
  label: t.String(),
  path: t.String(),
  addedAt: t.String(),
  lastOpenedAt: t.Optional(t.String()),
});

const WorkspaceListResponseSchema = t.Object({
  workspaces: t.Array(WorkspaceSchema),
  activeWorkspaceId: t.Optional(t.Union([t.String(), t.Null()])),
});

const WorkspaceMutationResponseSchema = t.Object({
  workspace: WorkspaceSchema,
});

const WorkspaceDirectoryEntrySchema = t.Object({
  name: t.String(),
  path: t.String(),
  hasConfig: t.Boolean(),
});

const WorkspaceBrowseResponseSchema = t.Object({
  path: t.String(),
  parentPath: t.Optional(t.Union([t.String(), t.Null()])),
  directories: t.Array(WorkspaceDirectoryEntrySchema),
});

const ErrorSchema = t.Object({
  message: t.String(),
});

export const workspacesRoutes = new Elysia({ prefix: "/api/workspaces" })
  .get(
    "/",
    async () => {
      const registry = await runServerEffect(getWorkspaceRegistryEffect);
      return registry;
    },
    {
      response: {
        200: WorkspaceListResponseSchema,
      },
    }
  )
  .get(
    "/browse",
    async ({ query, set }) => {
      try {
        return await browseWorkspaceDirectories(query.path, query.filter);
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      query: t.Object({
        path: t.Optional(t.String()),
        filter: t.Optional(t.String()),
      }),
      response: {
        200: WorkspaceBrowseResponseSchema,
        400: ErrorSchema,
      },
    }
  )
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const workspace = await runServerEffect(
          registerWorkspaceEffect(
            { path: body.path, label: body.label },
            { setActive: body.activate ?? false }
          )
        );
        set.status = HTTP_STATUS.CREATED;
        return { workspace };
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      body: t.Object({
        path: t.String({ minLength: 1 }),
        label: t.Optional(t.String()),
        activate: t.Optional(t.Boolean()),
      }),
      response: {
        201: WorkspaceMutationResponseSchema,
        400: ErrorSchema,
      },
    }
  )
  .post(
    "/:id/activate",
    async ({ params, set }) => {
      const workspace = await runServerEffect(
        activateWorkspaceEffect(params.id)
      );
      if (!workspace) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Workspace not found" };
      }
      return { workspace };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      response: {
        200: WorkspaceMutationResponseSchema,
        404: ErrorSchema,
      },
    }
  )
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const workspace = await runServerEffect(
          updateWorkspaceLabelEffect({
            id: params.id,
            label: body.label,
          })
        );
        if (!workspace) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Workspace not found" };
        }
        return { workspace };
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        label: t.String({ minLength: 1 }),
      }),
      response: {
        200: WorkspaceMutationResponseSchema,
        400: ErrorSchema,
        404: ErrorSchema,
      },
    }
  )
  .delete(
    "/:id",
    async ({ params, set }) => {
      const result = await removeWorkspaceCascade(params.id);
      if (!result) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Workspace not found" };
      }
      set.status = HTTP_STATUS.NO_CONTENT;
      return null;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      response: {
        204: t.Null(),
        404: ErrorSchema,
      },
    }
  )
  .post(
    "/auto-register",
    async ({ body, set }) => {
      try {
        const workspace = await runServerEffect(
          ensureWorkspaceRegisteredEffect(body.path, {
            label: body.label,
          })
        );
        set.status = HTTP_STATUS.CREATED;
        return { workspace };
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      body: t.Object({
        path: t.String({ minLength: 1 }),
        label: t.Optional(t.String()),
      }),
      response: {
        201: WorkspaceMutationResponseSchema,
        400: ErrorSchema,
      },
    }
  );
