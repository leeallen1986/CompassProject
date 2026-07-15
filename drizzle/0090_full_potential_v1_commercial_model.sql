CREATE TABLE `fullPotentialEvidence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` int NOT NULL,
	`productFamily` enum('portable_air_small_medium','portable_air_large','specialty_air_boosters','e_air','dryers','nitrogen','dewatering','generators','bess','lighting','other'),
	`evidenceType` enum('internal_order_history','crm_history','service_warranty','fleetlink','distributor_channel','customer_discovery','public_source','tender_project','financial_assumption','other') NOT NULL,
	`title` varchar(512) NOT NULL,
	`summary` text NOT NULL,
	`sourceName` varchar(256),
	`sourceUrl` varchar(1024),
	`sourceReference` varchar(512),
	`observedAt` timestamp,
	`capturedBy` int,
	`capturedByName` varchar(256),
	`confidenceLevel` enum('high','medium','low','unknown') NOT NULL DEFAULT 'unknown',
	`status` enum('draft','verified','rejected','superseded') NOT NULL DEFAULT 'draft',
	`reviewNote` text,
	`reviewedBy` int,
	`reviewedByName` varchar(256),
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fullPotentialEvidence_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fullPotentialModelEvidenceLinks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`linkKey` varchar(128) NOT NULL,
	`modelId` int NOT NULL,
	`modelLineId` int,
	`evidenceId` int NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fullPotentialModelEvidenceLinks_id` PRIMARY KEY(`id`),
	CONSTRAINT `fullPotentialModelEvidenceLinks_linkKey_unique` UNIQUE(`linkKey`)
);
--> statement-breakpoint
CREATE TABLE `fullPotentialModelLines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lineKey` varchar(512) NOT NULL,
	`modelId` int NOT NULL,
	`accountId` int NOT NULL,
	`productFamily` enum('portable_air_small_medium','portable_air_large','specialty_air_boosters','e_air','dryers','nitrogen','dewatering','generators','bess','lighting','other') NOT NULL,
	`application` varchar(256) NOT NULL,
	`routeToMarket` enum('direct_ape','cea','cp_aps','cp_blastone','cp_pneumatic_engineering','cp_more_air','nz_distributor','png_oceania','hybrid_strategic','product_support','manual_review','exclude') NOT NULL,
	`currentSupplier` varchar(256),
	`currentRevenueAud` decimal(15,2),
	`knownAtlasFleetUnits` int,
	`estimatedTotalFleetUnits` int,
	`replacementCycleYears` decimal(6,2),
	`annualReplacementUnits` decimal(10,2),
	`averageSellingPriceAud` decimal(15,2),
	`addressableSharePct` decimal(5,2),
	`equipmentPotentialAud` decimal(15,2),
	`specialtyPotentialAud` decimal(15,2),
	`linePotentialAud` decimal(15,2) NOT NULL DEFAULT '0',
	`replacementCycleSource` varchar(512),
	`assumptions` json,
	`confidenceLevel` enum('high','medium','low','unknown') NOT NULL DEFAULT 'unknown',
	`createdBy` int NOT NULL,
	`updatedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fullPotentialModelLines_id` PRIMARY KEY(`id`),
	CONSTRAINT `fullPotentialModelLines_lineKey_unique` UNIQUE(`lineKey`)
);
--> statement-breakpoint
CREATE TABLE `fullPotentialModelReviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelId` int NOT NULL,
	`accountId` int NOT NULL,
	`action` enum('created','submitted','returned','approved','reopened','superseded') NOT NULL,
	`fromStatus` varchar(32),
	`toStatus` varchar(32) NOT NULL,
	`userId` int NOT NULL,
	`userName` varchar(256),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fullPotentialModelReviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fullPotentialModels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelKey` varchar(128) NOT NULL,
	`accountId` int NOT NULL,
	`versionNumber` int NOT NULL,
	`status` enum('draft','submitted','returned','approved','superseded') NOT NULL DEFAULT 'draft',
	`methodologyVersion` varchar(32) NOT NULL DEFAULT 'fp-v1',
	`currentRevenueAud` decimal(15,2),
	`totalPotentialAud` decimal(15,2),
	`remainingPotentialAud` decimal(15,2),
	`confidenceLevel` enum('high','medium','low','unknown') NOT NULL DEFAULT 'unknown',
	`assumptionsSummary` text,
	`createdBy` int NOT NULL,
	`createdByName` varchar(256),
	`submittedBy` int,
	`submittedByName` varchar(256),
	`submittedAt` timestamp,
	`reviewedBy` int,
	`reviewedByName` varchar(256),
	`reviewedAt` timestamp,
	`reviewNotes` text,
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fullPotentialModels_id` PRIMARY KEY(`id`),
	CONSTRAINT `fullPotentialModels_modelKey_unique` UNIQUE(`modelKey`)
);
--> statement-breakpoint
ALTER TABLE `fullPotentialAccounts` ADD `parentAccountId` int;--> statement-breakpoint
ALTER TABLE `fullPotentialAccounts` ADD `mergedIntoAccountId` int;--> statement-breakpoint
ALTER TABLE `fullPotentialAccounts` ADD `relationshipType` enum('standalone','parent','division','branch','site','service_unit','strategic_context','duplicate') DEFAULT 'standalone' NOT NULL;--> statement-breakpoint
ALTER TABLE `fullPotentialAccounts` ADD `recordStatus` enum('active','under_review','merged','parked','excluded') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `fullPotentialAccounts` ADD `countsTowardPotential` boolean DEFAULT true NOT NULL;