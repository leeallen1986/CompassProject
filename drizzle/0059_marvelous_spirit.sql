ALTER TABLE `projects` ADD `projectType` enum('opportunity','background_account','macro_item','program_wrapper') DEFAULT 'opportunity';--> statement-breakpoint
ALTER TABLE `projects` ADD `stageCode` enum('exploration','feasibility','planning','design','procurement','awarded','construction','commissioning','operational','completed','cancelled','unknown') DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE `projects` ADD `stageConfidence` float DEFAULT 0.5;--> statement-breakpoint
ALTER TABLE `projects` ADD `suppressionReason` varchar(512);--> statement-breakpoint
ALTER TABLE `projects` ADD `suppressed` boolean DEFAULT false;