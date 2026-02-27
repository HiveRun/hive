ALTER TABLE `cell_provisioning_state` ADD COLUMN `start_mode` text;

UPDATE `cell_provisioning_state`
SET `start_mode` = 'build'
WHERE `start_mode` IS NULL;
