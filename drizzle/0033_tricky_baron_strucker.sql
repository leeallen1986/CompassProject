CREATE TABLE `collateralItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`description` text,
	`productLine` enum('portable_air','dewatering','generators','bess','nitrogen','lighting','other') NOT NULL DEFAULT 'portable_air',
	`fileKey` varchar(512) NOT NULL,
	`fileUrl` varchar(1024) NOT NULL,
	`fileName` varchar(256) NOT NULL,
	`fileMimeType` varchar(128) NOT NULL DEFAULT 'application/pdf',
	`fileSizeBytes` int,
	`thumbnailUrl` varchar(1024),
	`applicationTags` json,
	`sectorTags` json,
	`keywordTags` json,
	`matchCount` int NOT NULL DEFAULT 0,
	`attachCount` int NOT NULL DEFAULT 0,
	`uploadedBy` int NOT NULL,
	`uploadedByName` varchar(256),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `collateralItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `collateralProjectMatches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`collateralId` int NOT NULL,
	`projectId` int NOT NULL,
	`matchScore` int NOT NULL DEFAULT 0,
	`matchReason` text,
	`wasUsedInOutreach` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `collateralProjectMatches_id` PRIMARY KEY(`id`)
);
