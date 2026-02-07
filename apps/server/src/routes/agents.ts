import { Effect } from "effect";
import { Elysia, sse, t } from "elysia";
import { subscribeAgentEvents } from "../agents/events";
import {
  type AgentRuntimeService,
  AgentRuntimeServiceTag,
  type ProviderEntry,
  type ProviderModel,
} from "../agents/service";
import type { AgentSessionRecord, AgentStreamEvent } from "../agents/types";
import { LoggerService } from "../logger";
import { runServerEffect } from "../runtime";
import { AgentSessionByCellResponseSchema } from "../schema/api";
import { createWorkspaceContextPlugin } from "../workspaces/plugin";

const HTTP_STATUS = {
  OK: 200,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
} as const;

type AgentRouteError = { status: number; message: string };

type WorkspaceContextFetcher = (workspaceId?: string) => Promise<{
  workspace: { path: string };
}>;

const formatUnknown = (error: unknown, fallback: string) => {
  if (error && typeof error === "object") {
    const { cause } = error as { cause?: unknown };
    if (cause instanceof Error) {
      return cause.message;
    }
    if (typeof cause === "string") {
      return cause;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return fallback;
};

const toError = (status: number, message: string): AgentRouteError => ({
  status,
  message,
});

const mapAgentError =
  (message: string) =>
  (cause: unknown): AgentRouteError =>
    toError(HTTP_STATUS.BAD_REQUEST, formatUnknown(cause, message));

const matchAgentEffect = <A, R>(
  effect: Effect.Effect<A, AgentRouteError, R>,
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

const withAgentRuntime = <A>(
  selector: (service: AgentRuntimeService) => Effect.Effect<A, unknown>,
  message: string
) =>
  AgentRuntimeServiceTag.pipe(
    Effect.flatMap(selector),
    Effect.mapError(mapAgentError(message))
  );

const workspaceContextEffect = (
  getWorkspaceContext: WorkspaceContextFetcher,
  workspaceId: string | undefined,
  message: string
) =>
  Effect.tryPromise({
    try: () => getWorkspaceContext(workspaceId),
    catch: mapAgentError(message),
  });

const providerEntriesEffect = (
  getWorkspaceContext: WorkspaceContextFetcher,
  workspaceId: string | undefined
) =>
  workspaceContextEffect(
    getWorkspaceContext,
    workspaceId,
    "Failed to resolve workspace"
  ).pipe(
    Effect.flatMap((workspaceContext) =>
      withAgentRuntime(
        (agentRuntime) =>
          agentRuntime.fetchProviderCatalogForWorkspace(
            workspaceContext.workspace.path
          ),
        "Failed to list models"
      ).pipe(Effect.map((catalog) => ({ catalog })))
    )
  );

const fetchSessionEffect = (id: string, message: string) =>
  withAgentRuntime(
    (agentRuntime) => agentRuntime.fetchAgentSession(id),
    message
  ).pipe(
    Effect.flatMap((session) =>
      session
        ? Effect.succeed(session)
        : Effect.fail(toError(HTTP_STATUS.NOT_FOUND, "Agent session not found"))
    )
  );

const providerPayload = (catalog: unknown) => {
  const providerEntries = normalizeProviderEntries(
    (catalog as { providers?: unknown }).providers
  );
  const models = flattenProviderModels(providerEntries);
  const defaults = normalizeProviderDefaults(
    (catalog as { default?: Record<string, string> }).default ?? {}
  );
  const providers = providerEntries.map(({ id, name }) =>
    name ? { id, name } : { id }
  );
  return { models, defaults, providers };
};

export const agentsRoutes = new Elysia({ prefix: "/api/agents" })
  .use(createWorkspaceContextPlugin())
  .get(
    "/models",
    async ({ query, set, getWorkspaceContext }) => {
      const outcome = await runServerEffect(
        Effect.match(
          withRouteLogger(
            providerEntriesEffect(getWorkspaceContext, query.workspaceId),
            { route: "agents/models", workspaceId: query.workspaceId ?? null }
          ).pipe(Effect.map(({ catalog }) => providerPayload(catalog))),
          {
            onFailure: (error) => ({
              status: error.status,
              body: {
                models: [],
                defaults: {},
                providers: [],
                message: error.message,
              },
            }),
            onSuccess: (value) => ({ status: HTTP_STATUS.OK, body: value }),
          }
        )
      );

      set.status = outcome.status;
      return outcome.body;
    },
    {
      query: t.Object({
        workspaceId: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          models: t.Array(
            t.Object({
              id: t.String(),
              name: t.String(),
              provider: t.String(),
            })
          ),
          defaults: t.Record(t.String(), t.String()),
          providers: t.Array(
            t.Object({ id: t.String(), name: t.Optional(t.String()) })
          ),
        }),
        400: t.Object({
          models: t.Array(
            t.Object({
              id: t.String(),
              name: t.String(),
              provider: t.String(),
            })
          ),
          defaults: t.Record(t.String(), t.String()),
          providers: t.Array(
            t.Object({ id: t.String(), name: t.Optional(t.String()) })
          ),
          message: t.String(),
        }),
      },
    }
  )
  .get(
    "/sessions/:id/models",
    async ({ params, set }) => {
      const outcome = await runServerEffect(
        Effect.match(
          withRouteLogger(
            fetchSessionEffect(params.id, "Failed to list models").pipe(
              Effect.flatMap((session) =>
                withAgentRuntime(
                  (agentRuntime) =>
                    agentRuntime.fetchProviderCatalogForWorkspace(
                      session.workspacePath
                    ),
                  "Failed to list models"
                )
              ),
              Effect.map((catalog) => providerPayload(catalog))
            ),
            { route: "agents/session-models", sessionId: params.id }
          ),
          {
            onFailure: (error) => ({
              status: error.status,
              body: {
                models: [],
                defaults: {},
                providers: [],
                message: error.message,
              },
            }),
            onSuccess: (value) => ({ status: HTTP_STATUS.OK, body: value }),
          }
        )
      );

      set.status = outcome.status;
      return outcome.body;
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({
          models: t.Array(
            t.Object({
              id: t.String(),
              name: t.String(),
              provider: t.String(),
            })
          ),
          defaults: t.Record(t.String(), t.String()),
          providers: t.Array(
            t.Object({ id: t.String(), name: t.Optional(t.String()) })
          ),
        }),
        400: t.Object({
          models: t.Array(
            t.Object({
              id: t.String(),
              name: t.String(),
              provider: t.String(),
            })
          ),
          defaults: t.Record(t.String(), t.String()),
          providers: t.Array(
            t.Object({ id: t.String(), name: t.Optional(t.String()) })
          ),
          message: t.String(),
        }),
      },
    }
  )
  .get(
    "/sessions/byCell/:cellId",
    async ({ params, set }) => {
      const outcome = await runServerEffect(
        matchAgentEffect(
          withRouteLogger(
            withAgentRuntime(
              (agentRuntime) =>
                agentRuntime.fetchAgentSessionForCell(params.cellId),
              "Failed to fetch session"
            ).pipe(
              Effect.map((session) => ({
                session: session ? formatSession(session) : null,
              }))
            ),
            { route: "agents/session-by-cell", cellId: params.cellId }
          )
        )
      );

      set.status = outcome.status;
      return outcome.body;
    },
    {
      params: t.Object({ cellId: t.String() }),
      response: {
        200: AgentSessionByCellResponseSchema,
        400: t.Object({ message: t.String() }),
        404: t.Object({ message: t.String() }),
      },
    }
  )
  .get(
    "/sessions/:id/events",
    async ({ params, request, set }) => {
      const outcome = await runServerEffect(
        matchAgentEffect(
          withRouteLogger(
            fetchSessionEffect(params.id, "Failed to fetch session"),
            { route: "agents/events", sessionId: params.id }
          )
        )
      );

      set.status = outcome.status;

      if (outcome.status !== HTTP_STATUS.OK) {
        return outcome.body;
      }

      const session = outcome.body as AgentSessionRecord;
      const { iterator } = createEventIterator(params.id, request.signal);

      async function* stream() {
        yield sse({ event: "status", data: { status: session.status } });

        for await (const event of iterator) {
          if (event.type !== "status") {
            continue;
          }

          yield sse({
            event: "status",
            data: {
              status: event.status,
              ...(event.error ? { error: event.error } : {}),
            },
          });
        }
      }

      return stream();
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Any(),
        400: t.Object({ message: t.String() }),
        404: t.Object({ message: t.String() }),
      },
    }
  );

function normalizeProviderEntries(input: unknown): ProviderEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const providers: ProviderEntry[] = [];
  for (const candidate of input) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof (candidate as { id?: unknown }).id !== "string"
    ) {
      continue;
    }

    const { id, name, models } = candidate as {
      id: string;
      name?: string;
      models?: Record<string, ProviderModel>;
    };
    const providerEntry: ProviderEntry = { id };
    if (name) {
      providerEntry.name = name;
    }
    if (models) {
      providerEntry.models = models;
    }
    providers.push(providerEntry);
  }

  return providers;
}

function flattenProviderModels(providers: ProviderEntry[]) {
  const models: { id: string; name: string; provider: string }[] = [];

  for (const provider of providers) {
    const providerModels = provider.models ?? {};
    for (const [modelKey, model] of Object.entries(providerModels)) {
      const id = model?.id ?? modelKey;
      const name = model?.name ?? id;
      models.push({ id, name, provider: provider.id });
    }
  }

  return models;
}

function normalizeProviderDefaults(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const defaults: Record<string, string> = {};
  for (const [providerId, modelId] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (typeof modelId === "string") {
      defaults[providerId] = modelId;
    }
  }
  return defaults;
}

function formatSession(session: AgentSessionRecord) {
  return {
    id: session.id,
    cellId: session.cellId,
    templateId: session.templateId,
    provider: session.provider,
    status: session.status,
    workspacePath: session.workspacePath,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.completedAt ? { completedAt: session.completedAt } : {}),
    ...(session.modelId ? { modelId: session.modelId } : {}),
    ...(session.modelProviderId
      ? { modelProviderId: session.modelProviderId }
      : {}),
  };
}

function createEventIterator(sessionId: string, signal: AbortSignal) {
  const queue: AgentStreamEvent[] = [];
  let resolver: ((value: AgentStreamEvent | null) => void) | null = null;
  let finished = false;

  const unsubscribe = subscribeAgentEvents(sessionId, (event) => {
    if (resolver) {
      resolver(event);
      resolver = null;
    } else {
      queue.push(event);
    }
  });

  const cleanup = () => {
    if (finished) {
      return;
    }
    finished = true;
    unsubscribe();
    signal.removeEventListener("abort", cleanup);
    if (resolver) {
      resolver(null);
      resolver = null;
    }
  };

  signal.addEventListener("abort", cleanup, { once: true });

  const iterator = {
    async *[Symbol.asyncIterator]() {
      try {
        while (!finished) {
          if (queue.length) {
            const queued = queue.shift();
            if (queued) {
              yield queued;
              continue;
            }
          }

          const nextEvent = await new Promise<AgentStreamEvent | null>(
            (resolve) => {
              resolver = resolve;
            }
          );

          if (!nextEvent) {
            break;
          }

          yield nextEvent;
        }
      } finally {
        cleanup();
      }
    },
  } satisfies AsyncIterable<AgentStreamEvent>;

  return { iterator, cleanup };
}
