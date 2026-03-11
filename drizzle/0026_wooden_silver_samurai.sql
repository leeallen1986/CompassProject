ALTER TABLE `projects` ADD `projectoryEnriched` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `projects` ADD `updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP;