CREATE TABLE `projectBusinessLineScores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`scoringDimension` varchar(64) NOT NULL,
	`score` int NOT NULL DEFAULT 0,
	`explanation` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projectBusinessLineScores_id` PRIMARY KEY(`id`)
);
