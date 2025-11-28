PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cells` (
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
INSERT INTO `__new_cells`("id", "name", "description", "template_id", "workspace_path", "workspace_id", "workspace_root_path", "opencode_session_id", "opencode_server_url", "opencode_server_port", "created_at", "status", "last_setup_error", "branch_name", "base_commit") SELECT "id", "name", "description", "template_id", "workspace_path", "workspace_id", "workspace_root_path", "opencode_session_id", "opencode_server_url", "opencode_server_port", "created_at", "status", "last_setup_error", "branch_name", "base_commit" FROM `cells`;--> statement-breakpoint
DROP TABLE `cells`;--> statement-breakpoint
ALTER TABLE `__new_cells` RENAME TO `cells`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_cell_services` (
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
--> statement-breakpoint
INSERT INTO `__new_cell_services`("id", "cell_id", "name", "type", "command", "cwd", "env", "status", "port", "pid", "ready_timeout_ms", "definition", "last_known_error", "created_at", "updated_at") SELECT "id", "cell_id", "name", "type", "command", "cwd", "env", "status", "port", "pid", "ready_timeout_ms", "definition", "last_known_error", "created_at", "updated_at" FROM `cell_services`;--> statement-breakpoint
DROP TABLE `cell_services`;--> statement-breakpoint
ALTER TABLE `__new_cell_services` RENAME TO `cell_services`;