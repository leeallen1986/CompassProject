CREATE TABLE `outreachEmails` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`contactId` int,
	`contactName` varchar(256) NOT NULL,
	`contactEmail` varchar(320),
	`projectId` int,
	`projectName` varchar(512),
	`subject` varchar(512) NOT NULL,
	`body` text NOT NULL,
	`tone` enum('professional','consultative','direct') NOT NULL,
	`status` enum('drafted','opened_in_email','sent') NOT NULL DEFAULT 'drafted',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `outreachEmails_id` PRIMARY KEY(`id`)
);
