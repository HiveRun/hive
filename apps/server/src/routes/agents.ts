import { desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { type DbInstance, schema } from "../db";
import { createAgentOrchestrator } from "../lib/agent";

const orchestrator = createAgentOrchestrator();

export const agentsRoute = (db: DbInstance) =>
  new Elysia({ prefix: "/api/agents" })
    // Get agent session for a construct
    .get("/construct/:constructId", async ({ params, set }) => {
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

      return session;
    })

    .get("/:sessionId/messages", (_params) => [])

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
        body: t.Object({
          content: t.String(),
        }),
      }
    )

    .post("/:sessionId/stop", async ({ params, set }) => {
      try {
        const session = await orchestrator.getSession(params.sessionId);
        if (!session) {
          set.status = 404;
          return { error: "Agent session not found" };
        }

        await session.stop();

        await db;
        await db
          .update(schema.agentSessions)
          .set({
            status: "completed",
            completedAt: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(schema.agentSessions.sessionId, params.sessionId));

        return { success: true };
      } catch (err) {
        set.status = 400;
        return {
          error: err instanceof Error ? err.message : "Failed to stop agent",
        };
      }
    });
