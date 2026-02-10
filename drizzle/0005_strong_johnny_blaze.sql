ALTER TABLE `contacts` ADD `enrichmentStatus` enum('pending','enriched','not_found','failed') DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `contacts` ADD `enrichedAt` timestamp;--> statement-breakpoint
ALTER TABLE `contacts` ADD `linkedinHeadline` varchar(512);--> statement-breakpoint
ALTER TABLE `contacts` ADD `linkedinLocation` varchar(256);--> statement-breakpoint
ALTER TABLE `contacts` ADD `linkedinProfilePic` varchar(1024);