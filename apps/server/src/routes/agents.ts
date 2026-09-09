import { Elysia, sse, t } from "elysia";
import { subscribeAgentEvents } from "../agents/events";
import { loadOpencodeModelPreferences } from "../agents/opencode-config";
import {
  fetchAgentMessages,
  fetchAgentSession,
  fetchAgentSessionForCell,
  fetchPendingAgentInputEvents,
  fetchProviderCatalogForWorkspace,
  type ProviderCatalog,
} from "../agents/service";
import type { AgentSessionRecord, AgentStreamEvent } from "../agents/types";
import {
  AgentMessageListResponseSchema,
  AgentSessionByCellResponseSchema,
} from "../schema/api";
import { createAsyncEventIterator } from "../services/async-iterator";
import { createWorkspaceContextPlugin } from "../workspaces/plugin";

const HTTP_STATUS = {
  OK: 200,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
} as const;

const ProviderModelResponseSchema = t.Object({
  id: t.String(),
  name: t.String(),
  provider: t.String(),
  variants: t.Array(t.Object({ id: t.String() })),
});

const ProviderSummaryResponseSchema = t.Object({
  id: t.String(),
  name: t.Optional(t.String()),
});

const ProviderCatalogResponseSchema = t.Object({
  models: t.Array(ProviderModelResponseSchema),
  defaults: t.Record(t.String(), t.String()),
  stickyVariants: t.Record(t.String(), t.String()),
  providers: t.Array(ProviderSummaryResponseSchema),
});

const ProviderCatalogErrorResponseSchema = t.Composite([
  ProviderCatalogResponseSchema,
  t.Object({ message: t.String() }),
]);

const MessageResponseSchema = t.Object({ message: t.String() });

const ProviderCatalogRouteResponseSchema = {
  200: ProviderCatalogResponseSchema,
  400: ProviderCatalogErrorResponseSchema,
} as const;

const SessionRouteErrorResponseSchema = {
  400: MessageResponseSchema,
  404: MessageResponseSchema,
} as const;

const MODEL_LIST_ERROR_MESSAGE = "Failed to list models";

type AgentRouteError = { status: number; message: string };
type InputRequiredEvent = Extract<AgentStreamEvent, { type: "input_required" }>;

type ResponseStatusSetter = { status?: number | string };

const formatUnknown = (error: unknown, fallback: string) => {
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

const providerPayload = async (catalog: ProviderCatalog) => {
  const models = catalog.models
    .filter((model) => model.enabled)
    .map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.providerID,
      variants: model.variants.map((variant) => ({ id: variant.id })),
    }));
  const defaults = catalog.default
    ? { [catalog.default.providerID]: catalog.default.id }
    : {};
  const stickyVariants = filterStickyVariantsForModels(
    (await loadOpencodeModelPreferences()).stickyVariants,
    models
  );
  const providers = catalog.providers.map(({ id, name }) => ({ id, name }));
  return { models, defaults, providers, stickyVariants };
};

function filterStickyVariantsForModels(
  stickyVariants: Record<string, string>,
  models: Array<{ provider: string; id: string }>
) {
  const availableModelKeys = new Set(
    models.map((model) => `${model.provider}/${model.id}`)
  );

  return Object.fromEntries(
    Object.entries(stickyVariants).filter(([key]) =>
      availableModelKeys.has(key)
    )
  );
}

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

const setResponseStatus = (set: ResponseStatusSetter, status: number) => {
  set.status = status;
};

const providerRouteErrorPayload = (
  set: ResponseStatusSetter,
  error: unknown
) => {
  const routeError = asAgentRouteError(error, MODEL_LIST_ERROR_MESSAGE);
  setResponseStatus(set, routeError.status);
  return {
    models: [],
    defaults: {},
    providers: [],
    stickyVariants: {},
    message: routeError.message,
  };
};

const messageRouteErrorPayload = (
  set: ResponseStatusSetter,
  error: unknown,
  fallbackMessage: string
) => {
  const routeError = asAgentRouteError(error, fallbackMessage);
  setResponseStatus(set, routeError.status);
  return { message: routeError.message };
};

export const agentsRoutes = new Elysia({ prefix: "/api/agents" })
  .use(createWorkspaceContextPlugin())
  .get(
    "/models",
    async ({ query, set, getWorkspaceContext }) => {
      try {
        const context = await getWorkspaceContext(query.workspaceId);
        return await providerPayload(
          await fetchProviderCatalogForWorkspace(context.workspace.path)
        );
      } catch (error) {
        return providerRouteErrorPayload(set, error);
      }
    },
    {
      query: t.Object({
        workspaceId: t.Optional(t.String()),
      }),
      response: ProviderCatalogRouteResponseSchema,
    }
  )
  .get(
    "/sessions/:id/models",
    async ({ params, set }) => {
      try {
        const session = await fetchSessionOrThrow(
          params.id,
          MODEL_LIST_ERROR_MESSAGE
        );
        const catalog = await fetchProviderCatalogForWorkspace(
          session.workspacePath
        );
        return await providerPayload(catalog);
      } catch (error) {
        return providerRouteErrorPayload(set, error);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: ProviderCatalogRouteResponseSchema,
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
        setResponseStatus(set, HTTP_STATUS.OK);
        return { messages };
      } catch (error) {
        return messageRouteErrorPayload(set, error, "Failed to fetch messages");
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: AgentMessageListResponseSchema,
        ...SessionRouteErrorResponseSchema,
      },
    }
  )
  .get(
    "/sessions/byCell/:cellId",
    async ({ params, set }) => {
      try {
        const session = await fetchAgentSessionForCell(params.cellId);
        setResponseStatus(set, HTTP_STATUS.OK);
        return { session };
      } catch (error) {
        return messageRouteErrorPayload(set, error, "Failed to fetch session");
      }
    },
    {
      params: t.Object({ cellId: t.String() }),
      response: {
        200: AgentSessionByCellResponseSchema,
        ...SessionRouteErrorResponseSchema,
      },
    }
  )
  .get(
    "/sessions/:id/events",
    async ({ params, request, set }) => {
      const { iterator, cleanup } = createEventIterator(
        params.id,
        request.signal
      );
      let session: AgentSessionRecord;
      let pendingInputEvents: InputRequiredEvent[];
      try {
        session = await fetchSessionOrThrow(
          params.id,
          "Failed to fetch session"
        );
        pendingInputEvents = await fetchPendingAgentInputEvents(params.id);
      } catch (error) {
        cleanup();
        return messageRouteErrorPayload(set, error, "Failed to fetch session");
      }

      setResponseStatus(set, HTTP_STATUS.OK);
      return streamAgentEvents(session, pendingInputEvents, iterator);
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Any(),
        ...SessionRouteErrorResponseSchema,
      },
    }
  );

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

async function* streamAgentEvents(
  session: AgentSessionRecord,
  pendingInputEvents: InputRequiredEvent[],
  events: AsyncIterable<AgentStreamEvent>
) {
  const pendingInputIds = new Set(
    pendingInputEvents.map((event) => event.permissionId)
  );
  yield sse({ event: "status", data: { status: session.status } });
  const initialModeEvent = formatInitialModeSseEvent(session);
  if (initialModeEvent) {
    yield initialModeEvent;
  }
  for (const event of pendingInputEvents) {
    yield formatAgentStreamSseEvent(event);
  }

  for await (const event of events) {
    if (
      event.type === "input_required" &&
      pendingInputIds.delete(event.permissionId)
    ) {
      continue;
    }
    yield formatAgentStreamSseEvent(event);
  }
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

  return sse({
    event: "input_required",
    data: {
      sessionId: event.sessionId,
      permissionId: event.permissionId,
      title: event.title,
      kind: event.kind,
    },
  });
}

function createEventIterator(sessionId: string, signal: AbortSignal) {
  return createAsyncEventIterator<AgentStreamEvent>(
    (handler) => subscribeAgentEvents(sessionId, handler),
    signal
  );
}
