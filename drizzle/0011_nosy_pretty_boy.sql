ALTER TABLE `contacts` ADD `verificationStatus` enum('verified','ai_suggested','unverified') DEFAULT 'unverified';--> statement-breakpoint
ALTER TABLE `contacts` ADD `confidenceScore` enum('high','medium','low') DEFAULT 'medium';--> statement-breakpoint
ALTER TABLE `contacts` ADD `linkedinSearchUrl` varchar(1024);--> statement-breakpoint
ALTER TABLE `contacts` ADD `emailVerified` boolean DEFAULT false;