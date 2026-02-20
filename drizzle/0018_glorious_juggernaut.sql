CREATE TABLE `apolloCreditLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`userName` varchar(256),
	`action` enum('reveal','enrich_project','verify_email') NOT NULL,
	`creditsUsed` int NOT NULL DEFAULT 1,
	`contactId` int,
	`contactName` varchar(256),
	`projectId` int,
	`projectName` varchar(512),
	`apolloPersonId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `apolloCreditLog_id` PRIMARY KEY(`id`)
);
