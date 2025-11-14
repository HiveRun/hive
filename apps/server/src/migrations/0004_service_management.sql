CREATE TABLE `construct_services` (
	`id` text PRIMARY KEY NOT NULL,
	`construct_id` text NOT NULL,
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
	CONSTRAINT `construct_services_construct_id_constructs_id_fk`
		FOREIGN KEY (`construct_id`) REFERENCES `constructs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `construct_services_construct_id_idx` ON `construct_services` (`construct_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `construct_services_construct_service_unique` ON `construct_services` (`construct_id`,`name`);
