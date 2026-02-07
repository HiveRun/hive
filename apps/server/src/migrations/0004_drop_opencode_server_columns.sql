PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_cells` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`template_id` text NOT NULL,
	`workspace_path` text NOT NULL,
	`workspace_id` text NOT NULL,
	`workspace_root_path` text DEFAULT '' NOT NULL,
	`opencode_session_id` text,
	`resume_agent_session_on_startup` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`last_setup_error` text,
	`branch_name` text,
	`base_commit` text
);
--> statement-breakpoint
INSERT INTO `__new_cells`(
	"id",
	"name",
	"description",
	"template_id",
	"workspace_path",
	"workspace_id",
	"workspace_root_path",
	"opencode_session_id",
	"resume_agent_session_on_startup",
	"created_at",
	"status",
	"last_setup_error",
	"branch_name",
	"base_commit"
) SELECT
	"id",
	"name",
	"description",
	"template_id",
	"workspace_path",
	"workspace_id",
	"workspace_root_path",
	"opencode_session_id",
	"resume_agent_session_on_startup",
	"created_at",
	"status",
	"last_setup_error",
	"branch_name",
	"base_commit"
FROM `cells`;
--> statement-breakpoint
DROP TABLE `cells`;
--> statement-breakpoint
ALTER TABLE `__new_cells` RENAME TO `cells`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
