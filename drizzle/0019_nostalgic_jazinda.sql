CREATE TABLE `outreachTemplates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`description` varchar(512),
	`subject` varchar(512) NOT NULL,
	`body` text NOT NULL,
	`tone` enum('professional','consultative','direct') NOT NULL,
	`roleBucket` varchar(128),
	`sector` varchar(128),
	`tags` json,
	`usageCount` int NOT NULL DEFAULT 0,
	`createdBy` int NOT NULL,
	`createdByName` varchar(256),
	`isShared` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `outreachTemplates_id` PRIMARY KEY(`id`)
);
