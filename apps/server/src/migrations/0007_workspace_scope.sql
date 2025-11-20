PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_constructs` (
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
INSERT INTO `__new_constructs`("id", "name", "description", "template_id", "workspace_path", "workspace_id", "workspace_root_path", "opencode_session_id", "opencode_server_url", "opencode_server_port", "created_at", "status", "last_setup_error", "branch_name", "base_commit") SELECT "id", "name", "description", "template_id", "workspace_path", "workspace_id", "workspace_root_path", "opencode_session_id", "opencode_server_url", "opencode_server_port", "created_at", "status", "last_setup_error", "branch_name", "base_commit" FROM `constructs`;--> statement-breakpoint
DROP TABLE `constructs`;--> statement-breakpoint
ALTER TABLE `__new_constructs` RENAME TO `constructs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_construct_services` (
	`id` text PRIMARY KEY NOT NULL,
	`construct_id` text NOT NULL,
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
	FOREIGN KEY (`construct_id`) REFERENCES `constructs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_construct_services`("id", "construct_id", "name", "type", "command", "cwd", "env", "status", "port", "pid", "ready_timeout_ms", "definition", "last_known_error", "created_at", "updated_at") SELECT "id", "construct_id", "name", "type", "command", "cwd", "env", "status", "port", "pid", "ready_timeout_ms", "definition", "last_known_error", "created_at", "updated_at" FROM `construct_services`;--> statement-breakpoint
DROP TABLE `construct_services`;--> statement-breakpoint
ALTER TABLE `__new_construct_services` RENAME TO `construct_services`;