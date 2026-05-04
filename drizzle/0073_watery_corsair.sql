ALTER TABLE `pipelineRuns` ADD `lastProgressAt` timestamp;--> statement-breakpoint
ALTER TABLE `pipelineRuns` ADD `currentStep` varchar(128);--> statement-breakpoint
ALTER TABLE `pipelineRuns` ADD `lastActivityNote` varchar(512);