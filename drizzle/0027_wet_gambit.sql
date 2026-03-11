CREATE TABLE `contractorPairings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`companyAId` int NOT NULL,
	`companyAName` varchar(256) NOT NULL,
	`companyARoleInPairing` varchar(64) NOT NULL,
	`companyBId` int NOT NULL,
	`companyBName` varchar(256) NOT NULL,
	`companyBRoleInPairing` varchar(64) NOT NULL,
	`pairingType` enum('owner_epc','owner_contractor','contractor_consultant','contractor_subcontractor','contractor_region','epc_subcontractor','other') NOT NULL,
	`coOccurrenceCount` int NOT NULL DEFAULT 1,
	`projectIds` json,
	`sectors` json,
	`states` json,
	`strengthScore` int DEFAULT 0,
	`lastSeenAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contractorPairings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contractorProjectLinks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contractorId` int NOT NULL,
	`projectId` int NOT NULL,
	`role` enum('owner','epc','contractor','subcontractor','consultant','supplier','rental','government','unknown') NOT NULL DEFAULT 'unknown',
	`status` enum('confirmed','predicted','tendering','historical') NOT NULL DEFAULT 'predicted',
	`detail` text,
	`confidence` int DEFAULT 50,
	`source` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contractorProjectLinks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contractorRegistry` (
	`id` int AUTO_INCREMENT NOT NULL,
	`canonicalName` varchar(256) NOT NULL,
	`aliases` json,
	`primaryRole` enum('owner','epc','contractor','subcontractor','consultant','supplier','rental','government','unknown') NOT NULL DEFAULT 'unknown',
	`additionalRoles` json,
	`projectCount` int NOT NULL DEFAULT 0,
	`confirmedCount` int NOT NULL DEFAULT 0,
	`predictedCount` int NOT NULL DEFAULT 0,
	`sectorBreakdown` json,
	`stateBreakdown` json,
	`stageBreakdown` json,
	`recentProjectIds` json,
	`firstSeenAt` timestamp,
	`lastSeenAt` timestamp,
	`momentumScore` int DEFAULT 0,
	`recurrenceScore` int DEFAULT 0,
	`atlasRelevanceScore` int DEFAULT 0,
	`earlySignalScore` int DEFAULT 0,
	`compositeScore` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contractorRegistry_id` PRIMARY KEY(`id`),
	CONSTRAINT `contractorRegistry_canonicalName_unique` UNIQUE(`canonicalName`)
);
--> statement-breakpoint
CREATE TABLE `emergingPatterns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`patternType` enum('contractor_surge','sector_clustering','pairing_activation','stage_progression','new_entrant','regional_momentum','supply_chain_signal') NOT NULL,
	`title` varchar(512) NOT NULL,
	`description` text NOT NULL,
	`signalStrength` enum('strong','moderate','emerging') NOT NULL,
	`contractorIds` json,
	`projectIds` json,
	`pairingIds` json,
	`sectors` json,
	`states` json,
	`atlasRelevance` text,
	`suggestedAction` text,
	`detectedAt` timestamp NOT NULL DEFAULT (now()),
	`reportId` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emergingPatterns_id` PRIMARY KEY(`id`)
);
