CREATE TABLE `lushaEnrichmentLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contactId` int NOT NULL,
	`projectId` int NOT NULL,
	`queryInput` json,
	`emailFound` varchar(320),
	`phoneFound` varchar(64),
	`titleFound` varchar(256),
	`lushaStatus` enum('enriched','not_found','failed') NOT NULL,
	`contactPromoted` boolean NOT NULL DEFAULT false,
	`creditsUsed` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lushaEnrichmentLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `contacts` MODIFY COLUMN `enrichmentSource` enum('linkedin','llm','manual','apollo','web_search','lusha') DEFAULT 'linkedin';