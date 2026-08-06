CREATE TABLE `projectEvidenceClaimSources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`linkKey` varchar(128) NOT NULL,
	`projectId` int NOT NULL,
	`claimId` int NOT NULL,
	`sourceId` int NOT NULL,
	`supportScope` enum('principal_organisation','project_organisation_participation','package_ownership','contact_employment','contact_project_participation','buyer_authority','identity_only','contactability_only') NOT NULL,
	`stance` enum('supports','contradicts','context_only') NOT NULL,
	`supportStrength` enum('direct','corroborating','context_only') NOT NULL,
	`isPrimary` boolean NOT NULL DEFAULT false,
	`evidenceSummary` varchar(2048) NOT NULL,
	`sourceLocator` varchar(512),
	`createdBy` int NOT NULL,
	`createdByName` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`revokedBy` int,
	`revokedByName` varchar(256),
	`revokedAt` timestamp,
	`revocationReason` varchar(1024),
	CONSTRAINT `projectEvidenceClaimSources_id` PRIMARY KEY(`id`),
	CONSTRAINT `projectEvidenceClaimSources_linkKey_unique` UNIQUE(`linkKey`),
	CONSTRAINT `projectEvidenceClaimSources_binding_uidx` UNIQUE(`claimId`,`sourceId`,`supportScope`),
	CONSTRAINT `projectEvidenceClaimSources_id_project_uidx` UNIQUE(`id`,`projectId`),
	CONSTRAINT `projectEvidenceClaimSources_positive_ids_check` CHECK(`projectEvidenceClaimSources`.`projectId` > 0 AND `projectEvidenceClaimSources`.`claimId` > 0 AND `projectEvidenceClaimSources`.`sourceId` > 0 AND `projectEvidenceClaimSources`.`createdBy` > 0 AND (`projectEvidenceClaimSources`.`revokedBy` IS NULL OR `projectEvidenceClaimSources`.`revokedBy` > 0)),
	CONSTRAINT `projectEvidenceClaimSources_summary_check` CHECK(CHAR_LENGTH(TRIM(`projectEvidenceClaimSources`.`evidenceSummary`)) > 0),
	CONSTRAINT `projectEvidenceClaimSources_key_locator_check` CHECK(CHAR_LENGTH(TRIM(`projectEvidenceClaimSources`.`linkKey`)) > 0 AND (`projectEvidenceClaimSources`.`sourceLocator` IS NULL OR CHAR_LENGTH(TRIM(`projectEvidenceClaimSources`.`sourceLocator`)) > 0)),
	CONSTRAINT `projectEvidenceClaimSources_stance_strength_check` CHECK((`projectEvidenceClaimSources`.`stance` = 'context_only' AND `projectEvidenceClaimSources`.`supportStrength` = 'context_only') OR (`projectEvidenceClaimSources`.`stance` IN ('supports', 'contradicts') AND `projectEvidenceClaimSources`.`supportStrength` IN ('direct', 'corroborating'))),
	CONSTRAINT `projectEvidenceClaimSources_non_promoting_check` CHECK(`projectEvidenceClaimSources`.`supportScope` NOT IN ('identity_only', 'contactability_only') OR (`projectEvidenceClaimSources`.`stance` = 'context_only' AND `projectEvidenceClaimSources`.`supportStrength` = 'context_only' AND `projectEvidenceClaimSources`.`isPrimary` = false)),
	CONSTRAINT `projectEvidenceClaimSources_primary_check` CHECK(`projectEvidenceClaimSources`.`isPrimary` = false OR (`projectEvidenceClaimSources`.`stance` = 'supports' AND `projectEvidenceClaimSources`.`supportStrength` = 'direct')),
	CONSTRAINT `projectEvidenceClaimSources_revocation_check` CHECK((`projectEvidenceClaimSources`.`revokedAt` IS NULL AND `projectEvidenceClaimSources`.`revokedBy` IS NULL AND `projectEvidenceClaimSources`.`revocationReason` IS NULL) OR (`projectEvidenceClaimSources`.`revokedAt` IS NOT NULL AND `projectEvidenceClaimSources`.`revokedBy` IS NOT NULL AND `projectEvidenceClaimSources`.`revocationReason` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceClaimSources`.`revocationReason`)) > 0))
);
--> statement-breakpoint
CREATE TABLE `projectEvidenceClaims` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claimKey` varchar(128) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`currentKey` varchar(128),
	`targetFingerprint` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`claimType` enum('principal_organisation','project_organisation_participation','package_ownership','contact_employment','contact_project_participation','buyer_authority') NOT NULL,
	`contactId` int,
	`contactProjectId` int,
	`contractorProjectLinkId` int,
	`organisationId` int,
	`organisationName` varchar(256),
	`organisationRole` enum('principal','owner_operator','joint_venture','epc','head_contractor','contractor','subcontractor','package_holder','consultant','supplier','government','unknown'),
	`packageName` varchar(256),
	`packageScope` varchar(1024),
	`claimedTitle` varchar(256),
	`buyerFunction` enum('project_package_lead','plant_equipment_fleet','procurement_commercial','technical_site_operations','referral','unknown'),
	`assertedValue` varchar(1024) NOT NULL,
	`assertionMethod` enum('manual','imported','deterministic','provider_observed','llm_inferred') NOT NULL DEFAULT 'manual',
	`confidenceLevel` enum('high','medium','low','unknown') NOT NULL DEFAULT 'unknown',
	`confidenceScore` int,
	`status` enum('draft','active','disputed','rejected','superseded','expired') NOT NULL DEFAULT 'draft',
	`validFrom` timestamp,
	`validTo` timestamp,
	`assertedAt` timestamp NOT NULL,
	`lastCheckedAt` timestamp NOT NULL,
	`supersedesClaimId` int,
	`createdBy` int NOT NULL,
	`createdByName` varchar(256),
	`reviewedBy` int,
	`reviewedByName` varchar(256),
	`reviewedAt` timestamp,
	`reviewNote` varchar(2048),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projectEvidenceClaims_id` PRIMARY KEY(`id`),
	CONSTRAINT `projectEvidenceClaims_currentKey_unique` UNIQUE(`currentKey`),
	CONSTRAINT `projectEvidenceClaims_claim_version_uidx` UNIQUE(`claimKey`,`version`),
	CONSTRAINT `projectEvidenceClaims_id_project_uidx` UNIQUE(`id`,`projectId`),
	CONSTRAINT `projectEvidenceClaims_version_check` CHECK(`projectEvidenceClaims`.`version` >= 1),
	CONSTRAINT `projectEvidenceClaims_confidence_score_check` CHECK(`projectEvidenceClaims`.`confidenceScore` IS NULL OR (`projectEvidenceClaims`.`confidenceScore` >= 0 AND `projectEvidenceClaims`.`confidenceScore` <= 100)),
	CONSTRAINT `projectEvidenceClaims_target_fingerprint_check` CHECK(REGEXP_LIKE(`projectEvidenceClaims`.`targetFingerprint`, '^[0-9a-f]{64}$', 'c')),
	CONSTRAINT `projectEvidenceClaims_validity_check` CHECK(`projectEvidenceClaims`.`validTo` IS NULL OR `projectEvidenceClaims`.`validFrom` IS NULL OR `projectEvidenceClaims`.`validTo` > `projectEvidenceClaims`.`validFrom`),
	CONSTRAINT `projectEvidenceClaims_positive_ids_check` CHECK(`projectEvidenceClaims`.`projectId` > 0 AND `projectEvidenceClaims`.`createdBy` > 0 AND (`projectEvidenceClaims`.`contactId` IS NULL OR `projectEvidenceClaims`.`contactId` > 0) AND (`projectEvidenceClaims`.`contactProjectId` IS NULL OR `projectEvidenceClaims`.`contactProjectId` > 0) AND (`projectEvidenceClaims`.`contractorProjectLinkId` IS NULL OR `projectEvidenceClaims`.`contractorProjectLinkId` > 0) AND (`projectEvidenceClaims`.`organisationId` IS NULL OR `projectEvidenceClaims`.`organisationId` > 0) AND (`projectEvidenceClaims`.`supersedesClaimId` IS NULL OR `projectEvidenceClaims`.`supersedesClaimId` > 0) AND (`projectEvidenceClaims`.`reviewedBy` IS NULL OR `projectEvidenceClaims`.`reviewedBy` > 0)),
	CONSTRAINT `projectEvidenceClaims_current_revision_check` CHECK(((`projectEvidenceClaims`.`status` IN ('draft', 'active', 'disputed')) AND `projectEvidenceClaims`.`currentKey` IS NOT NULL AND `projectEvidenceClaims`.`currentKey` = `projectEvidenceClaims`.`claimKey`) OR ((`projectEvidenceClaims`.`status` IN ('rejected', 'superseded', 'expired')) AND `projectEvidenceClaims`.`currentKey` IS NULL)),
	CONSTRAINT `projectEvidenceClaims_active_review_check` CHECK(`projectEvidenceClaims`.`status` <> 'active' OR (`projectEvidenceClaims`.`reviewedBy` IS NOT NULL AND `projectEvidenceClaims`.`reviewedAt` IS NOT NULL)),
	CONSTRAINT `projectEvidenceClaims_asserted_value_check` CHECK(CHAR_LENGTH(TRIM(`projectEvidenceClaims`.`assertedValue`)) > 0),
	CONSTRAINT `projectEvidenceClaims_key_check` CHECK(CHAR_LENGTH(TRIM(`projectEvidenceClaims`.`claimKey`)) > 0 AND (`projectEvidenceClaims`.`currentKey` IS NULL OR CHAR_LENGTH(TRIM(`projectEvidenceClaims`.`currentKey`)) > 0)),
	CONSTRAINT `projectEvidenceClaims_optional_text_check` CHECK((`projectEvidenceClaims`.`organisationName` IS NULL OR CHAR_LENGTH(TRIM(`projectEvidenceClaims`.`organisationName`)) > 0) AND (`projectEvidenceClaims`.`packageName` IS NULL OR CHAR_LENGTH(TRIM(`projectEvidenceClaims`.`packageName`)) > 0) AND (`projectEvidenceClaims`.`packageScope` IS NULL OR CHAR_LENGTH(TRIM(`projectEvidenceClaims`.`packageScope`)) > 0) AND (`projectEvidenceClaims`.`claimedTitle` IS NULL OR CHAR_LENGTH(TRIM(`projectEvidenceClaims`.`claimedTitle`)) > 0)),
	CONSTRAINT `projectEvidenceClaims_subject_check` CHECK((`projectEvidenceClaims`.`claimType` = 'principal_organisation' AND `projectEvidenceClaims`.`organisationName` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceClaims`.`organisationName`)) > 0 AND `projectEvidenceClaims`.`contactId` IS NULL AND `projectEvidenceClaims`.`contactProjectId` IS NULL AND `projectEvidenceClaims`.`contractorProjectLinkId` IS NULL) OR (`projectEvidenceClaims`.`claimType` = 'project_organisation_participation' AND `projectEvidenceClaims`.`contractorProjectLinkId` IS NOT NULL AND `projectEvidenceClaims`.`organisationName` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceClaims`.`organisationName`)) > 0 AND `projectEvidenceClaims`.`contactId` IS NULL AND `projectEvidenceClaims`.`contactProjectId` IS NULL) OR (`projectEvidenceClaims`.`claimType` = 'package_ownership' AND `projectEvidenceClaims`.`contractorProjectLinkId` IS NOT NULL AND `projectEvidenceClaims`.`organisationName` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceClaims`.`organisationName`)) > 0 AND ((`projectEvidenceClaims`.`packageName` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceClaims`.`packageName`)) > 0) OR (`projectEvidenceClaims`.`packageScope` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceClaims`.`packageScope`)) > 0)) AND `projectEvidenceClaims`.`contactId` IS NULL AND `projectEvidenceClaims`.`contactProjectId` IS NULL) OR (`projectEvidenceClaims`.`claimType` = 'contact_employment' AND `projectEvidenceClaims`.`contactId` IS NOT NULL AND `projectEvidenceClaims`.`contactProjectId` IS NOT NULL AND `projectEvidenceClaims`.`organisationName` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceClaims`.`organisationName`)) > 0) OR (`projectEvidenceClaims`.`claimType` = 'contact_project_participation' AND `projectEvidenceClaims`.`contactId` IS NOT NULL AND `projectEvidenceClaims`.`contactProjectId` IS NOT NULL) OR (`projectEvidenceClaims`.`claimType` = 'buyer_authority' AND `projectEvidenceClaims`.`contactId` IS NOT NULL AND `projectEvidenceClaims`.`contactProjectId` IS NOT NULL AND `projectEvidenceClaims`.`buyerFunction` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `projectEvidenceEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventKey` varchar(128) NOT NULL,
	`projectId` int NOT NULL,
	`claimId` int,
	`sourceId` int,
	`claimSourceId` int,
	`eventType` enum('claim_created','claim_activated','claim_disputed','claim_rejected','claim_superseded','claim_expired','source_submitted','source_approved','source_rejected','source_revoked','source_superseded','binding_created','binding_revoked') NOT NULL,
	`actorUserId` int NOT NULL,
	`actorName` varchar(256),
	`previousStatus` varchar(32),
	`nextStatus` varchar(32),
	`expectedRevision` int,
	`nextRevision` int,
	`reason` varchar(1024),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `projectEvidenceEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `projectEvidenceEvents_eventKey_unique` UNIQUE(`eventKey`),
	CONSTRAINT `projectEvidenceEvents_positive_ids_check` CHECK(`projectEvidenceEvents`.`projectId` > 0 AND `projectEvidenceEvents`.`actorUserId` > 0 AND (`projectEvidenceEvents`.`claimId` IS NULL OR `projectEvidenceEvents`.`claimId` > 0) AND (`projectEvidenceEvents`.`sourceId` IS NULL OR `projectEvidenceEvents`.`sourceId` > 0) AND (`projectEvidenceEvents`.`claimSourceId` IS NULL OR `projectEvidenceEvents`.`claimSourceId` > 0)),
	CONSTRAINT `projectEvidenceEvents_key_check` CHECK(CHAR_LENGTH(TRIM(`projectEvidenceEvents`.`eventKey`)) > 0),
	CONSTRAINT `projectEvidenceEvents_subject_check` CHECK((`projectEvidenceEvents`.`eventType` IN ('claim_created', 'claim_activated', 'claim_disputed', 'claim_rejected', 'claim_superseded', 'claim_expired') AND `projectEvidenceEvents`.`claimId` IS NOT NULL AND `projectEvidenceEvents`.`sourceId` IS NULL AND `projectEvidenceEvents`.`claimSourceId` IS NULL) OR (`projectEvidenceEvents`.`eventType` IN ('source_submitted', 'source_approved', 'source_rejected', 'source_revoked', 'source_superseded') AND `projectEvidenceEvents`.`claimId` IS NULL AND `projectEvidenceEvents`.`sourceId` IS NOT NULL AND `projectEvidenceEvents`.`claimSourceId` IS NULL) OR (`projectEvidenceEvents`.`eventType` IN ('binding_created', 'binding_revoked') AND `projectEvidenceEvents`.`claimId` IS NULL AND `projectEvidenceEvents`.`sourceId` IS NULL AND `projectEvidenceEvents`.`claimSourceId` IS NOT NULL)),
	CONSTRAINT `projectEvidenceEvents_revision_check` CHECK((`projectEvidenceEvents`.`expectedRevision` IS NULL AND (`projectEvidenceEvents`.`nextRevision` IS NULL OR `projectEvidenceEvents`.`nextRevision` = 1)) OR (`projectEvidenceEvents`.`expectedRevision` IS NOT NULL AND `projectEvidenceEvents`.`nextRevision` IS NOT NULL AND `projectEvidenceEvents`.`expectedRevision` >= 1 AND `projectEvidenceEvents`.`nextRevision` = `projectEvidenceEvents`.`expectedRevision` + 1)),
	CONSTRAINT `projectEvidenceEvents_reason_check` CHECK((`projectEvidenceEvents`.`reason` IS NULL OR CHAR_LENGTH(TRIM(`projectEvidenceEvents`.`reason`)) > 0) AND (`projectEvidenceEvents`.`eventType` NOT IN ('claim_disputed', 'claim_rejected', 'claim_superseded', 'claim_expired', 'source_rejected', 'source_revoked', 'source_superseded', 'binding_revoked') OR (`projectEvidenceEvents`.`reason` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceEvents`.`reason`)) > 0)))
);
--> statement-breakpoint
CREATE TABLE `projectEvidenceSources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceKey` varchar(128) NOT NULL,
	`openDedupeKey` varchar(128),
	`projectId` int NOT NULL,
	`sourceType` enum('official_project_site','government_notice','tender_document','award_notice','organisation_website','professional_profile','crm_record','direct_confirmation','internal_document','provider_record','public_web','other') NOT NULL,
	`sourceName` varchar(256) NOT NULL,
	`sourceUrl` varchar(2048),
	`sourceHost` varchar(253),
	`sourceReference` varchar(512),
	`publisher` varchar(256),
	`documentTitle` varchar(512) NOT NULL,
	`sourcePublishedAt` timestamp,
	`observedAt` timestamp,
	`retrievedAt` timestamp NOT NULL,
	`lastCheckedAt` timestamp NOT NULL,
	`validFrom` timestamp,
	`validTo` timestamp,
	`contentHash` varchar(64),
	`confidenceLevel` enum('high','medium','low','unknown') NOT NULL DEFAULT 'unknown',
	`privacyClass` enum('public','internal','confidential','restricted') NOT NULL DEFAULT 'restricted',
	`containsPersonalData` boolean NOT NULL DEFAULT true,
	`status` enum('proposed','approved','rejected','revoked','superseded') NOT NULL DEFAULT 'proposed',
	`revision` int NOT NULL DEFAULT 1,
	`supersedesSourceId` int,
	`capturedBy` int NOT NULL,
	`capturedByName` varchar(256),
	`reviewedBy` int,
	`reviewedByName` varchar(256),
	`reviewedAt` timestamp,
	`reviewNote` varchar(2048),
	`revokedBy` int,
	`revokedByName` varchar(256),
	`revokedAt` timestamp,
	`revocationReason` varchar(1024),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projectEvidenceSources_id` PRIMARY KEY(`id`),
	CONSTRAINT `projectEvidenceSources_sourceKey_unique` UNIQUE(`sourceKey`),
	CONSTRAINT `projectEvidenceSources_openDedupeKey_unique` UNIQUE(`openDedupeKey`),
	CONSTRAINT `projectEvidenceSources_id_project_uidx` UNIQUE(`id`,`projectId`),
	CONSTRAINT `projectEvidenceSources_revision_check` CHECK(`projectEvidenceSources`.`revision` >= 1),
	CONSTRAINT `projectEvidenceSources_content_hash_check` CHECK(`projectEvidenceSources`.`contentHash` IS NULL OR REGEXP_LIKE(`projectEvidenceSources`.`contentHash`, '^[0-9a-f]{64}$', 'c')),
	CONSTRAINT `projectEvidenceSources_validity_check` CHECK(`projectEvidenceSources`.`validTo` IS NULL OR `projectEvidenceSources`.`validFrom` IS NULL OR `projectEvidenceSources`.`validTo` > `projectEvidenceSources`.`validFrom`),
	CONSTRAINT `projectEvidenceSources_locator_check` CHECK((`projectEvidenceSources`.`sourceUrl` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceSources`.`sourceUrl`)) > 0) OR (`projectEvidenceSources`.`sourceReference` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceSources`.`sourceReference`)) > 0)),
	CONSTRAINT `projectEvidenceSources_url_host_check` CHECK((`projectEvidenceSources`.`sourceUrl` IS NULL AND `projectEvidenceSources`.`sourceHost` IS NULL) OR (`projectEvidenceSources`.`sourceUrl` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceSources`.`sourceUrl`)) > 0 AND `projectEvidenceSources`.`sourceHost` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceSources`.`sourceHost`)) > 0)),
	CONSTRAINT `projectEvidenceSources_key_check` CHECK(CHAR_LENGTH(TRIM(`projectEvidenceSources`.`sourceKey`)) > 0 AND (`projectEvidenceSources`.`openDedupeKey` IS NULL OR CHAR_LENGTH(TRIM(`projectEvidenceSources`.`openDedupeKey`)) > 0)),
	CONSTRAINT `projectEvidenceSources_text_check` CHECK(CHAR_LENGTH(TRIM(`projectEvidenceSources`.`sourceName`)) > 0 AND CHAR_LENGTH(TRIM(`projectEvidenceSources`.`documentTitle`)) > 0 AND (`projectEvidenceSources`.`sourceReference` IS NULL OR CHAR_LENGTH(TRIM(`projectEvidenceSources`.`sourceReference`)) > 0)),
	CONSTRAINT `projectEvidenceSources_lifecycle_check` CHECK((`projectEvidenceSources`.`status` IN ('proposed', 'approved') AND `projectEvidenceSources`.`openDedupeKey` IS NOT NULL) OR (`projectEvidenceSources`.`status` IN ('rejected', 'revoked', 'superseded') AND `projectEvidenceSources`.`openDedupeKey` IS NULL)),
	CONSTRAINT `projectEvidenceSources_approval_check` CHECK(`projectEvidenceSources`.`status` NOT IN ('approved', 'rejected', 'revoked', 'superseded') OR (`projectEvidenceSources`.`reviewedBy` IS NOT NULL AND `projectEvidenceSources`.`reviewedAt` IS NOT NULL)),
	CONSTRAINT `projectEvidenceSources_revocation_check` CHECK(`projectEvidenceSources`.`status` <> 'revoked' OR (`projectEvidenceSources`.`revokedBy` IS NOT NULL AND `projectEvidenceSources`.`revokedAt` IS NOT NULL AND `projectEvidenceSources`.`revocationReason` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceSources`.`revocationReason`)) > 0)),
	CONSTRAINT `projectEvidenceSources_decision_reason_check` CHECK(`projectEvidenceSources`.`status` NOT IN ('rejected', 'superseded') OR (`projectEvidenceSources`.`reviewNote` IS NOT NULL AND CHAR_LENGTH(TRIM(`projectEvidenceSources`.`reviewNote`)) > 0)),
	CONSTRAINT `projectEvidenceSources_positive_ids_check` CHECK(`projectEvidenceSources`.`projectId` > 0 AND `projectEvidenceSources`.`capturedBy` > 0 AND (`projectEvidenceSources`.`supersedesSourceId` IS NULL OR `projectEvidenceSources`.`supersedesSourceId` > 0) AND (`projectEvidenceSources`.`reviewedBy` IS NULL OR `projectEvidenceSources`.`reviewedBy` > 0) AND (`projectEvidenceSources`.`revokedBy` IS NULL OR `projectEvidenceSources`.`revokedBy` > 0))
);
--> statement-breakpoint
CREATE INDEX `projectEvidenceClaimSources_project_claim_idx` ON `projectEvidenceClaimSources` (`projectId`,`claimId`);--> statement-breakpoint
CREATE INDEX `projectEvidenceClaimSources_claim_revoked_idx` ON `projectEvidenceClaimSources` (`claimId`,`projectId`,`revokedAt`);--> statement-breakpoint
CREATE INDEX `projectEvidenceClaimSources_source_revoked_idx` ON `projectEvidenceClaimSources` (`sourceId`,`projectId`,`revokedAt`);--> statement-breakpoint
CREATE INDEX `projectEvidenceClaims_project_status_type_idx` ON `projectEvidenceClaims` (`projectId`,`status`,`claimType`,`validTo`);--> statement-breakpoint
CREATE INDEX `projectEvidenceClaims_contact_status_idx` ON `projectEvidenceClaims` (`contactId`,`status`,`validTo`);--> statement-breakpoint
CREATE INDEX `projectEvidenceClaims_contact_project_status_idx` ON `projectEvidenceClaims` (`contactProjectId`,`status`,`validTo`);--> statement-breakpoint
CREATE INDEX `projectEvidenceClaims_contractor_link_status_idx` ON `projectEvidenceClaims` (`contractorProjectLinkId`,`status`);--> statement-breakpoint
CREATE INDEX `projectEvidenceClaims_organisation_status_idx` ON `projectEvidenceClaims` (`organisationId`,`status`);--> statement-breakpoint
CREATE INDEX `projectEvidenceClaims_supersedes_idx` ON `projectEvidenceClaims` (`supersedesClaimId`,`projectId`);--> statement-breakpoint
CREATE INDEX `projectEvidenceEvents_project_created_idx` ON `projectEvidenceEvents` (`projectId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `projectEvidenceEvents_claim_created_idx` ON `projectEvidenceEvents` (`claimId`,`projectId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `projectEvidenceEvents_source_created_idx` ON `projectEvidenceEvents` (`sourceId`,`projectId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `projectEvidenceEvents_binding_created_idx` ON `projectEvidenceEvents` (`claimSourceId`,`projectId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `projectEvidenceSources_project_status_idx` ON `projectEvidenceSources` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `projectEvidenceSources_status_checked_idx` ON `projectEvidenceSources` (`status`,`lastCheckedAt`,`validTo`);--> statement-breakpoint
CREATE INDEX `projectEvidenceSources_type_status_idx` ON `projectEvidenceSources` (`sourceType`,`status`);--> statement-breakpoint
CREATE INDEX `projectEvidenceSources_content_hash_idx` ON `projectEvidenceSources` (`contentHash`);--> statement-breakpoint
CREATE INDEX `projectEvidenceSources_supersedes_idx` ON `projectEvidenceSources` (`supersedesSourceId`,`projectId`);--> statement-breakpoint
ALTER TABLE `projectEvidenceClaimSources` ADD CONSTRAINT `projectEvidenceClaimSources_claim_project_fk` FOREIGN KEY (`claimId`,`projectId`) REFERENCES `projectEvidenceClaims`(`id`,`projectId`);--> statement-breakpoint
ALTER TABLE `projectEvidenceClaimSources` ADD CONSTRAINT `projectEvidenceClaimSources_source_project_fk` FOREIGN KEY (`sourceId`,`projectId`) REFERENCES `projectEvidenceSources`(`id`,`projectId`);--> statement-breakpoint
ALTER TABLE `projectEvidenceClaims` ADD CONSTRAINT `projectEvidenceClaims_supersedes_project_fk` FOREIGN KEY (`supersedesClaimId`,`projectId`) REFERENCES `projectEvidenceClaims`(`id`,`projectId`);--> statement-breakpoint
ALTER TABLE `projectEvidenceEvents` ADD CONSTRAINT `projectEvidenceEvents_claim_project_fk` FOREIGN KEY (`claimId`,`projectId`) REFERENCES `projectEvidenceClaims`(`id`,`projectId`);--> statement-breakpoint
ALTER TABLE `projectEvidenceEvents` ADD CONSTRAINT `projectEvidenceEvents_source_project_fk` FOREIGN KEY (`sourceId`,`projectId`) REFERENCES `projectEvidenceSources`(`id`,`projectId`);--> statement-breakpoint
ALTER TABLE `projectEvidenceEvents` ADD CONSTRAINT `projectEvidenceEvents_binding_project_fk` FOREIGN KEY (`claimSourceId`,`projectId`) REFERENCES `projectEvidenceClaimSources`(`id`,`projectId`);--> statement-breakpoint
ALTER TABLE `projectEvidenceSources` ADD CONSTRAINT `projectEvidenceSources_supersedes_project_fk` FOREIGN KEY (`supersedesSourceId`,`projectId`) REFERENCES `projectEvidenceSources`(`id`,`projectId`);
