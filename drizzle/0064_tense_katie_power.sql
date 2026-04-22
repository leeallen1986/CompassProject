CREATE TABLE `managerRollupRecipients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`addedBy` int NOT NULL,
	`addedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `managerRollupRecipients_id` PRIMARY KEY(`id`)
);
