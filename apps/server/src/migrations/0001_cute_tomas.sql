CREATE TABLE `cell_provisioning_state` (
	`cell_id` text PRIMARY KEY NOT NULL,
	`model_id_override` text,
	`provider_id_override` text,
	`started_at` integer,
	`finished_at` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`cell_id`) REFERENCES `cells`(`id`) ON UPDATE no action ON DELETE cascade
);
