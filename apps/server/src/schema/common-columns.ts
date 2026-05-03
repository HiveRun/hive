import { integer, text } from "drizzle-orm/sqlite-core";
import { cells } from "./cells";

export const cellIdColumn = () =>
  text("cell_id")
    .notNull()
    .references(() => cells.id, { onDelete: "cascade" });

export const metadataColumn = () =>
  text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull();

export const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" }).notNull();
