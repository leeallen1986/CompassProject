CREATE TABLE `digestSendControl` (
	`id` int AUTO_INCREMENT NOT NULL,
	`territory` varchar(32) NOT NULL,
	`firstSendApproved` boolean NOT NULL DEFAULT false,
	`firstSendApprovedAt` timestamp,
	`firstSendApprovedBy` varchar(255),
	`autoSendEnabled` boolean NOT NULL DEFAULT false,
	`lastPreviewAt` timestamp,
	`lastLiveSendAt` timestamp,
	`liveSendCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `digestSendControl_id` PRIMARY KEY(`id`)
);
