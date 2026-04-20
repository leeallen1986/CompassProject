ALTER TABLE `campaignStagedContacts` ADD `jointVentureLabel` varchar(512);--> statement-breakpoint
ALTER TABLE `campaignStagedContacts` ADD `recordType` varchar(32) DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaignStagedContacts` ADD `rejectionReason` text;--> statement-breakpoint
ALTER TABLE `campaignStagedContacts` ADD `duplicateOf` varchar(512);