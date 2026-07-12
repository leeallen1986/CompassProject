ALTER TABLE `pipelineClaims` MODIFY COLUMN `projectId` int;--> statement-breakpoint
ALTER TABLE `pipelineClaims` MODIFY COLUMN `reportId` int;--> statement-breakpoint
ALTER TABLE `pipelineClaims` MODIFY COLUMN `status` enum('identified','contacted','meeting_booked','qualified','quoted','won','lost','deferred','not_relevant') NOT NULL DEFAULT 'identified';--> statement-breakpoint
ALTER TABLE `userActivity` MODIFY COLUMN `actionType` enum('project_viewed','contact_viewed','contact_enriched','outreach_drafted','outreach_sent','pipeline_claimed','pipeline_stage_advanced','pipeline_status_changed','pipeline_meeting_logged','pipeline_quote_uploaded','search_performed','project_exported') NOT NULL;--> statement-breakpoint
ALTER TABLE `outreachEmails` ADD `claimId` int;--> statement-breakpoint
ALTER TABLE `outreachEmails` ADD `sourceAccountId` int;--> statement-breakpoint
ALTER TABLE `outreachEmails` ADD `openedInEmailAt` timestamp;--> statement-breakpoint
ALTER TABLE `outreachEmails` ADD `sentAt` timestamp;--> statement-breakpoint
ALTER TABLE `pipelineActivity` ADD `eventType` varchar(64);--> statement-breakpoint
ALTER TABLE `pipelineActivity` ADD `metadataJson` json;--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `sourceType` enum('project','full_potential','signal','ai_recommendation','manual','legacy') DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `sourceAccountId` int;--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `sourceSignalId` int;--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `sourceRecommendationKey` varchar(128);--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `productFamily` varchar(64);--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `application` varchar(128);--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `commercialHypothesis` text;--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `estimatedValueAud` decimal(14,2);--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `quoteValueAud` decimal(14,2);--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `contactId` int;--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `contactRole` varchar(128);--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `meetingObjective` text;--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `customerNeed` text;--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `decisionTiming` varchar(256);--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `competitivePosition` text;--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `closeDate` timestamp;--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `qualifiedAt` timestamp;--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD `openDedupeKey` varchar(512);--> statement-breakpoint
ALTER TABLE `pipelineClaims` ADD CONSTRAINT `pipelineClaims_openDedupeKey_unique` UNIQUE(`openDedupeKey`);