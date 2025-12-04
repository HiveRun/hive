import { Effect } from "effect";
import { Elysia, t } from "elysia";
import { LoggerService } from "../logger";
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

type WorkspaceRouteError = {
  status: number;
  message: string;
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

const matchWorkspaceEffect = <A, R>(
  effect: Effect.Effect<A, WorkspaceRouteError, R>,
  successStatus: number = HTTP_STATUS.OK
) =>
  Effect.match(effect, {
    onFailure: (error) => ({
      status: error.status,
      body: { message: error.message },
    }),
    onSuccess: (value) => ({ status: successStatus, body: value }),
  });

const withRouteLogger = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  context: Record<string, unknown>
) =>
  LoggerService.pipe(
    Effect.flatMap((logger) =>
      effect.pipe(Effect.provideService(LoggerService, logger.child(context)))
    )
  );

const safeBrowseEffect = (path?: string, filter?: string) =>
  Effect.tryPromise({
    try: () => browseWorkspaceDirectories(path, filter),
    catch: (cause) =>
      toError(
        HTTP_STATUS.BAD_REQUEST,
        formatUnknown(cause, "Failed to browse directories")
      ),
  });

const safeRegisterEffect = (body: {
  path: string;
  label?: string;
  activate?: boolean;
}) =>
  registerWorkspaceEffect(
    { path: body.path, label: body.label },
    { setActive: body.activate ?? false }
  ).pipe(
    Effect.map((workspace) => ({ workspace })),
    Effect.mapError((cause) =>
      toError(
        HTTP_STATUS.BAD_REQUEST,
        formatUnknown(cause, "Failed to register workspace")
      )
    )
  );

const safeActivateEffect = (id: string) =>
  activateWorkspaceEffect(id).pipe(
    Effect.flatMap((workspace) =>
      workspace
        ? Effect.succeed({ workspace })
        : Effect.fail(toError(HTTP_STATUS.NOT_FOUND, "Workspace not found"))
    ),
    Effect.mapError((cause) =>
      toError(
        HTTP_STATUS.BAD_REQUEST,
        formatUnknown(cause, "Failed to activate workspace")
      )
    )
  );

const safeUpdateEffect = (id: string, label: string) =>
  updateWorkspaceLabelEffect({ id, label }).pipe(
    Effect.flatMap((workspace) =>
      workspace
        ? Effect.succeed({ workspace })
        : Effect.fail(toError(HTTP_STATUS.NOT_FOUND, "Workspace not found"))
    ),
    Effect.mapError((cause) =>
      toError(
        HTTP_STATUS.BAD_REQUEST,
        formatUnknown(cause, "Failed to update workspace")
      )
    )
  );

const safeDeleteEffect = (id: string) =>
  Effect.tryPromise({
    try: () => removeWorkspaceCascade(id),
    catch: (cause) =>
      toError(
        HTTP_STATUS.BAD_REQUEST,
        formatUnknown(cause, "Failed to remove workspace")
      ),
  }).pipe(
    Effect.flatMap((result) =>
      result
        ? Effect.succeed(null)
        : Effect.fail(toError(HTTP_STATUS.NOT_FOUND, "Workspace not found"))
    )
  );

const safeAutoRegisterEffect = (body: { path: string; label?: string }) =>
  ensureWorkspaceRegisteredEffect(body.path, { label: body.label }).pipe(
    Effect.map((workspace) => ({ workspace })),
    Effect.mapError((cause) =>
      toError(
        HTTP_STATUS.BAD_REQUEST,
        formatUnknown(cause, "Failed to auto-register workspace")
      )
    )
  );

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
      const outcome = await runServerEffect(
        matchWorkspaceEffect(
          withRouteLogger(
            getWorkspaceRegistryEffect.pipe(
              Effect.mapError((cause) =>
                toError(
                  HTTP_STATUS.BAD_REQUEST,
                  formatUnknown(cause, "Failed to load workspaces")
                )
              )
            ),
            { route: "workspaces/list" }
          )
        )
      );
      set.status = outcome.status;
      return outcome.body;
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
      const outcome = await runServerEffect(
        matchWorkspaceEffect(
          withRouteLogger(safeBrowseEffect(query.path, query.filter), {
            route: "workspaces/browse",
            path: query.path ?? null,
          })
        )
      );
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
      const outcome = await runServerEffect(
        matchWorkspaceEffect(
          withRouteLogger(safeRegisterEffect(body), {
            route: "workspaces/register",
            path: body.path,
          }),
          HTTP_STATUS.CREATED
        )
      );
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
      const outcome = await runServerEffect(
        matchWorkspaceEffect(
          withRouteLogger(safeActivateEffect(params.id), {
            route: "workspaces/activate",
            id: params.id,
          })
        )
      );
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
      const outcome = await runServerEffect(
        matchWorkspaceEffect(
          withRouteLogger(safeUpdateEffect(params.id, body.label), {
            route: "workspaces/update",
            id: params.id,
          })
        )
      );
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
      const outcome = await runServerEffect(
        matchWorkspaceEffect(
          withRouteLogger(safeDeleteEffect(params.id), {
            route: "workspaces/delete",
            id: params.id,
          }),
          HTTP_STATUS.NO_CONTENT
        )
      );
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
      const outcome = await runServerEffect(
        matchWorkspaceEffect(
          withRouteLogger(safeAutoRegisterEffect(body), {
            route: "workspaces/auto-register",
            path: body.path,
          }),
          HTTP_STATUS.CREATED
        )
      );
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
