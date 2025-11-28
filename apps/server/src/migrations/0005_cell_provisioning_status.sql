ALTER TABLE `cells` ADD `status` text NOT NULL DEFAULT 'ready';--> statement-breakpoint
ALTER TABLE `cells` ADD `last_setup_error` text;
