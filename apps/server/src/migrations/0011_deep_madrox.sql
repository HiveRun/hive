CREATE TABLE `workspace_linear_integrations` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`token_type` text,
	`scope` text,
	`linear_user_id` text NOT NULL,
	`linear_user_name` text,
	`linear_user_email` text,
	`linear_organization_id` text,
	`linear_organization_name` text,
	`team_id` text,
	`team_key` text,
	`team_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
