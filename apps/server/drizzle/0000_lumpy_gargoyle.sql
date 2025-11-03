CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`construct_id` text NOT NULL,
	`session_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'starting' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`error_message` text,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `constructs` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text DEFAULT 'implementation' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`workspace_path` text,
	`construct_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `prompt_bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`construct_id` text NOT NULL,
	`content` text NOT NULL,
	`token_estimate` integer NOT NULL,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`construct_id` text NOT NULL,
	`service_name` text NOT NULL,
	`service_type` text DEFAULT 'process' NOT NULL,
	`status` text DEFAULT 'stopped' NOT NULL,
	`pid` integer,
	`container_id` text,
	`command` text,
	`cwd` text,
	`env` text,
	`ports` text,
	`volumes` text,
	`health_status` text DEFAULT 'unknown',
	`last_health_check` integer,
	`cpu_usage` text,
	`memory_usage` text,
	`disk_usage` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`stopped_at` integer,
	`metadata` text
);
