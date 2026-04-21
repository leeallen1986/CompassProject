ALTER TABLE `rssSources` ADD `quarantined` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `rssSources` ADD `quarantineReason` varchar(256);