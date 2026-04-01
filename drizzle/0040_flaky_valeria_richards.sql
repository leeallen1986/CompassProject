ALTER TABLE `campaignContacts` ADD `enrichmentSource_cc` enum('apollo','hunter','manual');--> statement-breakpoint
ALTER TABLE `campaignContacts` ADD `hunterConfidence` int;--> statement-breakpoint
ALTER TABLE `campaignContacts` ADD `hunterVerificationStatus` varchar(32);