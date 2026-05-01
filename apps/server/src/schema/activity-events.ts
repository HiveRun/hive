import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { cells } from "./cells";
import { createdAtColumn, metadataColumn } from "./common-columns";
import { cellServices } from "./services";

export const ACTIVITY_EVENT_TYPES = [
  "service.start",
  "service.stop",
  "service.restart",
  "services.start",
  "services.stop",
  "services.restart",
  "setup.retry",
  "service.logs.read",
  "setup.logs.read",
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export const cellActivityEvents = sqliteTable("cell_activity_events", {
  id: text("id").primaryKey(),
  cellId: text("cell_id")
    .notNull()
    .references(() => cells.id, { onDelete: "cascade" }),
  serviceId: text("service_id").references(() => cellServices.id, {
    onDelete: "cascade",
  }),
  type: text("type").$type<ActivityEventType>().notNull(),
  source: text("source"),
  toolName: text("tool_name"),
  metadata: metadataColumn(),
  createdAt: createdAtColumn(),
});
