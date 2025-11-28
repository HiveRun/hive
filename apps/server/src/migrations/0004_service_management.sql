CREATE TABLE `cell_services` (
	`id` text PRIMARY KEY NOT NULL,
	`cell_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`command` text NOT NULL,
	`cwd` text NOT NULL,
	`env` text NOT NULL,
	`status` text NOT NULL DEFAULT 'pending',
	`port` integer,
	`pid` integer,
	`ready_timeout_ms` integer,
	`definition` text NOT NULL,
	`last_known_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `cell_services_cell_id_cells_id_fk`
		FOREIGN KEY (`cell_id`) REFERENCES `cells`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cell_services_cell_id_idx` ON `cell_services` (`cell_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `cell_services_cell_service_unique` ON `cell_services` (`cell_id`,`name`);
