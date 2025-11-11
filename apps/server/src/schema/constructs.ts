import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const constructs = sqliteTable("constructs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  templateId: text("template_id").notNull(),
  workspacePath: text("workspace_path").notNull(),
  opencodeSessionId: text("opencode_session_id"),
  opencodeServerUrl: text("opencode_server_url"),
  opencodeServerPort: integer("opencode_server_port"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type Construct = typeof constructs.$inferSelect;
export type NewConstruct = typeof constructs.$inferInsert;
