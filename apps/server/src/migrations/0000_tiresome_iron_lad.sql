CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`summary` text NOT NULL,
	`type` text DEFAULT 'implementation' NOT NULL,
	`config_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
