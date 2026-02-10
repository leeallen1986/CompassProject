CREATE TABLE `awardedProjects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportId` int NOT NULL,
	`project` varchar(256) NOT NULL,
	`value` varchar(64) NOT NULL,
	`winningContractor` varchar(256) NOT NULL,
	`location` varchar(256) NOT NULL,
	`stage` varchar(128) NOT NULL,
	`opportunity` enum('Direct','Fleet','Monitor') NOT NULL,
	`sourceLabel` varchar(256),
	`sourceUrl` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `awardedProjects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportId` int NOT NULL,
	`name` varchar(256) NOT NULL,
	`title` varchar(256) NOT NULL,
	`company` varchar(256) NOT NULL,
	`project` varchar(512) NOT NULL,
	`priority` enum('hot','warm','cold') NOT NULL,
	`roleBucket` varchar(128) NOT NULL,
	`email` varchar(320),
	`linkedin` varchar(512),
	`phone` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `drillingCampaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportId` int NOT NULL,
	`campaign` varchar(256) NOT NULL,
	`operator` varchar(256) NOT NULL,
	`location` varchar(256) NOT NULL,
	`drillType` varchar(128) NOT NULL,
	`timing` varchar(128) NOT NULL,
	`airRequirement` varchar(128) NOT NULL,
	`sourceLabel` varchar(256),
	`sourceUrl` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `drillingCampaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportId` int NOT NULL,
	`projectKey` varchar(128) NOT NULL,
	`name` varchar(512) NOT NULL,
	`location` varchar(256) NOT NULL,
	`value` varchar(64) NOT NULL,
	`owner` varchar(256) NOT NULL,
	`priority` enum('hot','warm','cold') NOT NULL,
	`capexGrade` enum('A','B','Unknown') NOT NULL DEFAULT 'Unknown',
	`opportunityRoute` enum('Direct CAPEX','Fleet CAPEX','OPEX/Monitor') NOT NULL,
	`sector` enum('mining','oil_gas','infrastructure','energy','defence') NOT NULL,
	`isNew` boolean NOT NULL DEFAULT false,
	`stage` varchar(256),
	`overview` text,
	`equipmentSignals` json,
	`contractors` json,
	`opportunityNote` text,
	`sources` json,
	`timeline` varchar(256),
	`completion` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`weekEnding` varchar(32) NOT NULL,
	`generatedTime` varchar(64) NOT NULL,
	`totalProjects` int NOT NULL DEFAULT 0,
	`hotProjects` int NOT NULL DEFAULT 0,
	`warmProjects` int NOT NULL DEFAULT 0,
	`coldProjects` int NOT NULL DEFAULT 0,
	`confirmedContractors` int NOT NULL DEFAULT 0,
	`predictedContractors` int NOT NULL DEFAULT 0,
	`capexOpportunities` int NOT NULL DEFAULT 0,
	`totalContacts` int NOT NULL DEFAULT 0,
	`sourcesSearched` varchar(16) NOT NULL DEFAULT '20+',
	`newProjectsCount` int NOT NULL DEFAULT 0,
	`executiveSummaryMain` text,
	`executiveSummaryChanges` text,
	`actionItems` json,
	`researchPasses` json,
	`sourceCategories` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reports_id` PRIMARY KEY(`id`)
);
