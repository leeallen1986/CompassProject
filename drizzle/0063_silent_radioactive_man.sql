ALTER TABLE `userEmailSendLog` MODIFY COLUMN `digestType` enum('monday','thursday','manager_rollup') NOT NULL;--> statement-breakpoint
ALTER TABLE `userEmailSendLog` MODIFY COLUMN `status` enum('sent','failed','dry_run') NOT NULL DEFAULT 'sent';--> statement-breakpoint
ALTER TABLE `userEmailSendLog` ADD `weekKey` varchar(8);--> statement-breakpoint
ALTER TABLE `userEmailSendLog` ADD `itemCount` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `userEmailSendLog` ADD `dryRun` boolean DEFAULT false NOT NULL;