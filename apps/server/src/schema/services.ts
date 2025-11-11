import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Service } from "../config/schema";
import { constructs } from "./constructs";

export const SERVICE_STATUSES = [
  "pending",
  "starting",
  "running",
  "stopped",
  "error",
  "needs_resume",
] as const;

export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const constructServices = sqliteTable("construct_services", {
  id: text("id").primaryKey(),
  constructId: text("construct_id")
    .notNull()
    .references(() => constructs.id, { onDelete: "cascade" }),
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

export type ConstructService = typeof constructServices.$inferSelect;
export type NewConstructService = typeof constructServices.$inferInsert;
