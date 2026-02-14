import { Elysia, t } from "elysia";
import {
  browseWorkspaceDirectories,
  type WorkspaceBrowseResult,
} from "../workspaces/browser";
import {
  activateWorkspace,
  ensureWorkspaceRegistered,
  getWorkspaceRegistry,
  registerWorkspace,
  updateWorkspaceLabel,
  type WorkspaceRecord,
} from "../workspaces/registry";
import { removeWorkspaceCascade } from "../workspaces/removal";

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
} as const;

type WorkspaceRouteError = {
  status: number;
  message: string;
};

type WorkspaceRouteResponse<T> = {
  status: number;
  body: T | { message: string };
};

const formatUnknown = (cause: unknown, fallback: string) => {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  return fallback;
};

const toError = (status: number, message: string): WorkspaceRouteError => ({
  status,
  message,
});

const success = <T>(
  body: T,
  status: number = HTTP_STATUS.OK
): WorkspaceRouteResponse<T> => ({
  status,
  body,
});

const failure = <T>(error: WorkspaceRouteError): WorkspaceRouteResponse<T> => ({
  status: error.status,
  body: { message: error.message },
});

const safeBrowse = async (
  path?: string,
  filter?: string
): Promise<WorkspaceRouteResponse<WorkspaceBrowseResult>> => {
  try {
    const directories = await browseWorkspaceDirectories(path, filter);
    return success(directories);
  } catch (cause) {
    return failure(
      toError(
        HTTP_STATUS.BAD_REQUEST,
        formatUnknown(cause, "Failed to browse directories")
      )
    );
  }
};

const safeRegister = async (body: {
  path: string;
  label?: string;
  activate?: boolean;
}): Promise<WorkspaceRouteResponse<{ workspace: WorkspaceRecord }>> => {
  try {
    const workspace = await registerWorkspace(
      { path: body.path, label: body.label },
      { setActive: body.activate ?? false }
    );
    return success({ workspace }, HTTP_STATUS.CREATED);
  } catch (cause) {
    return failure(
      toError(
        HTTP_STATUS.BAD_REQUEST,
        formatUnknown(cause, "Failed to register workspace")
      )
    );
  }
};

const safeActivate = async (
  id: string
): Promise<WorkspaceRouteResponse<{ workspace: WorkspaceRecord }>> => {
  try {
    const workspace = await activateWorkspace(id);
    if (!workspace) {
      return failure(toError(HTTP_STATUS.NOT_FOUND, "Workspace not found"));
    }

    return success({ workspace });
  } catch (cause) {
    return failure(
      toError(
        HTTP_STATUS.BAD_REQUEST,
        formatUnknown(cause, "Failed to activate workspace")
      )
    );
  }
};

const safeUpdate = async (
  id: string,
  label: string
): Promise<WorkspaceRouteResponse<{ workspace: WorkspaceRecord }>> => {
  try {
    const workspace = await updateWorkspaceLabel({ id, label });
    if (!workspace) {
      return failure(toError(HTTP_STATUS.NOT_FOUND, "Workspace not found"));
    }

    return success({ workspace });
  } catch (cause) {
    return failure(
      toError(
        HTTP_STATUS.BAD_REQUEST,
        formatUnknown(cause, "Failed to update workspace")
      )
    );
  }
};

const safeDelete = async (
  id: string
): Promise<WorkspaceRouteResponse<null>> => {
  try {
    const result = await removeWorkspaceCascade(id);
    if (!result) {
      return failure(toError(HTTP_STATUS.NOT_FOUND, "Workspace not found"));
    }

    return success(null, HTTP_STATUS.NO_CONTENT);
  } catch (cause) {
    return failure(
      toError(
        HTTP_STATUS.BAD_REQUEST,
        formatUnknown(cause, "Failed to remove workspace")
      )
    );
  }
};

const safeAutoRegister = async (body: {
  path: string;
  label?: string;
}): Promise<WorkspaceRouteResponse<{ workspace: WorkspaceRecord }>> => {
  try {
    const workspace = await ensureWorkspaceRegistered(body.path, {
      label: body.label,
    });

    return success({ workspace }, HTTP_STATUS.CREATED);
  } catch (cause) {
    return failure(
      toError(
        HTTP_STATUS.BAD_REQUEST,
        formatUnknown(cause, "Failed to auto-register workspace")
      )
    );
  }
};

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
    async ({ set }) => {
      try {
        const registry = await getWorkspaceRegistry();
        set.status = HTTP_STATUS.OK;
        return registry;
      } catch (cause) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message: formatUnknown(cause, "Failed to load workspaces"),
        };
      }
    },
    {
      response: {
        200: WorkspaceListResponseSchema,
        400: ErrorSchema,
      },
    }
  )
  .get(
    "/browse",
    async ({ query, set }) => {
      const outcome = await safeBrowse(query.path, query.filter);
      set.status = outcome.status;
      return outcome.body;
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
      const outcome = await safeRegister(body);
      set.status = outcome.status;
      return outcome.body;
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
      const outcome = await safeActivate(params.id);
      set.status = outcome.status;
      return outcome.body;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      response: {
        200: WorkspaceMutationResponseSchema,
        400: ErrorSchema,
        404: ErrorSchema,
      },
    }
  )
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      const outcome = await safeUpdate(params.id, body.label);
      set.status = outcome.status;
      return outcome.body;
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
      const outcome = await safeDelete(params.id);
      set.status = outcome.status;
      return outcome.body;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      response: {
        204: t.Null(),
        400: ErrorSchema,
        404: ErrorSchema,
      },
    }
  )
  .post(
    "/auto-register",
    async ({ body, set }) => {
      const outcome = await safeAutoRegister(body);
      set.status = outcome.status;
      return outcome.body;
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
