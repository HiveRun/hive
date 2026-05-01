import { integer, text } from "drizzle-orm/sqlite-core";

export const metadataColumn = () =>
  text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull();

export const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp" }).notNull();
