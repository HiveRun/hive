ALTER TABLE `constructs` ADD `status` text NOT NULL DEFAULT 'ready';--> statement-breakpoint
ALTER TABLE `constructs` ADD `last_setup_error` text;
