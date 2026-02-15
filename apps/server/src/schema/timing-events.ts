import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const CELL_TIMING_WORKFLOWS = ["create", "delete"] as const;
export type CellTimingWorkflow = (typeof CELL_TIMING_WORKFLOWS)[number];

export const CELL_TIMING_STATUSES = ["ok", "error"] as const;
export type CellTimingStatus = (typeof CELL_TIMING_STATUSES)[number];

export const cellTimingEvents = sqliteTable("cell_timing_events", {
  id: text("id").primaryKey(),
  cellId: text("cell_id").notNull(),
  cellName: text("cell_name"),
  workspaceId: text("workspace_id"),
  templateId: text("template_id"),
  workflow: text("workflow").$type<CellTimingWorkflow>().notNull(),
  runId: text("run_id").notNull(),
  step: text("step").notNull(),
  status: text("status").$type<CellTimingStatus>().notNull(),
  durationMs: integer("duration_ms").notNull(),
  attempt: integer("attempt"),
  error: text("error"),
  metadata: text("metadata", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type CellTimingEvent = typeof cellTimingEvents.$inferSelect;
export type NewCellTimingEvent = typeof cellTimingEvents.$inferInsert;
