ALTER TABLE `rssSources` ADD `totalArticles` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `rssSources` ADD `successCount` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `rssSources` ADD `failureCount` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `rssSources` ADD `consecutiveErrors` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `rssSources` ADD `lastError` text;--> statement-breakpoint
ALTER TABLE `rssSources` ADD `lastErrorAt` timestamp;--> statement-breakpoint
ALTER TABLE `rssSources` ADD `lastSuccessAt` timestamp;