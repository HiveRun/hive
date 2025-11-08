CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`opencode_message_id` text,
	`role` text NOT NULL,
	`content` text,
	`parts` text,
	`state` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_messages_session_idx` ON `agent_messages` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_messages_opencode_idx` ON `agent_messages` (`opencode_message_id`) WHERE "agent_messages"."opencode_message_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`construct_id` text NOT NULL,
	`template_id` text NOT NULL,
	`workspace_path` text NOT NULL,
	`opencode_session_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`construct_id`) REFERENCES `constructs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_sessions_construct_idx` ON `agent_sessions` (`construct_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_sessions_opencode_idx` ON `agent_sessions` (`opencode_session_id`);--> statement-breakpoint
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