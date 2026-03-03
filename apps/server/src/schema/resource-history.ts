import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { cells } from "./cells";

export type StoredResourceProcess = {
  kind: "service" | "opencode" | "terminal" | "setup";
  serviceType?: string;
  id: string;
  name: string;
  status: string;
  pid: number | null;
  processAlive: boolean;
  active: boolean;
  cpuPercent: number | null;
  rssBytes: number | null;
  resourceSampledAt: string;
  resourceUnavailableReason?:
    | "pid_missing"
    | "process_not_alive"
    | "sample_failed"
    | "unsupported_platform";
};

export const cellResourceHistory = sqliteTable("cell_resource_history", {
  id: text("id").primaryKey(),
  cellId: text("cell_id")
    .notNull()
    .references(() => cells.id, { onDelete: "cascade" }),
  sampledAt: integer("sampled_at", { mode: "timestamp" }).notNull(),
  processCount: integer("process_count").notNull(),
  activeProcessCount: integer("active_process_count").notNull(),
  totalCpuPercent: real("total_cpu_percent").notNull(),
  totalRssBytes: integer("total_rss_bytes").notNull(),
  activeCpuPercent: real("active_cpu_percent").notNull(),
  activeRssBytes: integer("active_rss_bytes").notNull(),
  processes: text("processes", { mode: "json" })
    .$type<StoredResourceProcess[]>()
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const cellResourceRollups = sqliteTable(
  "cell_resource_rollups",
  {
    id: text("id").primaryKey(),
    cellId: text("cell_id")
      .notNull()
      .references(() => cells.id, { onDelete: "cascade" }),
    bucketStartAt: integer("bucket_start_at", { mode: "timestamp" }).notNull(),
    sampleCount: integer("sample_count").notNull(),
    sumActiveCpuPercent: real("sum_active_cpu_percent").notNull(),
    sumActiveRssBytes: integer("sum_active_rss_bytes").notNull(),
    peakActiveCpuPercent: real("peak_active_cpu_percent").notNull(),
    peakActiveRssBytes: integer("peak_active_rss_bytes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => ({
    cellBucketIdx: index("cell_resource_rollups_cell_bucket_idx").on(
      table.cellId,
      table.bucketStartAt
    ),
  })
);

export type CellResourceHistory = typeof cellResourceHistory.$inferSelect;
export type NewCellResourceHistory = typeof cellResourceHistory.$inferInsert;
export type CellResourceRollup = typeof cellResourceRollups.$inferSelect;
export type NewCellResourceRollup = typeof cellResourceRollups.$inferInsert;
