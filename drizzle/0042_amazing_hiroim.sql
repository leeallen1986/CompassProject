CREATE TABLE `userEmailSendLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`digestType` enum('monday','thursday') NOT NULL,
	`sentDate` varchar(10) NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`status` enum('sent','failed') NOT NULL DEFAULT 'sent',
	`error` text,
	CONSTRAINT `userEmailSendLog_id` PRIMARY KEY(`id`)
);
