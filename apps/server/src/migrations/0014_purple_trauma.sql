CREATE TABLE `cell_service_ports` (
	`service_id` text NOT NULL,
	`name` text NOT NULL,
	`port` integer NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`service_id`, `name`),
	FOREIGN KEY (`service_id`) REFERENCES `cell_services`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `cell_service_ports` (`service_id`, `name`, `port`, `is_primary`, `created_at`, `updated_at`)
SELECT `id`, 'default', `port`, true, `created_at`, `updated_at`
FROM `cell_services` AS `service`
WHERE `port` IS NOT NULL
	AND `id` = (
		SELECT `candidate`.`id`
		FROM `cell_services` AS `candidate`
		WHERE `candidate`.`port` = `service`.`port`
		ORDER BY `candidate`.`created_at`, `candidate`.`id`
		LIMIT 1
	);
--> statement-breakpoint
CREATE UNIQUE INDEX `cell_service_ports_port_unique` ON `cell_service_ports` (`port`);
