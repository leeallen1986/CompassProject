ALTER TABLE `projects` ADD `duplicateClusterId` varchar(36);--> statement-breakpoint
ALTER TABLE `projects` ADD `mergedIntoId` int;--> statement-breakpoint
ALTER TABLE `projects` ADD `duplicateDismissed` boolean DEFAULT false;