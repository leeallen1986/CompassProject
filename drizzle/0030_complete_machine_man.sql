CREATE TABLE `userActivity` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`actionType` enum('project_viewed','contact_viewed','contact_enriched','outreach_drafted','outreach_sent','pipeline_claimed','pipeline_status_changed','pipeline_meeting_logged','pipeline_quote_uploaded','search_performed','project_exported') NOT NULL,
	`projectId` int,
	`contactId` int,
	`claimId` int,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `userActivity_id` PRIMARY KEY(`id`)
);
