import { createAgentOrchestrator } from "@synthetic/agent";
import { desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { type DbInstance, schema } from "../db";

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

    // Get messages for a session
    .get("/:sessionId/messages", (_params) => [])

    // Send message to agent
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

          // Store message in database
          // TODO: Implement transcript messages table
          // const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          // await db.insert(schema.transcriptMessages).values({
          //   id: messageId,
          //   sessionId: params.sessionId,
          //   role: "user",
          //   content: body.content,
          //   timestamp: new Date(),
          // });

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

    // Stop agent session
    .post("/:sessionId/stop", async ({ params, set }) => {
      try {
        const session = await orchestrator.getSession(params.sessionId);
        if (!session) {
          set.status = 404;
          return { error: "Agent session not found" };
        }

        await session.stop();

        // Update session status in database
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
