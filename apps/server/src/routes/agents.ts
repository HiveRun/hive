import { desc, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { type DbInstance, listAgentMessages, schema } from "../db";
import { createAgentOrchestrator } from "../lib/agent";
import {
  constructIdParamSchema,
  sendMessageSchema,
  sessionIdParamSchema,
} from "../lib/zod-schemas";

const orchestrator = createAgentOrchestrator();

export const agentsRoute = (db: DbInstance) =>
  new Elysia({ prefix: "/api/agents" })
    // Get agent session for a construct
    .get(
      "/construct/:constructId",
      async ({ params, set }) => {
        const sessions = await db
          .select()
          .from(schema.agentSessions)
          .where(eq(schema.agentSessions.constructId, params.constructId))
          .orderBy(desc(schema.agentSessions.createdAt))
          .limit(1);

        const session = sessions[0];
        if (!session) {
          set.status = 404;
          return { error: "No agent session found for this construct" };
        }

        const toIso = (value: number | null) =>
          value ? new Date(value * 1000).toISOString() : null;

        return {
          ...session,
          createdAt: toIso(session.createdAt),
          updatedAt: toIso(session.updatedAt),
          completedAt: toIso(session.completedAt ?? null),
        };
      },

      {
        params: constructIdParamSchema,
      }
    )

    .get(
      "/:sessionId/messages",
      async ({ params }) => {
        const messages = await listAgentMessages(db, params.sessionId);
        return messages.map((message) => ({
          id: message.id,
          sessionId: message.sessionId,
          role: message.role,
          content: message.content,
          timestamp: new Date(message.createdAt * 1000).toISOString(),
          metadata: null,
        }));
      },
      {
        params: sessionIdParamSchema,
      }
    )

    .post(
      "/:sessionId/messages",
      async ({ params, body, set }) => {
        try {
          const session = await orchestrator.getSession(params.sessionId);
          if (!session) {
            set.status = 404;
            return { error: "Agent session not found" };
          }

          await session.sendMessage(body.content);

          return { success: true };
        } catch (err) {
          set.status = 400;
          return {
            error:
              err instanceof Error ? err.message : "Failed to send message",
          };
        }
      },
      {
        body: sendMessageSchema,
        params: sessionIdParamSchema,
      }
    )

    .post(
      "/:sessionId/stop",
      async ({ params, set }) => {
        try {
          const session = await orchestrator.getSession(params.sessionId);
          if (!session) {
            set.status = 404;
            return { error: "Agent session not found" };
          }

          await session.stop();

          return { success: true };
        } catch (err) {
          set.status = 400;
          return {
            error: err instanceof Error ? err.message : "Failed to stop agent",
          };
        }
      },
      {
        params: sessionIdParamSchema,
      }
    );
