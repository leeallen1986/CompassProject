CREATE TABLE `dismissedActions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`actionKey` varchar(128) NOT NULL,
	`reason` enum('dismissed','completed','not_relevant') NOT NULL DEFAULT 'dismissed',
	`weekLabel` varchar(16),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dismissedActions_id` PRIMARY KEY(`id`)
);
