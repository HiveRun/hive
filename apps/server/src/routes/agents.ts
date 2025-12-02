import { Effect } from "effect";
import { Elysia, sse, t } from "elysia";
import { subscribeAgentEvents } from "../agents/events";
import {
  type AgentRuntimeService,
  AgentRuntimeServiceTag,
  type ProviderEntry,
  type ProviderModel,
} from "../agents/service";
import type {
  AgentMessageRecord,
  AgentSessionRecord,
  AgentStreamEvent,
} from "../agents/types";
import { runServerEffect } from "../runtime";
import {
  AgentMessageListResponseSchema,
  AgentSessionByCellResponseSchema,
  AgentSessionSchema,
  CreateAgentSessionSchema,
  RespondPermissionSchema,
  SendAgentMessageSchema,
} from "../schema/api";
import { createWorkspaceContextPlugin } from "../workspaces/plugin";

const HTTP_STATUS = {
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  INTERNAL_ERROR: 500,
} as const;

const runAgentEffect = <A>(
  selector: (service: AgentRuntimeService) => Effect.Effect<A, unknown>
) =>
  runServerEffect(
    Effect.gen(function* () {
      const agentRuntime = yield* AgentRuntimeServiceTag;
      return yield* selector(agentRuntime);
    })
  );

const agentRuntimeErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === "object") {
    const { cause } = error as { cause?: unknown };
    if (cause instanceof Error) {
      return cause.message;
    }
    if (typeof cause === "string") {
      return cause;
    }
  }
  return error instanceof Error ? error.message : fallback;
};

const providerSchema = t.Object({
  id: t.String(),
  name: t.Optional(t.String()),
});

const updateModelSchema = t.Object({
  modelId: t.String(),
  providerId: t.Optional(t.String()),
});

export const agentsRoutes = new Elysia({ prefix: "/api/agents" })
  .use(createWorkspaceContextPlugin())
  .get(
    "/models",
    async ({ query, set, getWorkspaceContext }) => {
      try {
        const workspaceContext = await getWorkspaceContext(query.workspaceId);
        const catalog = await runAgentEffect((agentRuntime) =>
          agentRuntime.fetchProviderCatalogForWorkspace(
            workspaceContext.workspace.path
          )
        );
        const providerEntries = normalizeProviderEntries(catalog.providers);
        const models = flattenProviderModels(providerEntries);
        const defaults = normalizeProviderDefaults(catalog.default ?? {});
        const providers = providerEntries.map(({ id, name }) =>
          name ? { id, name } : { id }
        );

        return {
          models,
          defaults,
          providers,
        };
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          models: [],
          defaults: {},
          providers: [],
          message: agentRuntimeErrorMessage(error, "Failed to list models"),
        };
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
          providers: t.Array(providerSchema),
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
          providers: t.Array(providerSchema),
          message: t.String(),
        }),
      },
    }
  )
  .get(
    "/sessions/:id/models",
    async ({ params, set }) => {
      try {
        const session = await runAgentEffect((agentRuntime) =>
          agentRuntime.fetchAgentSession(params.id)
        );

        if (!session) {
          throw new Error("Agent session not found");
        }

        const catalog = await runAgentEffect((agentRuntime) =>
          agentRuntime.fetchProviderCatalogForWorkspace(session.workspacePath)
        );

        const providerEntries = normalizeProviderEntries(catalog.providers);
        const models = flattenProviderModels(providerEntries);
        const defaults = normalizeProviderDefaults(catalog.default);
        const providers = providerEntries.map(({ id, name }) =>
          name ? { id, name } : { id }
        );

        return {
          models,
          defaults,
          providers,
        };
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          models: [],
          defaults: {},
          providers: [],
          message: agentRuntimeErrorMessage(error, "Failed to list models"),
        };
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
          providers: t.Array(providerSchema),
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
          providers: t.Array(providerSchema),
          message: t.String(),
        }),
      },
    }
  )
  .post(
    "/sessions",
    async ({ body, set }) => {
      try {
        const sessionOptions = {
          ...(body.force !== undefined ? { force: body.force } : {}),
          ...(body.modelId ? { modelId: body.modelId } : {}),
          ...(body.providerId ? { providerId: body.providerId } : {}),
        };
        const session = await runAgentEffect((agentRuntime) =>
          agentRuntime.ensureAgentSession(
            body.cellId,
            Object.keys(sessionOptions).length ? sessionOptions : undefined
          )
        );
        return formatSession(session);
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message: agentRuntimeErrorMessage(
            error,
            "Failed to start agent session"
          ),
        };
      }
    },
    {
      body: CreateAgentSessionSchema,
      response: {
        200: AgentSessionSchema,
        400: t.Object({ message: t.String() }),
      },
    }
  )
  .patch(
    "/sessions/:id/model",
    async ({ params, body, set }) => {
      try {
        const session = await runAgentEffect((agentRuntime) =>
          agentRuntime.updateAgentSessionModel(
            params.id,
            body.providerId
              ? { modelId: body.modelId, providerId: body.providerId }
              : { modelId: body.modelId }
          )
        );
        return formatSession(session);
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message: agentRuntimeErrorMessage(
            error,
            "Failed to update session model"
          ),
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: updateModelSchema,
      response: {
        200: AgentSessionSchema,
        400: t.Object({ message: t.String() }),
      },
    }
  )
  .get(
    "/sessions/:id",
    async ({ params, set }) => {
      const session = await runAgentEffect((agentRuntime) =>
        agentRuntime.fetchAgentSession(params.id)
      );
      if (!session) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Agent session not found" };
      }
      return formatSession(session);
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: AgentSessionSchema,
        404: t.Object({ message: t.String() }),
      },
    }
  )
  .get(
    "/sessions/byCell/:cellId",
    async ({ params }) => {
      const session = await runAgentEffect((agentRuntime) =>
        agentRuntime.fetchAgentSessionForCell(params.cellId)
      );
      return { session: session ? formatSession(session) : null };
    },
    {
      params: t.Object({ cellId: t.String() }),
      response: {
        200: AgentSessionByCellResponseSchema,
      },
    }
  )
  .post(
    "/sessions/:id/messages",
    async ({ params, body, set }) => {
      try {
        await runAgentEffect((agentRuntime) =>
          agentRuntime.sendAgentMessage(params.id, body.content)
        );
        return { ok: true };
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message: agentRuntimeErrorMessage(
            error,
            "Failed to send agent message"
          ),
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: SendAgentMessageSchema,
      response: {
        200: t.Object({ ok: t.Boolean() }),
        400: t.Object({ message: t.String() }),
      },
    }
  )
  .post(
    "/sessions/:id/interrupt",
    async ({ params, set }) => {
      try {
        await runAgentEffect((agentRuntime) =>
          agentRuntime.interruptAgentSession(params.id)
        );
        return { ok: true };
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message: agentRuntimeErrorMessage(
            error,
            "Failed to interrupt agent session"
          ),
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        400: t.Object({ message: t.String() }),
      },
    }
  )
  .get(
    "/sessions/:id/messages",
    async ({ params, set }) => {
      const session = await runAgentEffect((agentRuntime) =>
        agentRuntime.fetchAgentSession(params.id)
      );
      if (!session) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Agent session not found" };
      }
      const messages = await runAgentEffect((agentRuntime) =>
        agentRuntime.fetchAgentMessages(params.id)
      );
      return {
        messages: messages.map(formatMessage),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: AgentMessageListResponseSchema,
        404: t.Object({ message: t.String() }),
      },
    }
  )
  .get(
    "/sessions/:id/events",
    async ({ params, request }) => {
      const history = await runAgentEffect((agentRuntime) =>
        agentRuntime.fetchAgentMessages(params.id)
      );
      const iterator = createEventIterator(params.id, request.signal);

      async function* stream() {
        yield sse({ event: "history", data: { messages: history } });

        for await (const event of iterator) {
          if (event.type === "history") {
            continue;
          }

          if (event.type === "status") {
            yield sse({
              event: "status",
              data: { status: event.status, error: event.error },
            });
            continue;
          }

          yield sse({ event: event.type, data: event.properties });
        }
      }

      return stream();
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Any(),
      },
    }
  )
  .post(
    "/sessions/:id/permissions/:permissionId",
    async ({ params, body, set }) => {
      try {
        await runAgentEffect((agentRuntime) =>
          agentRuntime.respondAgentPermission(
            params.id,
            params.permissionId,
            body.response
          )
        );
        return { ok: true };
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message: agentRuntimeErrorMessage(
            error,
            "Failed to respond to permission"
          ),
        };
      }
    },
    {
      params: t.Object({ id: t.String(), permissionId: t.String() }),
      body: RespondPermissionSchema,
      response: {
        200: t.Object({ ok: t.Boolean() }),
        400: t.Object({ message: t.String() }),
      },
    }
  )
  .delete(
    "/sessions/:id",
    async ({ params, set }) => {
      const session = await runAgentEffect((agentRuntime) =>
        agentRuntime.fetchAgentSession(params.id)
      );
      if (!session) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Agent session not found" };
      }
      await runAgentEffect((agentRuntime) =>
        agentRuntime.stopAgentSession(params.id)
      );
      return { message: "Agent session stopped" };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ message: t.String() }),
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

function formatMessage(message: AgentMessageRecord) {
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role,
    content: message.content ?? null,
    state: message.state,
    createdAt: message.createdAt,
    parts: message.parts,
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
    if (resolver) {
      resolver(null);
      resolver = null;
    }
  };

  signal.addEventListener("abort", cleanup, { once: true });

  return {
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
  };
}
