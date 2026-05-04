import { Elysia, sse, t } from "elysia";
import { subscribeAgentEvents } from "../agents/events";
import { loadOpencodeModelPreferences } from "../agents/opencode-config";
import { normalizeProviderDefaults } from "../agents/provider-defaults";
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

type ResponseStatusSetter = { status?: number | string };

type InputRequiredProperties = {
  id?: string;
  sessionID?: string;
  permission?: string;
  questions?: Array<{ question?: string }>;
};

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

const providerPayload = async (catalog: unknown) => {
  const providerEntries = normalizeProviderEntries(
    (catalog as { providers?: unknown }).providers
  );
  const models = flattenProviderModels(providerEntries);
  const defaults = normalizeProviderDefaults(
    (catalog as { default?: Record<string, string> }).default ?? {}
  );
  const stickyVariants = filterStickyVariantsForModels(
    (await loadOpencodeModelPreferences()).stickyVariants,
    models
  );
  const providers = providerEntries.map(({ id, name }) =>
    name ? { id, name } : { id }
  );
  return { models, defaults, providers, stickyVariants };
};

const emptyProviderPayload = (message: string) => ({
  models: [],
  defaults: {},
  providers: [],
  stickyVariants: {},
  message,
});

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

const setResponseStatus = (set: ResponseStatusSetter, status: number) => {
  set.status = status;
};

const providerRouteErrorPayload = (
  set: ResponseStatusSetter,
  error: unknown
) => {
  const routeError = asAgentRouteError(error, MODEL_LIST_ERROR_MESSAGE);
  setResponseStatus(set, routeError.status);
  return emptyProviderPayload(routeError.message);
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

const fetchSessionProviderPayload = async (id: string) => {
  const session = await fetchSessionOrThrow(id, MODEL_LIST_ERROR_MESSAGE);
  const catalog = await fetchProviderCatalogForWorkspace(session.workspacePath);
  return await providerPayload(catalog);
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
        setResponseStatus(set, HTTP_STATUS.OK);
        return await providerPayload(catalog);
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
        const payload = await fetchSessionProviderPayload(params.id);
        setResponseStatus(set, HTTP_STATUS.OK);
        return payload;
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
        return { session: session ? formatSession(session) : null };
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
      let session: AgentSessionRecord;
      try {
        session = await fetchSessionOrThrow(
          params.id,
          "Failed to fetch session"
        );
      } catch (error) {
        return messageRouteErrorPayload(set, error, "Failed to fetch session");
      }

      setResponseStatus(set, HTTP_STATUS.OK);

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
        ...SessionRouteErrorResponseSchema,
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
  const models: {
    id: string;
    name: string;
    provider: string;
    variants: Array<{ id: string }>;
  }[] = [];

  for (const provider of providers) {
    const providerModels = provider.models ?? {};
    for (const [modelKey, model] of Object.entries(providerModels)) {
      const id = model?.id ?? modelKey;
      const name = model?.name ?? id;
      const variants = Object.entries(model?.variants ?? {})
        .filter(([, variant]) => !variant?.disabled)
        .map(([variantId]) => ({ id: variantId }));
      models.push({ id, name, provider: provider.id, variants });
    }
  }

  return models;
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

function formatInputRequiredPropertiesSseEvent(
  properties: InputRequiredProperties | undefined,
  title: string,
  kind: "permission" | "question"
) {
  return sse({
    event: "input_required",
    data: {
      sessionId: properties?.sessionID ?? "",
      permissionId: properties?.id ?? "",
      title,
      kind,
    },
  });
}

function formatInputRequiredSseEvent(event: AgentStreamEvent) {
  const rawType = (event as { type: string }).type;

  if (rawType === "permission.asked" || rawType === "permission.updated") {
    const properties = (event as { properties?: InputRequiredProperties })
      .properties;
    return formatInputRequiredPropertiesSseEvent(
      properties,
      properties?.permission ?? "Input required",
      "permission"
    );
  }

  if (rawType === "question.asked") {
    const properties = (event as { properties?: InputRequiredProperties })
      .properties;
    const firstQuestion = properties?.questions?.[0]?.question;
    return formatInputRequiredPropertiesSseEvent(
      properties,
      typeof firstQuestion === "string" && firstQuestion.length > 0
        ? firstQuestion
        : "Input required",
      "question"
    );
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
  return createAsyncEventIterator<AgentStreamEvent>(
    (handler) => subscribeAgentEvents(sessionId, handler),
    signal
  );
}
