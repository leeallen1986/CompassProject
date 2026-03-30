CREATE TABLE `digestScheduleLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`digestType` enum('monday','thursday') NOT NULL,
	`scheduledFor` timestamp NOT NULL,
	`sentAt` timestamp,
	`status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `digestScheduleLog_id` PRIMARY KEY(`id`)
);
