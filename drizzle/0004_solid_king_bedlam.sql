CREATE TABLE `businessLines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`keywords` json,
	`sectors` json,
	`equipmentTypes` json,
	`defaultTerritories` json,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `businessLines_id` PRIMARY KEY(`id`),
	CONSTRAINT `businessLines_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `feedbackWeights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`territoryWeights` json,
	`industryWeights` json,
	`sectorWeights` json,
	`dealSizeWeights` json,
	`totalFeedbackCount` int NOT NULL DEFAULT 0,
	`lastUpdatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `feedbackWeights_id` PRIMARY KEY(`id`),
	CONSTRAINT `feedbackWeights_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `rawArticles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` int NOT NULL,
	`fingerprint` varchar(64) NOT NULL,
	`title` varchar(512) NOT NULL,
	`summary` text,
	`url` varchar(512) NOT NULL,
	`publishedAt` timestamp,
	`matchedKeywords` json,
	`matchedBusinessLines` json,
	`status` enum('pending','queued','extracted','skipped','failed') NOT NULL DEFAULT 'pending',
	`extractedData` json,
	`extractedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rawArticles_id` PRIMARY KEY(`id`),
	CONSTRAINT `rawArticles_fingerprint_unique` UNIQUE(`fingerprint`)
);
--> statement-breakpoint
CREATE TABLE `rssSources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`feedUrl` varchar(512) NOT NULL,
	`category` varchar(64) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`lastFetchedAt` timestamp,
	`lastFetchCount` int DEFAULT 0,
	`errorCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rssSources_id` PRIMARY KEY(`id`)
);
