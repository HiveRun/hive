import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const cellStatusValues = [
  "spawning",
  "pending",
  "ready",
  "error",
] as const;
export type CellStatus = (typeof cellStatusValues)[number];

export const cells = sqliteTable("cells", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  templateId: text("template_id").notNull(),
  workspacePath: text("workspace_path").notNull(),
  workspaceId: text("workspace_id").notNull(),
  workspaceRootPath: text("workspace_root_path").notNull().default(""),
  opencodeSessionId: text("opencode_session_id"),
  opencodeServerUrl: text("opencode_server_url"),
  opencodeServerPort: integer("opencode_server_port"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  status: text("status").notNull().default("ready"),
  lastSetupError: text("last_setup_error"),
  branchName: text("branch_name"),
  baseCommit: text("base_commit"),
});

export type Cell = typeof cells.$inferSelect;
export type NewCell = typeof cells.$inferInsert;
