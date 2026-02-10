CREATE TABLE `emailDigestPrefs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`frequency` enum('weekly','daily','none') NOT NULL DEFAULT 'weekly',
	`includeHotOnly` boolean NOT NULL DEFAULT false,
	`includeContacts` boolean NOT NULL DEFAULT true,
	`includePipelineUpdates` boolean NOT NULL DEFAULT true,
	`lastSentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emailDigestPrefs_id` PRIMARY KEY(`id`),
	CONSTRAINT `emailDigestPrefs_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `pipelineActivity` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claimId` int NOT NULL,
	`userId` int NOT NULL,
	`fromStatus` varchar(32),
	`toStatus` varchar(32) NOT NULL,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pipelineActivity_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pipelineClaims` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int NOT NULL,
	`reportId` int NOT NULL,
	`status` enum('identified','contacted','meeting_booked','quoted','won','lost') NOT NULL DEFAULT 'identified',
	`notes` text,
	`estimatedValue` varchar(64),
	`nextAction` varchar(512),
	`nextActionDate` timestamp,
	`contactName` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pipelineClaims_id` PRIMARY KEY(`id`)
);
