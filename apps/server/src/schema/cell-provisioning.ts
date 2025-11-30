import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { cells } from "./cells";

export const cellProvisioningStates = sqliteTable("cell_provisioning_state", {
  cellId: text("cell_id")
    .primaryKey()
    .references(() => cells.id, { onDelete: "cascade" }),
  modelIdOverride: text("model_id_override"),
  providerIdOverride: text("provider_id_override"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  attemptCount: integer("attempt_count").notNull().default(0),
});

export type CellProvisioningState = typeof cellProvisioningStates.$inferSelect;
export type NewCellProvisioningState =
  typeof cellProvisioningStates.$inferInsert;
