import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { constructs } from "./constructs";

export const agentSessions = sqliteTable(
  "agent_sessions",
  {
    id: text("id").primaryKey(),
    constructId: text("construct_id")
      .notNull()
      .references(() => constructs.id),
    templateId: text("template_id").notNull(),
    workspacePath: text("workspace_path").notNull(),
    opencodeSessionId: text("opencode_session_id").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => ({
    constructIdx: index("agent_sessions_construct_idx").on(table.constructId),
    opencodeSessionIdx: uniqueIndex("agent_sessions_opencode_idx").on(
      table.opencodeSessionId
    ),
  })
);

export const agentMessages = sqliteTable(
  "agent_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id),
    opencodeMessageId: text("opencode_message_id"),
    role: text("role").notNull(),
    content: text("content"),
    parts: text("parts"),
    state: text("state").notNull(),
    sequence: integer("sequence").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => ({
    sessionIdx: index("agent_messages_session_idx").on(table.sessionId),
    opencodeMessageIdx: uniqueIndex("agent_messages_opencode_idx")
      .on(table.opencodeMessageId)
      .where(sql`${table.opencodeMessageId} IS NOT NULL`),
  })
);

export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;
export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;
