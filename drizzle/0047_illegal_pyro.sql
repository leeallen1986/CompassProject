CREATE TABLE `campaignEmailTemplates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`name` varchar(256) NOT NULL DEFAULT 'Default Template',
	`subjectTemplate` text NOT NULL,
	`bodyTemplate` text NOT NULL,
	`greetingStyle` varchar(64) NOT NULL DEFAULT 'Hi {{firstName}},',
	`signOffStyle` varchar(64) NOT NULL DEFAULT 'Kind regards,',
	`senderSignature` text,
	`mergeFields` json,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaignEmailTemplates_id` PRIMARY KEY(`id`)
);
