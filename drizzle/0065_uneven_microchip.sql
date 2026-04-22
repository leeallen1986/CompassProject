ALTER TABLE `projects` ADD `sourcePurpose` enum('live_tender','forward_plan','project_signal','contractor_path','awarded') DEFAULT 'project_signal';--> statement-breakpoint
ALTER TABLE `projects` ADD `tenderNumber` varchar(64);--> statement-breakpoint
ALTER TABLE `projects` ADD `tenderCloseDate` timestamp;