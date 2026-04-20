CREATE TABLE `campaignDomainOverrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`companyNameNormalised` varchar(256) NOT NULL,
	`approvedDomain` varchar(256) NOT NULL,
	`subsidiaryName` varchar(256),
	`reason` text,
	`approvedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaignDomainOverrides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `campaignContacts` ADD `enrichmentQA` json;--> statement-breakpoint
ALTER TABLE `campaignContacts` ADD `sendReadiness` varchar(32);