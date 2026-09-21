import { Elysia, sse, t } from "elysia";
import {
  subscribeAgentEvents,
  subscribeAllAgentEvents,
} from "../agents/events";
import { loadOpencodeModelPreferences } from "../agents/opencode-config";
import {
  cancelProviderCommand,
  cancelProviderOAuth,
  completeProviderOAuth,
  connectProviderKey,
  fetchProviderAuthCatalog,
  fetchProviderCommandStatus,
  fetchProviderOAuthStatus,
  startProviderCommand,
  startProviderOAuth,
} from "../agents/provider-auth";
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
import type { ResolveWorkspaceContext } from "../workspaces/context";
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
const ProviderAuthAnswerSchema = t.Record(
  t.String(),
  t.Union([t.String(), t.Number(), t.Boolean(), t.Array(t.String())])
);
const ProviderAuthNumberSchema = t.Union([
  t.Number(),
  t.Literal("Infinity"),
  t.Literal("-Infinity"),
  t.Literal("NaN"),
]);
const ProviderAuthFormFieldSchema = t.Object({
  key: t.String(),
  type: t.Union([
    t.Literal("string"),
    t.Literal("number"),
    t.Literal("integer"),
    t.Literal("boolean"),
    t.Literal("multiselect"),
    t.Literal("external"),
  ]),
  title: t.Optional(t.String()),
  description: t.Optional(t.String()),
  required: t.Optional(t.Boolean()),
  when: t.Optional(
    t.Array(
      t.Object({
        key: t.String(),
        op: t.Union([t.Literal("eq"), t.Literal("neq")]),
        value: t.Union([t.String(), t.Number(), t.Boolean()]),
      })
    )
  ),
  placeholder: t.Optional(t.String()),
  default: t.Optional(
    t.Union([t.String(), t.Number(), t.Boolean(), t.Array(t.String())])
  ),
  minimum: t.Optional(ProviderAuthNumberSchema),
  maximum: t.Optional(ProviderAuthNumberSchema),
  minLength: t.Optional(t.Number()),
  maxLength: t.Optional(t.Number()),
  minItems: t.Optional(t.Number()),
  maxItems: t.Optional(t.Number()),
  pattern: t.Optional(t.String()),
  format: t.Optional(
    t.Union([
      t.Literal("email"),
      t.Literal("uri"),
      t.Literal("date"),
      t.Literal("date-time"),
    ])
  ),
  custom: t.Optional(t.Boolean()),
  options: t.Optional(
    t.Array(
      t.Object({
        value: t.String(),
        label: t.String(),
        description: t.Optional(t.String()),
      })
    )
  ),
  url: t.Optional(t.String()),
});
const ProviderAuthCatalogResponseSchema = t.Object({
  integrations: t.Array(
    t.Object({
      id: t.String(),
      name: t.String(),
      connected: t.Boolean(),
      connectionLabels: t.Array(t.String()),
      methods: t.Array(
        t.Object({
          type: t.Union([
            t.Literal("key"),
            t.Literal("oauth"),
            t.Literal("command"),
            t.Literal("env"),
          ]),
          id: t.Optional(t.String()),
          label: t.String(),
          fields: t.Array(ProviderAuthFormFieldSchema),
          environmentVariables: t.Optional(t.Array(t.String())),
        })
      ),
    })
  ),
  providers: t.Array(
    t.Object({
      id: t.String(),
      name: t.String(),
      integrationId: t.Union([t.String(), t.Null()]),
      state: t.Union([
        t.Literal("connected"),
        t.Literal("missing"),
        t.Literal("not_required"),
      ]),
    })
  ),
});
const ProviderAuthMutationResponseSchema = t.Object({ ok: t.Literal(true) });
const ProviderOAuthStartResponseSchema = t.Object({
  attemptId: t.String(),
  url: t.String(),
  instructions: t.String(),
  mode: t.Union([t.Literal("auto"), t.Literal("code")]),
  expiresAt: t.Union([t.Number(), t.Null()]),
});
const ProviderOAuthStatusResponseSchema = t.Object({
  status: t.Union([
    t.Literal("pending"),
    t.Literal("complete"),
    t.Literal("failed"),
    t.Literal("expired"),
  ]),
  message: t.Optional(t.String()),
});
const ProviderCommandStartResponseSchema = t.Object({
  attemptId: t.String(),
  expiresAt: t.Union([t.Number(), t.Null()]),
});
const WorkspaceQuerySchema = t.Object({ workspaceId: t.Optional(t.String()) });
const IntegrationParamsSchema = t.Object({ integrationId: t.String() });
const ProviderMethodBodySchema = t.Object({
  workspaceId: t.Optional(t.String()),
  methodId: t.String({ minLength: 1 }),
  label: t.Optional(t.String()),
  answer: t.Optional(ProviderAuthAnswerSchema),
});
const ProviderAttemptParamsSchema = t.Object({
  integrationId: t.String(),
  attemptId: t.String(),
});
const ProviderAuthMutationRouteResponse = {
  200: ProviderAuthMutationResponseSchema,
  400: MessageResponseSchema,
} as const;
const ProviderAttemptStatusRouteOptions = {
  params: ProviderAttemptParamsSchema,
  query: WorkspaceQuerySchema,
  response: {
    200: ProviderOAuthStatusResponseSchema,
    400: MessageResponseSchema,
  },
} as const;
const ProviderAttemptCancelRouteOptions = {
  params: ProviderAttemptParamsSchema,
  query: WorkspaceQuerySchema,
  response: ProviderAuthMutationRouteResponse,
} as const;
const providerMethodRouteOptions = <T>(successResponse: T) => ({
  params: IntegrationParamsSchema,
  body: ProviderMethodBodySchema,
  response: {
    200: successResponse,
    400: MessageResponseSchema,
  },
});

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
type ProviderAuthRouteContext = {
  set: ResponseStatusSetter;
  getWorkspaceContext: ResolveWorkspaceContext;
  sensitiveValues?: unknown[];
};

const formatUnknown = (error: unknown, fallback: string) => {
  if (typeof error === "string") {
    return error || fallback;
  }
  const message =
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : undefined;
  return message || fallback;
};

function collectSensitiveStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return value ? [value] : [];
  }
  if (typeof value === "number") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectSensitiveStrings);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectSensitiveStrings);
  }
  return [];
}

const redactSensitiveValues = (message: string, values: unknown[]) =>
  values
    .flatMap(collectSensitiveStrings)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (redacted, value) => redacted.replaceAll(value, "[REDACTED]"),
      message
    );

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
  fallbackMessage: string,
  sensitiveValues: unknown[] = []
) => {
  const routeError = asAgentRouteError(error, fallbackMessage);
  setResponseStatus(set, routeError.status);
  return {
    message: redactSensitiveValues(routeError.message, sensitiveValues),
  };
};

async function providerAuthRoute<T>(
  route: ProviderAuthRouteContext,
  workspaceId: string | undefined,
  fallbackMessage: string,
  run: (workspacePath: string) => Promise<T>
) {
  try {
    const context = await route.getWorkspaceContext(workspaceId);
    return await run(context.workspace.path);
  } catch (error) {
    return messageRouteErrorPayload(
      route.set,
      error,
      fallbackMessage,
      route.sensitiveValues
    );
  }
}

const optionalConnectionAnswers = (body: {
  answer?: Record<string, string | number | boolean | string[]>;
  label?: string;
}) => ({
  ...(body.answer ? { answer: body.answer } : {}),
  ...(body.label ? { label: body.label } : {}),
});

const providerAttempt = (
  workspacePath: string,
  params: { integrationId: string; attemptId: string }
) => ({
  workspacePath,
  integrationId: params.integrationId,
  attemptId: params.attemptId,
});

type ProviderAttemptInput = ReturnType<typeof providerAttempt>;
type ProviderAttemptStatus = {
  status: "pending" | "complete" | "failed" | "expired";
  message?: string;
};

const expiresAt = (expires: number | string) =>
  typeof expires === "number" ? expires : null;

function providerAttemptStatusPayload(status: ProviderAttemptStatus) {
  return {
    status: status.status,
    ...(status.message ? { message: status.message } : {}),
  };
}

type ProviderAttemptRouteContext = ProviderAuthRouteContext & {
  query: { workspaceId?: string };
  params: { integrationId: string; attemptId: string };
};

function createProviderAttemptHandler<T>(options: {
  fallbackMessage: string;
  run: (input: ProviderAttemptInput) => Promise<T>;
}) {
  return ({
    query,
    params,
    set,
    getWorkspaceContext,
  }: ProviderAttemptRouteContext) =>
    providerAuthRoute(
      { set, getWorkspaceContext },
      query.workspaceId,
      options.fallbackMessage,
      (workspacePath) => options.run(providerAttempt(workspacePath, params))
    );
}

export const agentsRoutes = new Elysia({ prefix: "/api/agents" })
  .use(createWorkspaceContextPlugin())
  .get("/events", ({ request }) => {
    const { iterator, cleanup } = createGlobalEventIterator(request.signal);

    async function* stream() {
      try {
        yield sse({ event: "ready", data: { timestamp: Date.now() } });
        for await (const { sessionId, event } of iterator) {
          yield formatAgentStreamSseEvent(event, sessionId);
        }
      } finally {
        cleanup();
      }
    }

    return stream();
  })
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
    "/integrations",
    ({ query, set, getWorkspaceContext }) =>
      providerAuthRoute(
        { set, getWorkspaceContext },
        query.workspaceId,
        "Failed to load provider connections",
        fetchProviderAuthCatalog
      ),
    {
      query: WorkspaceQuerySchema,
      response: {
        200: ProviderAuthCatalogResponseSchema,
        400: MessageResponseSchema,
      },
    }
  )
  .post(
    "/integrations/:integrationId/key",
    ({ body, params, set, getWorkspaceContext }) =>
      providerAuthRoute(
        {
          set,
          getWorkspaceContext,
          sensitiveValues: [body.key, body.answer],
        },
        body.workspaceId,
        "Failed to connect provider",
        async (workspacePath) => {
          await connectProviderKey({
            workspacePath,
            integrationId: params.integrationId,
            key: body.key,
            ...optionalConnectionAnswers(body),
          });
          return { ok: true as const };
        }
      ),
    {
      params: IntegrationParamsSchema,
      body: t.Object({
        workspaceId: t.Optional(t.String()),
        key: t.String({ minLength: 1 }),
        label: t.Optional(t.String()),
        answer: t.Optional(ProviderAuthAnswerSchema),
      }),
      response: ProviderAuthMutationRouteResponse,
    }
  )
  .post(
    "/integrations/:integrationId/oauth",
    ({ body, params, set, getWorkspaceContext }) =>
      providerAuthRoute(
        {
          set,
          getWorkspaceContext,
          sensitiveValues: [body.answer],
        },
        body.workspaceId,
        "Failed to start provider authentication",
        async (workspacePath) => {
          const result = await startProviderOAuth({
            workspacePath,
            integrationId: params.integrationId,
            methodId: body.methodId,
            ...optionalConnectionAnswers(body),
          });
          return {
            attemptId: result.data.attemptID,
            url: result.data.url,
            instructions: result.data.instructions,
            mode: result.data.mode,
            expiresAt: expiresAt(result.data.time.expires),
          };
        }
      ),
    providerMethodRouteOptions(ProviderOAuthStartResponseSchema)
  )
  .get(
    "/integrations/:integrationId/oauth/:attemptId",
    createProviderAttemptHandler({
      fallbackMessage: "Failed to check provider authentication",
      run: async (input) => {
        const result = await fetchProviderOAuthStatus(input);
        return providerAttemptStatusPayload(result.data);
      },
    }),
    ProviderAttemptStatusRouteOptions
  )
  .post(
    "/integrations/:integrationId/oauth/:attemptId/complete",
    ({ body, params, set, getWorkspaceContext }) =>
      providerAuthRoute(
        {
          set,
          getWorkspaceContext,
          sensitiveValues: [body.code],
        },
        body.workspaceId,
        "Failed to complete provider authentication",
        async (workspacePath) => {
          await completeProviderOAuth({
            ...providerAttempt(workspacePath, params),
            ...(body.code ? { code: body.code } : {}),
          });
          return { ok: true as const };
        }
      ),
    {
      params: ProviderAttemptParamsSchema,
      body: t.Object({
        workspaceId: t.Optional(t.String()),
        code: t.Optional(t.String()),
      }),
      response: ProviderAuthMutationRouteResponse,
    }
  )
  .delete(
    "/integrations/:integrationId/oauth/:attemptId",
    createProviderAttemptHandler({
      fallbackMessage: "Failed to cancel provider authentication",
      run: async (input) => {
        await cancelProviderOAuth(input);
        return { ok: true as const };
      },
    }),
    ProviderAttemptCancelRouteOptions
  )
  .post(
    "/integrations/:integrationId/command",
    ({ body, params, set, getWorkspaceContext }) =>
      providerAuthRoute(
        { set, getWorkspaceContext },
        body.workspaceId,
        "Failed to start provider connection command",
        async (workspacePath) => {
          const result = await startProviderCommand({
            workspacePath,
            integrationId: params.integrationId,
            methodId: body.methodId,
            ...(body.label ? { label: body.label } : {}),
          });
          return {
            attemptId: result.data.attemptID,
            expiresAt: expiresAt(result.data.time.expires),
          };
        }
      ),
    providerMethodRouteOptions(ProviderCommandStartResponseSchema)
  )
  .get(
    "/integrations/:integrationId/command/:attemptId",
    createProviderAttemptHandler({
      fallbackMessage: "Failed to check provider connection command",
      run: async (input) => {
        const result = await fetchProviderCommandStatus(input);
        return providerAttemptStatusPayload(result.data);
      },
    }),
    ProviderAttemptStatusRouteOptions
  )
  .delete(
    "/integrations/:integrationId/command/:attemptId",
    createProviderAttemptHandler({
      fallbackMessage: "Failed to cancel provider connection command",
      run: async (input) => {
        await cancelProviderCommand(input);
        return { ok: true as const };
      },
    }),
    ProviderAttemptCancelRouteOptions
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
  yield sse({
    event: "status",
    data: {
      status: session.status,
      ...(session.errorMessage ? { error: session.errorMessage } : {}),
    },
  });
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

function formatAgentStreamSseEvent(
  event: AgentStreamEvent,
  globalSessionId?: string
) {
  if (event.type === "status") {
    return sse({
      event: "status",
      data: {
        ...(globalSessionId ? { sessionId: globalSessionId } : {}),
        status: event.status,
        ...(event.error ? { error: event.error } : {}),
      },
    });
  }

  if (event.type === "mode") {
    return sse({
      event: "mode",
      data: {
        ...(globalSessionId ? { sessionId: globalSessionId } : {}),
        startMode: event.startMode,
        currentMode: event.currentMode,
        ...(event.modeUpdatedAt ? { modeUpdatedAt: event.modeUpdatedAt } : {}),
      },
    });
  }

  return sse({
    event: "input_required",
    data: {
      sessionId: globalSessionId ?? event.sessionId,
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

function createGlobalEventIterator(signal: AbortSignal) {
  return createAsyncEventIterator<{
    sessionId: string;
    event: AgentStreamEvent;
  }>(
    (handler) =>
      subscribeAllAgentEvents((sessionId, event) =>
        handler({ sessionId, event })
      ),
    signal
  );
}
