PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_constructs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`template_id` text NOT NULL,
	`workspace_path` text NOT NULL,
	`workspace_id` text NOT NULL,
	`workspace_root_path` text NOT NULL,
	`opencode_session_id` text,
	`opencode_server_url` text,
	`opencode_server_port` integer,
	`created_at` integer NOT NULL,
	`status` text NOT NULL DEFAULT 'ready',
	`last_setup_error` text,
	`branch_name` text,
	`base_commit` text
);
--> statement-breakpoint
INSERT INTO `__new_constructs`(
	"id",
	"name",
	"description",
	"template_id",
	"workspace_path",
	"workspace_id",
	"workspace_root_path",
	"opencode_session_id",
	"opencode_server_url",
	"opencode_server_port",
	"created_at",
	"status",
	"last_setup_error",
	"branch_name",
	"base_commit"
)
SELECT
	"id",
	"name",
	"description",
	"template_id",
	"workspace_path",
	'legacy',
	"workspace_path",
	"opencode_session_id",
	"opencode_server_url",
	"opencode_server_port",
	"created_at",
	"status",
	"last_setup_error",
	"branch_name",
	"base_commit"
FROM `constructs`;
--> statement-breakpoint
DROP TABLE `constructs`;
--> statement-breakpoint
ALTER TABLE `__new_constructs` RENAME TO `constructs`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
