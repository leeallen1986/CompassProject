ALTER TABLE `pipelineRuns` ADD `projectoryProjects` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `pipelineRuns` ADD `govProjects` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `pipelineRuns` ADD `aemoProjects` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `pipelineRuns` ADD `icnProjects` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `pipelineRuns` ADD `steps` json;