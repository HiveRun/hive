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
  switch (true) {
    case cause instanceof Error:
      return cause.message;
    case typeof cause === "string":
      return cause;
    default:
      return fallback;
  }
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

const failedBadRequest = <T>(
  cause: unknown,
  fallback: string
): WorkspaceRouteResponse<T> =>
  failure(toError(HTTP_STATUS.BAD_REQUEST, formatUnknown(cause, fallback)));

const sendOutcome = <T>(
  set: { status?: number | string },
  outcome: WorkspaceRouteResponse<T>
) => {
  set.status = outcome.status;
  return outcome.body;
};

const workspacePathBodySchema = (extra?: Record<string, unknown>) =>
  t.Object({
    path: t.String({ minLength: 1 }),
    label: t.Optional(t.String()),
    ...(extra ?? {}),
  });

const workspaceNotFound = <T>() =>
  failure<T>(toError(HTTP_STATUS.NOT_FOUND, "Workspace not found"));

const workspaceMutationSuccess = (
  workspace: WorkspaceRecord | null
): WorkspaceRouteResponse<{ workspace: WorkspaceRecord }> =>
  workspace ? success({ workspace }) : workspaceNotFound();

const safeBrowse = async (
  path?: string,
  filter?: string
): Promise<WorkspaceRouteResponse<WorkspaceBrowseResult>> => {
  try {
    const directories = await browseWorkspaceDirectories(path, filter);
    return success(directories);
  } catch (cause) {
    return failedBadRequest(cause, "Failed to browse directories");
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
    return failedBadRequest(cause, "Failed to register workspace");
  }
};

const safeActivate = async (
  id: string
): Promise<WorkspaceRouteResponse<{ workspace: WorkspaceRecord }>> => {
  try {
    const workspace = await activateWorkspace(id);
    return workspaceMutationSuccess(workspace);
  } catch (cause) {
    return failedBadRequest(cause, "Failed to activate workspace");
  }
};

const safeUpdate = async (
  id: string,
  label: string
): Promise<WorkspaceRouteResponse<{ workspace: WorkspaceRecord }>> => {
  try {
    const workspace = await updateWorkspaceLabel({ id, label });
    return workspaceMutationSuccess(workspace);
  } catch (cause) {
    return failedBadRequest(cause, "Failed to update workspace");
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
    return failedBadRequest(cause, "Failed to remove workspace");
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
    return failedBadRequest(cause, "Failed to auto-register workspace");
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
    async ({ query, set }) =>
      sendOutcome(set, await safeBrowse(query.path, query.filter)),
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
    async ({ body, set }) => sendOutcome(set, await safeRegister(body)),
    {
      body: workspacePathBodySchema({ activate: t.Optional(t.Boolean()) }),
      response: {
        201: WorkspaceMutationResponseSchema,
        400: ErrorSchema,
      },
    }
  )
  .post(
    "/:id/activate",
    async ({ params, set }) => sendOutcome(set, await safeActivate(params.id)),
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
    async ({ params, body, set }) =>
      sendOutcome(set, await safeUpdate(params.id, body.label)),
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
    async ({ params, set, request, server }) => {
      server?.timeout(request, 0);
      return sendOutcome(set, await safeDelete(params.id));
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
    async ({ body, set }) => sendOutcome(set, await safeAutoRegister(body)),
    {
      body: workspacePathBodySchema(),
      response: {
        201: WorkspaceMutationResponseSchema,
        400: ErrorSchema,
      },
    }
  );
