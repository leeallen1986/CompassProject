ALTER TABLE `projects` ADD `projectCountry` varchar(2);--> statement-breakpoint
ALTER TABLE `projects` ADD `projectState` varchar(64);--> statement-breakpoint
ALTER TABLE `projects` ADD `locationConfidence` float;--> statement-breakpoint
ALTER TABLE `projects` ADD `geoBlockedReason` enum('blocked_non_australian_project','blocked_location_unclear','blocked_cross_border_signal');