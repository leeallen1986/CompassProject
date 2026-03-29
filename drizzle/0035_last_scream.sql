ALTER TABLE `contacts` ADD `crmId` varchar(64);--> statement-breakpoint
ALTER TABLE `contacts` ADD `crmAccountId` varchar(64);--> statement-breakpoint
ALTER TABLE `contacts` ADD `department` varchar(128);--> statement-breakpoint
ALTER TABLE `contacts` ADD `mobilePhone` varchar(64);--> statement-breakpoint
ALTER TABLE `contacts` ADD `crmOwner` varchar(128);--> statement-breakpoint
ALTER TABLE `contacts` ADD `lastCrmModified` timestamp;--> statement-breakpoint
ALTER TABLE `contacts` ADD `source` enum('scraper','crm','manual','apollo') DEFAULT 'scraper';--> statement-breakpoint
ALTER TABLE `contacts` ADD `sectorTag` varchar(64);--> statement-breakpoint
ALTER TABLE `contacts` ADD `enrichmentPriority` enum('high','medium','low') DEFAULT 'medium';