CREATE TABLE `cells` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`template_id` text NOT NULL,
	`workspace_path` text NOT NULL,
	`workspace_id` text NOT NULL,
	`workspace_root_path` text DEFAULT '' NOT NULL,
	`opencode_session_id` text,
	`opencode_server_url` text,
	`opencode_server_port` integer,
	`created_at` integer NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`last_setup_error` text,
	`branch_name` text,
	`base_commit` text
);
--> statement-breakpoint
CREATE TABLE `cell_services` (
	`id` text PRIMARY KEY NOT NULL,
	`cell_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`command` text NOT NULL,
	`cwd` text NOT NULL,
	`env` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`port` integer,
	`pid` integer,
	`ready_timeout_ms` integer,
	`definition` text NOT NULL,
	`last_known_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cell_id`) REFERENCES `cells`(`id`) ON UPDATE no action ON DELETE cascade
);
