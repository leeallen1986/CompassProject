-- ============================================================================
-- Sprint 2A: Pipeline Attribution Spine
-- Migration: 0089_sprint2a_pipeline_attribution
-- ============================================================================
--
-- PREFLIGHT CHECKS (run manually before applying in production):
--
--   SELECT COUNT(*) FROM pipelineClaims WHERE sourceType IS NULL;
--   -- Expected: 0 after this migration runs (all rows backfilled to 'project')
--
--   SELECT COUNT(*) FROM pipelineClaims WHERE projectId IS NULL AND reportId IS NULL;
--   -- Expected: 0 before this migration (all existing rows have both set)
--
--   SELECT DISTINCT status FROM pipelineClaims;
--   -- Expected: subset of ('identified','contacted','meeting_booked','quoted','won','lost')
--   -- The new enum adds: 'qualified','deferred','not_relevant'
--
-- ROLLBACK INSTRUCTIONS (run in reverse order if rollback is needed):
--
--   -- 1. Revert outreachEmails
--   ALTER TABLE `outreachEmails`
--     DROP COLUMN IF EXISTS `sentAt`,
--     DROP COLUMN IF EXISTS `openedInEmailAt`,
--     DROP COLUMN IF EXISTS `sourceAccountId`,
--     DROP COLUMN IF EXISTS `claimId`;
--
--   -- 2. Revert pipelineActivity
--   ALTER TABLE `pipelineActivity`
--     DROP COLUMN IF EXISTS `metadataJson`,
--     DROP COLUMN IF EXISTS `eventType`;
--
--   -- 3. Revert pipelineClaims (status enum cannot be narrowed safely; restore manually)
--   ALTER TABLE `pipelineClaims`
--     DROP COLUMN IF EXISTS `qualifiedAt`,
--     DROP COLUMN IF EXISTS `closeDate`,
--     DROP COLUMN IF EXISTS `contactRole`,
--     DROP COLUMN IF EXISTS `contactId`,
--     DROP COLUMN IF EXISTS `estimatedValueAud`,
--     DROP COLUMN IF EXISTS `application`,
--     DROP COLUMN IF EXISTS `productFamily`,
--     DROP COLUMN IF EXISTS `sourceRecommendationKey`,
--     DROP COLUMN IF EXISTS `sourceSignalId`,
--     DROP COLUMN IF EXISTS `sourceAccountId`,
--     DROP COLUMN IF EXISTS `sourceType`;
--   ALTER TABLE `pipelineClaims` MODIFY COLUMN `projectId` int NOT NULL;
--   ALTER TABLE `pipelineClaims` MODIFY COLUMN `reportId` int NOT NULL;
--
--   -- 4. Revert userActivity actionType enum
--   ALTER TABLE `userActivity` MODIFY COLUMN `actionType`
--     enum('project_viewed','contact_viewed','contact_enriched','outreach_drafted','outreach_sent',
--          'pipeline_claimed','pipeline_status_changed','pipeline_meeting_logged',
--          'pipeline_quote_uploaded','search_performed','project_exported') NOT NULL;
--
-- ============================================================================

-- ── 1. pipelineClaims: make projectId/reportId nullable ─────────────────────
ALTER TABLE `pipelineClaims`
  MODIFY COLUMN `projectId` int NULL,
  MODIFY COLUMN `reportId` int NULL;
--> statement-breakpoint

-- ── 2. pipelineClaims: add sourceType and attribution columns ────────────────
ALTER TABLE `pipelineClaims`
  ADD COLUMN `sourceType` enum('project','full_potential','signal','ai_recommendation','manual','legacy') NOT NULL DEFAULT 'project' AFTER `reportId`,
  ADD COLUMN `sourceAccountId` int NULL AFTER `sourceType`,
  ADD COLUMN `sourceSignalId` int NULL AFTER `sourceAccountId`,
  ADD COLUMN `sourceRecommendationKey` varchar(128) NULL AFTER `sourceSignalId`,
  ADD COLUMN `productFamily` varchar(64) NULL AFTER `sourceRecommendationKey`,
  ADD COLUMN `application` varchar(128) NULL AFTER `productFamily`;
--> statement-breakpoint

-- ── 3. pipelineClaims: expand status enum and add stage-gate columns ─────────
ALTER TABLE `pipelineClaims`
  MODIFY COLUMN `status` enum('identified','contacted','meeting_booked','qualified','quoted','won','lost','deferred','not_relevant') NOT NULL DEFAULT 'identified',
  ADD COLUMN `estimatedValueAud` decimal(14,2) NULL AFTER `estimatedValue`,
  ADD COLUMN `contactId` int NULL AFTER `contactName`,
  ADD COLUMN `contactRole` varchar(128) NULL AFTER `contactId`,
  ADD COLUMN `closeDate` timestamp NULL AFTER `nextActionDate`,
  ADD COLUMN `qualifiedAt` timestamp NULL AFTER `closeDate`;
--> statement-breakpoint

-- ── 4. pipelineClaims: backfill sourceType for all existing project-sourced rows
UPDATE `pipelineClaims` SET `sourceType` = 'project' WHERE `sourceType` = 'project' OR `sourceType` IS NULL;
--> statement-breakpoint

-- ── 5. pipelineActivity: add eventType and metadataJson ──────────────────────
ALTER TABLE `pipelineActivity`
  ADD COLUMN `eventType` varchar(64) NULL AFTER `note`,
  ADD COLUMN `metadataJson` json NULL AFTER `eventType`;
--> statement-breakpoint

-- ── 6. outreachEmails: add attribution and timestamp columns ─────────────────
ALTER TABLE `outreachEmails`
  ADD COLUMN `claimId` int NULL AFTER `projectName`,
  ADD COLUMN `sourceAccountId` int NULL AFTER `claimId`,
  ADD COLUMN `openedInEmailAt` timestamp NULL AFTER `status`,
  ADD COLUMN `sentAt` timestamp NULL AFTER `openedInEmailAt`;
--> statement-breakpoint

-- ── 7. userActivity: add pipeline_stage_advanced to actionType enum ──────────
ALTER TABLE `userActivity` MODIFY COLUMN `actionType`
  enum('project_viewed','contact_viewed','contact_enriched','outreach_drafted','outreach_sent',
       'pipeline_claimed','pipeline_stage_advanced','pipeline_status_changed',
       'pipeline_meeting_logged','pipeline_quote_uploaded','search_performed','project_exported') NOT NULL;
