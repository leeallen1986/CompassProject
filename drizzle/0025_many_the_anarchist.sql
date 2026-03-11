CREATE TABLE `projectoryContractorFrequency` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contractorName` varchar(256) NOT NULL,
	`role` varchar(128) NOT NULL,
	`projectCount` int NOT NULL DEFAULT 1,
	`projectIds` json,
	`sectors` json,
	`states` json,
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projectoryContractorFrequency_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projectoryEnrichmentLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`projectName` varchar(512) NOT NULL,
	`projectoryUrl` varchar(512),
	`status` enum('matched','not_found','auth_expired','error') NOT NULL,
	`contractorsFound` json,
	`consultantsFound` json,
	`stakeholdersFound` json,
	`stageUpdate` varchar(256),
	`valueUpdate` varchar(128),
	`timelineSignals` json,
	`searchQuery` varchar(512),
	`enrichedAt` timestamp NOT NULL DEFAULT (now()),
	`errorMessage` text,
	CONSTRAINT `projectoryEnrichmentLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `pipelineRuns` ADD `projectoryEnriched` int DEFAULT 0;