import { Elysia, t } from "elysia";
import {
  createAgentEventStream,
  ensureAgentSession,
  fetchAgentMessages,
  fetchAgentSession,
  fetchAgentSessionForConstruct,
  sendAgentMessage,
  stopAgentSession,
} from "../agents/service";
import type { AgentMessageRecord, AgentSessionRecord } from "../agents/types";
import {
  AgentMessageListResponseSchema,
  AgentMessageSchema,
  AgentSessionByConstructResponseSchema,
  AgentSessionSchema,
  CreateAgentSessionSchema,
  SendAgentMessageSchema,
} from "../schema/api";

const HTTP_STATUS = {
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  INTERNAL_ERROR: 500,
} as const;

export const agentsRoutes = new Elysia({ prefix: "/api/agents" })
  .post(
    "/sessions",
    async ({ body, set }) => {
      try {
        const session = await ensureAgentSession(body.constructId, {
          force: body.force,
          useMock: body.useMock,
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
    "/sessions/byConstruct/:constructId",
    async ({ params }) => {
      const session = await fetchAgentSessionForConstruct(params.constructId);
      return { session: session ? formatSession(session) : null };
    },
    {
      params: t.Object({ constructId: t.String() }),
      response: {
        200: AgentSessionByConstructResponseSchema,
      },
    }
  )
  .post(
    "/sessions/:id/messages",
    async ({ params, body, set }) => {
      try {
        const message = await sendAgentMessage(params.id, body.content);
        return formatMessage(message);
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
        200: AgentMessageSchema,
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
    ({ params, request }) => createAgentEventStream(params.id, request.signal),
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Any(),
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
    constructId: session.constructId,
    templateId: session.templateId,
    provider: session.provider,
    status: session.status,
    workspacePath: session.workspacePath,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    completedAt: session.completedAt
      ? session.completedAt.toISOString()
      : undefined,
  };
}

function formatMessage(message: AgentMessageRecord) {
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role,
    content: message.content ?? null,
    state: message.state,
    createdAt: message.createdAt.toISOString(),
    parts: parseMessageParts(message.parts),
  };
}

function parseMessageParts(parts: string | null | undefined) {
  if (!parts) {
    return [];
  }
  try {
    const parsed = JSON.parse(parts);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
