ALTER TABLE `contacts` ADD `verifiedByUserId` int;--> statement-breakpoint
ALTER TABLE `contacts` ADD `verifiedAt` timestamp;--> statement-breakpoint
ALTER TABLE `contacts` ADD `verifiedLinkedinUrl` varchar(1024);--> statement-breakpoint
ALTER TABLE `contacts` ADD `rejectedByUserId` int;--> statement-breakpoint
ALTER TABLE `contacts` ADD `rejectedAt` timestamp;--> statement-breakpoint
ALTER TABLE `contacts` ADD `rejectionReason` varchar(256);