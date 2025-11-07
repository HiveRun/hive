PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_constructs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`template_id` text NOT NULL,
	`workspace_path` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_constructs`("id", "name", "description", "template_id", "workspace_path", "created_at") SELECT "id", "name", "description", "template_id", "workspace_path", "created_at" FROM `constructs`;--> statement-breakpoint
DROP TABLE `constructs`;--> statement-breakpoint
ALTER TABLE `__new_constructs` RENAME TO `constructs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;