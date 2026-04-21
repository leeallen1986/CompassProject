CREATE TABLE `emarsysExportLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`campaignName` varchar(256) NOT NULL,
	`exportMode` enum('curated_marketing_export','sales_direct_export') NOT NULL,
	`divisionLabel` varchar(128) NOT NULL DEFAULT 'Atlas Copco',
	`salesOrg` varchar(32) NOT NULL DEFAULT 'AU30',
	`languageTag` varchar(16) NOT NULL DEFAULT 'en',
	`countryRegion` varchar(64) NOT NULL DEFAULT 'Australia',
	`collateralName` varchar(256),
	`totalCampaignContacts` int NOT NULL DEFAULT 0,
	`exportedCount` int NOT NULL DEFAULT 0,
	`excludedCount` int NOT NULL DEFAULT 0,
	`exclusionBreakdown` json,
	`templateVersion` varchar(32) NOT NULL DEFAULT '6A-v1',
	`exportFileKey` varchar(512),
	`exportFileUrl` varchar(1024),
	`exportedBy` int NOT NULL,
	`exportedByName` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emarsysExportLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `campaignContacts` ADD `doNotContact` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `campaignContacts` ADD `doNotContactReason` varchar(256);--> statement-breakpoint
ALTER TABLE `campaignContacts` ADD `emarsysApproved` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `campaignContacts` ADD `emarsysApprovedAt` timestamp;--> statement-breakpoint
ALTER TABLE `campaignContacts` ADD `emarsysApprovedBy` int;--> statement-breakpoint
ALTER TABLE `campaignContacts` ADD `lastExportedAt` timestamp;--> statement-breakpoint
ALTER TABLE `campaignContacts` ADD `lastExportLogId` int;