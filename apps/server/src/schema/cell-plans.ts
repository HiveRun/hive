import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { cells } from "./cells";

export const cellPlans = sqliteTable("cell_plans", {
  id: text("id").primaryKey(),
  cellId: text("cell_id")
    .notNull()
    .references(() => cells.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  content: text("content").notNull(),
  feedback: text("feedback"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type CellPlan = typeof cellPlans.$inferSelect;
export type NewCellPlan = typeof cellPlans.$inferInsert;
