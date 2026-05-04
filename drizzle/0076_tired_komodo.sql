CREATE TABLE `projectValidationGates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`primaryAcceptable` boolean NOT NULL DEFAULT false,
	`backupAcceptable` boolean NOT NULL DEFAULT false,
	`digestSafe` boolean NOT NULL DEFAULT false,
	`gateSetBy` varchar(255),
	`gateSetAt` timestamp,
	`gateNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projectValidationGates_id` PRIMARY KEY(`id`),
	CONSTRAINT `projectValidationGates_projectId_unique` UNIQUE(`projectId`)
);
