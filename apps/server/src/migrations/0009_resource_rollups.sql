CREATE TABLE `cell_resource_rollups` (
  `id` text PRIMARY KEY NOT NULL,
  `cell_id` text NOT NULL,
  `bucket_start_at` integer NOT NULL,
  `sample_count` integer NOT NULL,
  `sum_active_cpu_percent` real NOT NULL,
  `sum_active_rss_bytes` integer NOT NULL,
  `peak_active_cpu_percent` real NOT NULL,
  `peak_active_rss_bytes` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`cell_id`) REFERENCES `cells`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `cell_resource_rollups_cell_bucket_idx`
  ON `cell_resource_rollups` (`cell_id`, `bucket_start_at`);
