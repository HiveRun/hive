DELETE FROM `cell_activity_events`
WHERE `type` IN ('cell.create.timing', 'cell.delete.timing');

DELETE FROM `cell_timing_events`
WHERE `workflow` = 'delete';

DROP TABLE IF EXISTS `cell_resource_rollups`;
DROP TABLE IF EXISTS `cell_resource_history`;
