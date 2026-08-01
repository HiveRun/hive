DROP TABLE IF EXISTS `cell_resource_rollups`;
--> statement-breakpoint
DROP TABLE IF EXISTS `cell_resource_history`;
--> statement-breakpoint
DELETE FROM `cell_activity_events`
WHERE `cell_id` NOT IN (SELECT `id` FROM `cells`)
  OR (
    `service_id` IS NOT NULL
    AND (
      `service_id` NOT IN (SELECT `id` FROM `cell_services`)
      OR `service_id` IN (
        SELECT `service`.`id`
        FROM `cell_services` AS `service`
        LEFT JOIN `cells` AS `cell` ON `cell`.`id` = `service`.`cell_id`
        WHERE `cell`.`id` IS NULL
      )
    )
  );
--> statement-breakpoint
DELETE FROM `cell_provisioning_state`
WHERE `cell_id` NOT IN (SELECT `id` FROM `cells`);
--> statement-breakpoint
DELETE FROM `cell_service_ports`
WHERE `service_id` NOT IN (SELECT `id` FROM `cell_services`)
  OR `service_id` IN (
    SELECT `service`.`id`
    FROM `cell_services` AS `service`
    LEFT JOIN `cells` AS `cell` ON `cell`.`id` = `service`.`cell_id`
    WHERE `cell`.`id` IS NULL
  );
--> statement-breakpoint
DELETE FROM `cell_services`
WHERE `cell_id` NOT IN (SELECT `id` FROM `cells`);
