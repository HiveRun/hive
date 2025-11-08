ALTER TABLE `constructs` ADD COLUMN `opencode_session_id` text;

DROP TABLE IF EXISTS `agent_messages`;
DROP TABLE IF EXISTS `agent_sessions`;
