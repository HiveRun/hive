import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Service } from "../config/schema";
import { cells } from "./cells";

export const SERVICE_STATUSES = [
  "pending",
  "starting",
  "running",
  "stopped",
  "error",
  "needs_resume",
] as const;

export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const cellServices = sqliteTable("cell_services", {
  id: text("id").primaryKey(),
  cellId: text("cell_id")
    .notNull()
    .references(() => cells.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  command: text("command").notNull(),
  cwd: text("cwd").notNull(),
  env: text("env", { mode: "json" }).$type<Record<string, string>>().notNull(),
  status: text("status").$type<ServiceStatus>().notNull().default("pending"),
  port: integer("port"),
  pid: integer("pid"),
  readyTimeoutMs: integer("ready_timeout_ms"),
  definition: text("definition", { mode: "json" }).$type<Service>().notNull(),
  lastKnownError: text("last_known_error"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type CellService = typeof cellServices.$inferSelect;
export type NewCellService = typeof cellServices.$inferInsert;
