CREATE TABLE `cell_resource_history` (
  `id` text PRIMARY KEY NOT NULL,
  `cell_id` text NOT NULL,
  `sampled_at` integer NOT NULL,
  `process_count` integer NOT NULL,
  `active_process_count` integer NOT NULL,
  `total_cpu_percent` real NOT NULL,
  `total_rss_bytes` integer NOT NULL,
  `active_cpu_percent` real NOT NULL,
  `active_rss_bytes` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`cell_id`) REFERENCES `cells`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `cell_resource_history_cell_sampled_idx`
  ON `cell_resource_history` (`cell_id`, `sampled_at`);
