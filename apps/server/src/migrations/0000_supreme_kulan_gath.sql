CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`type` text DEFAULT 'manual' NOT NULL,
	`config_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
