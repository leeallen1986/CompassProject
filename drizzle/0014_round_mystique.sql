ALTER TABLE `projects` ADD `lifecycleStatus` enum('active','stale','archived','awarded','completed') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `lastActivityAt` timestamp DEFAULT (now());--> statement-breakpoint
ALTER TABLE `projects` ADD `archivedBy` int;--> statement-breakpoint
ALTER TABLE `projects` ADD `archivedAt` timestamp;