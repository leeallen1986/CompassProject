CREATE TABLE `contactProjects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contactId` int NOT NULL,
	`projectId` int NOT NULL,
	`projectName` varchar(512) NOT NULL,
	`relevance` enum('primary','secondary') DEFAULT 'primary',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contactProjects_id` PRIMARY KEY(`id`)
);
