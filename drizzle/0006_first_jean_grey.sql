ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','distributor') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(256);--> statement-breakpoint
ALTER TABLE `users` ADD `authMethod` enum('oauth','email') DEFAULT 'oauth' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `invitedBy` int;--> statement-breakpoint
ALTER TABLE `users` ADD `inviteToken` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `inviteExpiresAt` timestamp;