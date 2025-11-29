import { Elysia, sse, t } from "elysia";
import { subscribeAgentEvents } from "../agents/events";
import {
  ensureAgentSession,
  ensureRuntimeForSession,
  fetchAgentMessages,
  fetchAgentSession,
  fetchAgentSessionForCell,
  respondAgentPermission,
  sendAgentMessage,
  stopAgentSession,
} from "../agents/service";
import type {
  AgentMessageRecord,
  AgentSessionRecord,
  AgentStreamEvent,
} from "../agents/types";
import {
  AgentMessageListResponseSchema,
  AgentSessionByCellResponseSchema,
  AgentSessionSchema,
  CreateAgentSessionSchema,
  RespondPermissionSchema,
  SendAgentMessageSchema,
} from "../schema/api";

const HTTP_STATUS = {
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  INTERNAL_ERROR: 500,
} as const;

export const agentsRoutes = new Elysia({ prefix: "/api/agents" })
  .get(
    "/sessions/:id/models",
    async ({ params, set }) => {
      try {
        const runtime = await ensureRuntimeForSession(params.id);
        const { data, error } = await runtime.client.config.providers();

        if (error || !data) {
          throw new Error("Failed to load provider list from OpenCode runtime");
        }

        const providerEntries = normalizeProviderModels(data.providers);

        const models: Array<{ id: string; name: string; provider: string }> =
          [];

        for (const provider of providerEntries) {
          for (const [modelId, model] of Object.entries(provider.models)) {
            models.push({
              id: modelId,
              name: model.name ?? modelId,
              provider: provider.id,
            });
          }
        }

        return { models, defaults: data.default ?? {} };
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          models: [],
          defaults: {},
          message:
            error instanceof Error ? error.message : "Unable to fetch models",
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
          defaults: t.Optional(t.Record(t.String(), t.String())),
        }),
        400: t.Object({
          models: t.Array(
            t.Object({
              id: t.String(),
              name: t.String(),
              provider: t.String(),
            })
          ),
          defaults: t.Optional(t.Record(t.String(), t.String())),
          message: t.String(),
        }),
      },
    }
  )
  .post(
    "/sessions",
    async ({ body, set }) => {
      try {
        const session = await ensureAgentSession(body.cellId, {
          force: body.force,
          modelId: body.modelId,
        });
        return formatSession(session);
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message:
            error instanceof Error
              ? error.message
              : "Failed to start agent session",
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
  .get(
    "/sessions/:id",
    async ({ params, set }) => {
      const session = await fetchAgentSession(params.id);
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
      const session = await fetchAgentSessionForCell(params.cellId);
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
        await sendAgentMessage(params.id, body.content);
        return { ok: true };
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message:
            error instanceof Error
              ? error.message
              : "Failed to send agent message",
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
  .get(
    "/sessions/:id/messages",
    async ({ params, set }) => {
      const session = await fetchAgentSession(params.id);
      if (!session) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Agent session not found" };
      }
      const messages = await fetchAgentMessages(params.id);
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
      const history = await fetchAgentMessages(params.id);
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
        await respondAgentPermission(
          params.id,
          params.permissionId,
          body.response
        );
        return { ok: true };
      } catch (error) {
        set.status = HTTP_STATUS.BAD_REQUEST;
        return {
          message:
            error instanceof Error
              ? error.message
              : "Failed to respond to permission",
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
      const session = await fetchAgentSession(params.id);
      if (!session) {
        set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Agent session not found" };
      }
      await stopAgentSession(params.id);
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
    completedAt: session.completedAt,
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

type NormalizedProviderEntry = {
  id: string;
  models: Record<string, { name?: string }>;
};

function coerceProviderEntry(
  input: unknown,
  fallbackId?: string
): NormalizedProviderEntry | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const inputWithProps = input as { id?: unknown; models?: unknown };
  const providerId =
    typeof inputWithProps.id === "string" ? inputWithProps.id : fallbackId;

  if (!providerId) {
    return null;
  }

  if (!inputWithProps.models || typeof inputWithProps.models !== "object") {
    return null;
  }

  return {
    id: providerId,
    models: inputWithProps.models as Record<string, { name?: string }>,
  };
}

function normalizeProviderModels(rawProviders: unknown) {
  if (!rawProviders) {
    return [] as NormalizedProviderEntry[];
  }

  if (Array.isArray(rawProviders)) {
    return rawProviders
      .map((provider) => coerceProviderEntry(provider))
      .filter((entry): entry is NormalizedProviderEntry => Boolean(entry));
  }

  if (typeof rawProviders === "object") {
    return Object.entries(rawProviders as Record<string, unknown>)
      .map(([providerId, provider]) =>
        coerceProviderEntry(provider, providerId)
      )
      .filter((entry): entry is NormalizedProviderEntry => Boolean(entry));
  }

  return [] as NormalizedProviderEntry[];
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
