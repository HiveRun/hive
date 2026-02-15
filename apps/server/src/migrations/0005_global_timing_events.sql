CREATE TABLE `cell_timing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`cell_id` text NOT NULL,
	`cell_name` text,
	`workspace_id` text,
	`template_id` text,
	`workflow` text NOT NULL,
	`run_id` text NOT NULL,
	`step` text NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`attempt` integer,
	`error` text,
	`metadata` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cell_timing_events_cell_created_idx` ON `cell_timing_events` (`cell_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `cell_timing_events_run_created_idx` ON `cell_timing_events` (`run_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `cell_timing_events_created_idx` ON `cell_timing_events` (`created_at`);
