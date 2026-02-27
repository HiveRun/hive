import { Elysia, sse, t } from "elysia";
import { subscribeAgentEvents } from "../agents/events";
import {
  fetchAgentMessages,
  fetchAgentSession,
  fetchAgentSessionForCell,
  fetchProviderCatalogForWorkspace,
  type ProviderEntry,
  type ProviderModel,
} from "../agents/service";
import type { AgentSessionRecord, AgentStreamEvent } from "../agents/types";
import {
  AgentMessageListResponseSchema,
  AgentSessionByCellResponseSchema,
} from "../schema/api";
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

const mapAgentError = (message: string, cause: unknown): AgentRouteError =>
  toError(HTTP_STATUS.BAD_REQUEST, formatUnknown(cause, message));

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

const emptyProviderPayload = (message: string) => ({
  models: [],
  defaults: {},
  providers: [],
  message,
});

const resolveWorkspaceCatalog = async (
  getWorkspaceContext: WorkspaceContextFetcher,
  workspaceId: string | undefined
) => {
  const context = await getWorkspaceContext(workspaceId);
  return await fetchProviderCatalogForWorkspace(context.workspace.path);
};

const fetchSessionOrThrow = async (
  id: string,
  message: string
): Promise<AgentSessionRecord> => {
  try {
    const session = await fetchAgentSession(id);
    if (!session) {
      throw toError(HTTP_STATUS.NOT_FOUND, "Agent session not found");
    }
    return session;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in (error as { status?: unknown }) &&
      "message" in (error as { message?: unknown })
    ) {
      throw error as AgentRouteError;
    }
    throw mapAgentError(message, error);
  }
};

const asAgentRouteError = (
  error: unknown,
  fallbackMessage: string
): AgentRouteError => {
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { status?: unknown }).status === "number" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return error as AgentRouteError;
  }

  return mapAgentError(fallbackMessage, error);
};

export const agentsRoutes = new Elysia({ prefix: "/api/agents" })
  .use(createWorkspaceContextPlugin())
  .get(
    "/models",
    async ({ query, set, getWorkspaceContext }) => {
      try {
        const catalog = await resolveWorkspaceCatalog(
          getWorkspaceContext,
          query.workspaceId
        );
        set.status = HTTP_STATUS.OK;
        return providerPayload(catalog);
      } catch (error) {
        const routeError = asAgentRouteError(error, "Failed to list models");
        set.status = routeError.status;
        return emptyProviderPayload(routeError.message);
      }
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
      try {
        const session = await fetchSessionOrThrow(
          params.id,
          "Failed to list models"
        );
        const catalog = await fetchProviderCatalogForWorkspace(
          session.workspacePath
        );
        set.status = HTTP_STATUS.OK;
        return providerPayload(catalog);
      } catch (error) {
        const routeError = asAgentRouteError(error, "Failed to list models");
        set.status = routeError.status;
        return emptyProviderPayload(routeError.message);
      }
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
    "/sessions/:id/messages",
    async ({ params, set }) => {
      try {
        const session = await fetchSessionOrThrow(
          params.id,
          "Failed to fetch session"
        );
        const messages = await fetchAgentMessages(session.id);
        set.status = HTTP_STATUS.OK;
        return { messages };
      } catch (error) {
        const routeError = asAgentRouteError(error, "Failed to fetch messages");
        set.status = routeError.status;
        return { message: routeError.message };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: AgentMessageListResponseSchema,
        400: t.Object({ message: t.String() }),
        404: t.Object({ message: t.String() }),
      },
    }
  )
  .get(
    "/sessions/byCell/:cellId",
    async ({ params, set }) => {
      try {
        const session = await fetchAgentSessionForCell(params.cellId);
        set.status = HTTP_STATUS.OK;
        return { session: session ? formatSession(session) : null };
      } catch (error) {
        const routeError = asAgentRouteError(error, "Failed to fetch session");
        set.status = routeError.status;
        return { message: routeError.message };
      }
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
      let session: AgentSessionRecord;
      try {
        session = await fetchSessionOrThrow(
          params.id,
          "Failed to fetch session"
        );
      } catch (error) {
        const routeError = asAgentRouteError(error, "Failed to fetch session");
        set.status = routeError.status;
        return { message: routeError.message };
      }

      set.status = HTTP_STATUS.OK;

      const { iterator } = createEventIterator(params.id, request.signal);

      async function* stream() {
        yield sse({ event: "status", data: { status: session.status } });
        const initialModeEvent = formatInitialModeSseEvent(session);
        if (initialModeEvent) {
          yield initialModeEvent;
        }

        for await (const event of iterator) {
          const nextEvent = formatAgentStreamSseEvent(event);
          if (nextEvent) {
            yield nextEvent;
          }
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

function formatInitialModeSseEvent(session: AgentSessionRecord) {
  if (!(session.startMode && session.currentMode)) {
    return null;
  }

  return sse({
    event: "mode",
    data: {
      startMode: session.startMode,
      currentMode: session.currentMode,
      ...(session.modeUpdatedAt
        ? { modeUpdatedAt: session.modeUpdatedAt }
        : {}),
    },
  });
}

function formatInputRequiredSseEvent(event: AgentStreamEvent) {
  const rawType = (event as { type: string }).type;

  if (rawType === "permission.asked" || rawType === "permission.updated") {
    const properties = (
      event as {
        properties?: {
          sessionID?: string;
          id?: string;
          permission?: string;
        };
      }
    ).properties;
    return sse({
      event: "input_required",
      data: {
        sessionId: properties?.sessionID ?? "",
        permissionId: properties?.id ?? "",
        title: properties?.permission ?? "Input required",
        kind: "permission",
      },
    });
  }

  if (rawType === "question.asked") {
    const properties = (
      event as {
        properties?: {
          id?: string;
          sessionID?: string;
          questions?: Array<{ question?: string }>;
        };
      }
    ).properties;
    const firstQuestion = properties?.questions?.[0]?.question;
    return sse({
      event: "input_required",
      data: {
        sessionId: properties?.sessionID ?? "",
        permissionId: properties?.id ?? "",
        title:
          typeof firstQuestion === "string" && firstQuestion.length > 0
            ? firstQuestion
            : "Input required",
        kind: "question",
      },
    });
  }

  return null;
}

function formatAgentStreamSseEvent(event: AgentStreamEvent) {
  if (event.type === "status") {
    return sse({
      event: "status",
      data: {
        status: event.status,
        ...(event.error ? { error: event.error } : {}),
      },
    });
  }

  if (event.type === "mode") {
    return sse({
      event: "mode",
      data: {
        startMode: event.startMode,
        currentMode: event.currentMode,
        ...(event.modeUpdatedAt ? { modeUpdatedAt: event.modeUpdatedAt } : {}),
      },
    });
  }

  const inputRequiredEvent = formatInputRequiredSseEvent(event);
  if (inputRequiredEvent) {
    return inputRequiredEvent;
  }

  return null;
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
    ...(session.startMode ? { startMode: session.startMode } : {}),
    ...(session.currentMode ? { currentMode: session.currentMode } : {}),
    ...(session.modeUpdatedAt ? { modeUpdatedAt: session.modeUpdatedAt } : {}),
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
