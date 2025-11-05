import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const templates = sqliteTable("templates", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  summary: text("summary").notNull(),
  type: text("type", {
    enum: ["implementation", "planning", "manual"],
  })
    .notNull()
    .default("implementation"),
  configJson: text("config_json", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
