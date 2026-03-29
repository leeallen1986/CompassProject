ALTER TABLE `contacts` ADD `regionClassification` enum('australia','non_australia','unknown') DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE `contacts` ADD `geoFilterReason` varchar(256);