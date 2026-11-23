ALTER TABLE `events` ADD `provider_id` text;
--> statement-breakpoint
UPDATE `events`
SET `provider_id` = (SELECT `provider_id` FROM `threads` WHERE `threads`.`id` = `events`.`thread_id`);
