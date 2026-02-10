CREATE TABLE `projectFeedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int NOT NULL,
	`reportId` int NOT NULL,
	`vote` enum('up','down') NOT NULL,
	`reason` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `projectFeedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`companyName` varchar(256),
	`companyWebsite` varchar(512),
	`territories` json,
	`remoteMetroOnly` varchar(16),
	`industries` json,
	`offerCategories` json,
	`customerTypes` json,
	`dealSizeMin` varchar(32),
	`dealSizeMax` varchar(32),
	`stageTiming` json,
	`buyerRoles` json,
	`keyAccounts` json,
	`excludeAccounts` json,
	`aiSegments` json,
	`onboardingCompleted` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userProfiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `userProfiles_userId_unique` UNIQUE(`userId`)
);
