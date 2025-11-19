ALTER TABLE `constructs` ADD `workspace_id` text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE `constructs` ADD `workspace_root_path` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `constructs`
SET `workspace_root_path` = CASE
  WHEN `workspace_root_path` = '' THEN `workspace_path`
  ELSE `workspace_root_path`
END;
