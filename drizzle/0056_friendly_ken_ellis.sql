ALTER TABLE `projects` ADD `sourceLastSeenAt` timestamp;--> statement-breakpoint
ALTER TABLE `projects` ADD `staleReason` varchar(256);--> statement-breakpoint
ALTER TABLE `projects` ADD `keepFlag` boolean DEFAULT false;