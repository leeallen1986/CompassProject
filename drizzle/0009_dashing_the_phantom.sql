CREATE TABLE `projectEnrichmentCache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int,
	`rolesSearched` json,
	`companiesSearched` json,
	`contactsFound` int NOT NULL DEFAULT 0,
	`contactsNew` int NOT NULL DEFAULT 0,
	`apiCallsMade` int NOT NULL DEFAULT 0,
	`enrichedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `projectEnrichmentCache_id` PRIMARY KEY(`id`)
);
