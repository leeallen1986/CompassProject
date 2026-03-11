/**
 * Daily Pipeline Runner — v2 (Source Architecture Overhaul)
 *
 * Sources are categorised into three roles:
 *   PRIMARY DISCOVERY   — RSS feeds, AusTender, DMIRS, ASX monitoring
 *   SECONDARY CONFIRM   — Gov major projects, AEMO, old Projectory scraper
 *   ENRICHMENT          — Projectory authenticated enrichment, ICN validation
 *
 * Pipeline order:
 *  1. RSS Harvest (daily)
 *  2. AI Extraction (daily)
 *  3. ASX Targeted Monitoring (daily — lightweight, keyword-filtered)
 *  4. AusTender OCDS API (Thursdays)
 *  5. DMIRS MINEDEX API (Wednesdays)
 *  6. Gov Major Projects (Tuesdays)
 *  7. AEMO Generation Info (Fridays)
 *  8. Projectory Enrichment (daily — enriches existing projects, not discovery)
 *  9. ICN Validation (Saturdays — validates existing projects, not discovery)
 * 10. Contact Enrichment
 * 11. Web Stakeholder Discovery
 * 12. Apollo Selective Gap-Fill
 * 13. Business Line Scoring
 * 14. Weekly Digest (Mondays)
 * 15. Staleness Check
 * 16. Source Monitoring Snapshot
 *
 * Every step is logged with timing, counts, and error detail into the pipelineRuns table.
 */
import { harvestAllFeeds } from "./rssHarvester";
import { runExtractionPipeline } from "./aiExtractor";
import { runEnrichmentPipeline } from "./contactEnrichment";
import { runProjectoryScraper } from "./projectoryScraper";
import { runDmirsScraper } from "./dmirsScraper";
import { runAemoScraper } from "./aemoScraper";
import { runGovScraper } from "./govScraper";
import { runAusTenderScraper } from "./austenderScraper";
import { runIcnScraper } from "./icnScraper";
import { sendWeeklyDigests } from "./emailDigest";
import { runBulkWebDiscovery } from "./webStakeholderDiscovery";
import { findEligibleProjects, buildGapFillPlan, getBudgetStatus } from "./apolloEligibility";
import { enrichProjectContacts, revealContactEmail } from "./apolloEnrichment";
import { markStaleProjects, getDb } from "./db";
import { pipelineRuns, type PipelineStep } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// New source architecture imports
import { scanTargetCompanies } from "./asxMonitor";
import { enrichUnenrichedProjects, getSessionStatus as getProjectorySessionStatus } from "./projectoryEnrichment";
import { validateAllProjects as icnValidateAllProjects } from "./icnEnrichment";
import { recordSourceRun } from "./sourceMonitoring";
import { runContractorEngine } from "./contractorEngine";

export interface DailyPipelineResult {
  harvest: {
    totalSources: number;
    totalNew: number;
    totalDuplicates: number;
    totalErrors: number;
  };
  extraction: {
    processed: number;
    extracted: number;
    duplicates: number;
    failed: number;
    creditsUsed: number;
  };
  enrichment: {
    processed: number;
    enriched: number;
    notFound: number;
    failed: number;
    dailyUsed: number;
  };
  asxMonitor: {
    ran: boolean;
    companiesChecked: number;
    announcementsScanned: number;
    projectSignals: number;
    newProjects: number;
    duplicates: number;
    errors: number;
    duration: number;
  };
  projectory: {
    ran: boolean;
    totalNewProjects: number;
    totalNewContacts: number;
    totalDuplicates: number;
    totalErrors: number;
    duration: number;
  };
  projectoryEnrichment: {
    ran: boolean;
    enriched: number;
    contractorsFound: number;
    failed: number;
    sessionExpired: boolean;
  };
  icnValidation: {
    ran: boolean;
    validated: number;
    contractorsFound: number;
    failed: number;
  };
  dmirs: {
    ran: boolean;
    totalNewProjects: number;
    totalDuplicates: number;
    totalErrors: number;
    duration: number;
  };
  aemo: {
    ran: boolean;
    totalNewProjects: number;
    totalDuplicates: number;
    totalSkipped: number;
    totalErrors: number;
    duration: number;
  };
  gov: {
    ran: boolean;
    totalNewProjects: number;
    totalDuplicates: number;
    totalErrors: number;
    duration: number;
  };
  austender: {
    ran: boolean;
    totalFetched: number;
    totalRelevant: number;
    totalNewProjects: number;
    totalDuplicates: number;
    totalErrors: number;
    duration: number;
  };
  icn: {
    ran: boolean;
    totalNewProjects: number;
    totalDuplicates: number;
    totalErrors: number;
    duration: number;
  };
  duration: number;
  completedAt: string;
  steps: PipelineStep[];
}

// ── Helper to track a step ──

function startStep(name: string): PipelineStep {
  return {
    name,
    status: "skipped",
    startedAt: new Date().toISOString(),
  };
}

function completeStep(step: PipelineStep, counts?: Record<string, number>): PipelineStep {
  step.status = "completed";
  step.completedAt = new Date().toISOString();
  step.durationMs = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
  if (counts) step.counts = counts;
  return step;
}

function failStep(step: PipelineStep, error: string): PipelineStep {
  step.status = "failed";
  step.completedAt = new Date().toISOString();
  step.durationMs = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
  step.error = error;
  return step;
}

function skipStep(step: PipelineStep, reason?: string): PipelineStep {
  step.status = "skipped";
  step.completedAt = new Date().toISOString();
  step.durationMs = 0;
  if (reason) step.error = reason;
  return step;
}

// ── Main pipeline ──

export async function runDailyPipeline(triggeredBy?: string): Promise<DailyPipelineResult> {
  const startTime = Date.now();
  const steps: PipelineStep[] = [];
  const errors: string[] = [];
  const dayOfWeek = new Date().getUTCDay(); // 0=Sun, 1=Mon, ...
  console.log("[DailyPipeline] Starting daily pipeline run (v2 — source architecture)...");

  // Create pipeline run log entry
  let runId: number | null = null;
  try {
    const db = await getDb();
    if (db) {
      const [inserted] = await db.insert(pipelineRuns).values({
        runType: "daily",
        status: "running",
        triggeredBy: triggeredBy || "scheduler",
      });
      runId = inserted.insertId;
      console.log(`[DailyPipeline] Pipeline run logged: ID ${runId}`);
    }
  } catch (err) {
    console.error("[DailyPipeline] Failed to create pipeline run log:", err);
  }

  // ════════════════════════════════════════════════════════════
  // PRIMARY DISCOVERY SOURCES
  // ════════════════════════════════════════════════════════════

  // ── Step 1: RSS Harvest (daily) ──
  const harvestStep = startStep("RSS Harvest");
  console.log("[DailyPipeline] Step 1: Harvesting RSS feeds...");
  let harvestResult;
  try {
    const stepStart = Date.now();
    harvestResult = await harvestAllFeeds();
    completeStep(harvestStep, {
      sources: harvestResult.totalSources,
      newArticles: harvestResult.totalNew,
      duplicates: harvestResult.totalDuplicates,
      errors: harvestResult.totalErrors,
    });
    recordSourceRun("rss_feeds", true, harvestResult.totalNew, Math.round((Date.now() - stepStart) / 1000));
    console.log(
      `[DailyPipeline] Harvest complete: ${harvestResult.totalNew} new articles from ${harvestResult.totalSources} sources`
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Harvest failed:", errMsg);
    errors.push(`Harvest: ${errMsg}`);
    failStep(harvestStep, errMsg);
    recordSourceRun("rss_feeds", false, 0, 0, errMsg);
    harvestResult = { totalSources: 0, totalFetched: 0, totalNew: 0, totalDuplicates: 0, totalErrors: 1 };
  }
  steps.push(harvestStep);

  // ── Step 2: AI Extraction (daily) ──
  const extractionStep = startStep("AI Extraction");
  console.log("[DailyPipeline] Step 2: Running AI extraction...");
  let extractionResult;
  try {
    extractionResult = await runExtractionPipeline();
    completeStep(extractionStep, {
      processed: extractionResult.processed,
      extracted: extractionResult.extracted,
      duplicates: extractionResult.duplicates,
      failed: extractionResult.failed,
      creditsUsed: extractionResult.creditsUsed,
    });
    console.log(
      `[DailyPipeline] Extraction complete: ${extractionResult.extracted} projects from ${extractionResult.processed} articles`
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Extraction failed:", errMsg);
    errors.push(`Extraction: ${errMsg}`);
    failStep(extractionStep, errMsg);
    extractionResult = { processed: 0, extracted: 0, duplicates: 0, skipped: 0, failed: 0, creditsUsed: 0, results: [] };
  }
  steps.push(extractionStep);

  // ── Step 3: ASX Targeted Monitoring (daily — lightweight) ──
  const asxStep = startStep("ASX Targeted Monitoring");
  console.log("[DailyPipeline] Step 3: Running ASX targeted monitoring...");
  let asxResult = { ran: false, companiesChecked: 0, announcementsScanned: 0, projectSignals: 0, newProjects: 0, duplicates: 0, errors: 0, duration: 0 };
  try {
    const stepStart = Date.now();
    const asxData = await scanTargetCompanies(7);
    asxResult = {
      ran: true,
      companiesChecked: asxData.totalCompaniesChecked,
      announcementsScanned: asxData.totalAnnouncementsScanned,
      projectSignals: asxData.totalProjectSignals,
      newProjects: asxData.totalNewProjects,
      duplicates: asxData.totalDuplicates,
      errors: asxData.totalErrors,
      duration: asxData.duration,
    };
    completeStep(asxStep, {
      companiesChecked: asxData.totalCompaniesChecked,
      announcementsScanned: asxData.totalAnnouncementsScanned,
      projectSignals: asxData.totalProjectSignals,
      newProjects: asxData.totalNewProjects,
      duplicates: asxData.totalDuplicates,
    });
    recordSourceRun("asx_announcements", true, asxData.totalNewProjects, Math.round((Date.now() - stepStart) / 1000));
    console.log(`[DailyPipeline] ASX monitoring complete: ${asxData.totalNewProjects} new projects from ${asxData.totalCompaniesChecked} companies`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] ASX monitoring failed:", errMsg);
    errors.push(`ASX: ${errMsg}`);
    failStep(asxStep, errMsg);
    recordSourceRun("asx_announcements", false, 0, 0, errMsg);
  }
  steps.push(asxStep);

  // ── Step 4: AusTender (Thursdays) ──
  const isThursday = dayOfWeek === 4;
  const austenderStep = startStep("AusTender OCDS API");
  let austenderResult = { ran: false, totalFetched: 0, totalRelevant: 0, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isThursday) {
    console.log("[DailyPipeline] Step 4: Scraping AusTender contracts (weekly Thursday run)...");
    try {
      const stepStart = Date.now();
      const scrapeResult = await runAusTenderScraper();
      austenderResult = {
        ran: true,
        totalFetched: scrapeResult.totalFetched,
        totalRelevant: scrapeResult.totalRelevant,
        totalNewProjects: scrapeResult.totalNewProjects,
        totalDuplicates: scrapeResult.totalDuplicates,
        totalErrors: scrapeResult.totalErrors,
        duration: scrapeResult.duration,
      };
      completeStep(austenderStep, {
        fetched: scrapeResult.totalFetched,
        relevant: scrapeResult.totalRelevant,
        newProjects: scrapeResult.totalNewProjects,
        duplicates: scrapeResult.totalDuplicates,
        errors: scrapeResult.totalErrors,
      });
      recordSourceRun("austender", true, scrapeResult.totalNewProjects, Math.round((Date.now() - stepStart) / 1000));
      console.log(`[DailyPipeline] AusTender complete: ${scrapeResult.totalNewProjects} new projects from ${scrapeResult.totalRelevant} relevant contracts`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] AusTender scrape failed:", errMsg);
      errors.push(`AusTender: ${errMsg}`);
      failStep(austenderStep, errMsg);
      recordSourceRun("austender", false, 0, 0, errMsg);
      austenderResult.totalErrors = 1;
    }
  } else {
    skipStep(austenderStep, "Runs on Thursdays only");
    console.log("[DailyPipeline] Skipping AusTender (runs on Thursdays only)");
  }
  steps.push(austenderStep);

  // ── Step 5: DMIRS MINEDEX (Wednesdays) ──
  const isWednesday = dayOfWeek === 3;
  const dmirsStep = startStep("DMIRS MINEDEX API");
  let dmirsResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isWednesday) {
    console.log("[DailyPipeline] Step 5: Scraping DMIRS MINEDEX (weekly Wednesday run)...");
    try {
      const stepStart = Date.now();
      const scrapeResult = await runDmirsScraper();
      dmirsResult = {
        ran: true,
        totalNewProjects: scrapeResult.totalNewProjects,
        totalDuplicates: scrapeResult.totalDuplicates,
        totalErrors: scrapeResult.totalErrors,
        duration: scrapeResult.duration,
      };
      completeStep(dmirsStep, {
        newProjects: scrapeResult.totalNewProjects,
        duplicates: scrapeResult.totalDuplicates,
        errors: scrapeResult.totalErrors,
      });
      recordSourceRun("dmirs", true, scrapeResult.totalNewProjects, Math.round((Date.now() - stepStart) / 1000));
      console.log(`[DailyPipeline] DMIRS complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] DMIRS scrape failed:", errMsg);
      errors.push(`DMIRS: ${errMsg}`);
      failStep(dmirsStep, errMsg);
      recordSourceRun("dmirs", false, 0, 0, errMsg);
      dmirsResult.totalErrors = 1;
    }
  } else {
    skipStep(dmirsStep, "Runs on Wednesdays only");
    console.log("[DailyPipeline] Skipping DMIRS (runs on Wednesdays only)");
  }
  steps.push(dmirsStep);

  // ════════════════════════════════════════════════════════════
  // SECONDARY CONFIRMATION SOURCES
  // ════════════════════════════════════════════════════════════

  // ── Step 6: Government Major Projects (Tuesdays) ──
  const isTuesday = dayOfWeek === 2;
  const govStep = startStep("Gov Major Projects");
  let govResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isTuesday) {
    console.log("[DailyPipeline] Step 6: Scraping government major projects (weekly Tuesday run)...");
    try {
      const stepStart = Date.now();
      const scrapeResult = await runGovScraper();
      govResult = {
        ran: true,
        totalNewProjects: scrapeResult.totalNewProjects,
        totalDuplicates: scrapeResult.totalDuplicates,
        totalErrors: scrapeResult.totalErrors,
        duration: scrapeResult.duration,
      };
      completeStep(govStep, {
        newProjects: scrapeResult.totalNewProjects,
        duplicates: scrapeResult.totalDuplicates,
        errors: scrapeResult.totalErrors,
      });
      recordSourceRun("gov_major_projects", true, scrapeResult.totalNewProjects, Math.round((Date.now() - stepStart) / 1000));
      console.log(`[DailyPipeline] Gov complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] Gov scrape failed:", errMsg);
      errors.push(`Gov: ${errMsg}`);
      failStep(govStep, errMsg);
      recordSourceRun("gov_major_projects", false, 0, 0, errMsg);
      govResult.totalErrors = 1;
    }
  } else {
    skipStep(govStep, "Runs on Tuesdays only");
    console.log("[DailyPipeline] Skipping Gov projects (runs on Tuesdays only)");
  }
  steps.push(govStep);

  // ── Step 7: AEMO (Fridays) ──
  const isFriday = dayOfWeek === 5;
  const aemoStep = startStep("AEMO Generation Info");
  let aemoResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalSkipped: 0, totalErrors: 0, duration: 0 };
  if (isFriday) {
    console.log("[DailyPipeline] Step 7: Scraping AEMO generation projects (weekly Friday run)...");
    try {
      const stepStart = Date.now();
      const scrapeResult = await runAemoScraper();
      aemoResult = {
        ran: true,
        totalNewProjects: scrapeResult.totalNewProjects,
        totalDuplicates: scrapeResult.totalDuplicates,
        totalSkipped: scrapeResult.totalSkipped,
        totalErrors: scrapeResult.totalErrors,
        duration: scrapeResult.duration,
      };
      completeStep(aemoStep, {
        newProjects: scrapeResult.totalNewProjects,
        duplicates: scrapeResult.totalDuplicates,
        skipped: scrapeResult.totalSkipped,
        errors: scrapeResult.totalErrors,
      });
      recordSourceRun("aemo", true, scrapeResult.totalNewProjects, Math.round((Date.now() - stepStart) / 1000));
      console.log(`[DailyPipeline] AEMO complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] AEMO scrape failed:", errMsg);
      errors.push(`AEMO: ${errMsg}`);
      failStep(aemoStep, errMsg);
      recordSourceRun("aemo", false, 0, 0, errMsg);
      aemoResult.totalErrors = 1;
    }
  } else {
    skipStep(aemoStep, "Runs on Fridays only");
    console.log("[DailyPipeline] Skipping AEMO (runs on Fridays only)");
  }
  steps.push(aemoStep);

  // ════════════════════════════════════════════════════════════
  // ENRICHMENT SOURCES
  // ════════════════════════════════════════════════════════════

  // ── Step 8: Projectory Enrichment (daily — enriches existing projects) ──
  const projectoryEnrichStep = startStep("Projectory Enrichment");
  console.log("[DailyPipeline] Step 8: Running Projectory enrichment on existing projects...");
  let projectoryEnrichResult = { ran: false, enriched: 0, contractorsFound: 0, failed: 0, sessionExpired: false };
  try {
    const sessionStatus = getProjectorySessionStatus();
    const hasCredentials = !!(process.env.PROJECTORY_EMAIL && process.env.PROJECTORY_PASSWORD);
    if (!hasCredentials) {
      skipStep(projectoryEnrichStep, "Projectory credentials not configured");
      console.log("[DailyPipeline] Skipping Projectory enrichment: credentials not configured");
    } else {
      const stepStart = Date.now();
      const enrichResult = await enrichUnenrichedProjects(15); // 15 projects per daily run
      projectoryEnrichResult = {
        ran: true,
        enriched: enrichResult.totalEnriched,
        contractorsFound: enrichResult.totalContractorsDiscovered,
        failed: enrichResult.totalErrors,
        sessionExpired: false,
      };
      completeStep(projectoryEnrichStep, {
        processed: enrichResult.totalProcessed,
        matched: enrichResult.totalMatched,
        enriched: enrichResult.totalEnriched,
        contractorsDiscovered: enrichResult.totalContractorsDiscovered,
        consultantsDiscovered: enrichResult.totalConsultantsDiscovered,
        stageUpdates: enrichResult.totalStageUpdates,
        errors: enrichResult.totalErrors,
      });
      recordSourceRun("projectory_enrichment", true, enrichResult.totalEnriched, Math.round((Date.now() - stepStart) / 1000));
      console.log(`[DailyPipeline] Projectory enrichment complete: ${enrichResult.totalEnriched} projects enriched, ${enrichResult.totalContractorsDiscovered} contractors found`);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Projectory enrichment failed:", errMsg);
    errors.push(`Projectory Enrichment: ${errMsg}`);
    failStep(projectoryEnrichStep, errMsg);
    recordSourceRun("projectory_enrichment", false, 0, 0, errMsg);
  }
  steps.push(projectoryEnrichStep);

  // ── Step 8b: Legacy Projectory Scraper (Mondays — kept for backward compat) ──
  const isMonday = dayOfWeek === 1;
  const projectoryStep = startStep("Projectory Scrape (Legacy)");
  let projectoryResult = { ran: false, totalNewProjects: 0, totalNewContacts: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isMonday) {
    console.log("[DailyPipeline] Step 8b: Running legacy Projectory scraper (Monday)...");
    try {
      const scrapeResult = await runProjectoryScraper();
      projectoryResult = {
        ran: true,
        totalNewProjects: scrapeResult.totalNewProjects,
        totalNewContacts: scrapeResult.totalNewContacts,
        totalDuplicates: scrapeResult.totalDuplicates,
        totalErrors: scrapeResult.totalErrors,
        duration: scrapeResult.duration,
      };
      completeStep(projectoryStep, {
        newProjects: scrapeResult.totalNewProjects,
        newContacts: scrapeResult.totalNewContacts,
        duplicates: scrapeResult.totalDuplicates,
        errors: scrapeResult.totalErrors,
      });
      console.log(`[DailyPipeline] Legacy Projectory complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] Legacy Projectory scrape failed:", errMsg);
      errors.push(`Projectory Legacy: ${errMsg}`);
      failStep(projectoryStep, errMsg);
      projectoryResult.totalErrors = 1;
    }
  } else {
    skipStep(projectoryStep, "Runs on Mondays only");
  }
  steps.push(projectoryStep);

  // ── Step 9: ICN Validation (Saturdays — validates existing projects) ──
  const isSaturday = dayOfWeek === 6;
  const icnValidationStep = startStep("ICN Validation");
  let icnValidationResult = { ran: false, validated: 0, contractorsFound: 0, failed: 0 };
  const icnStep = startStep("ICN Gateway Scrape (Legacy)");
  let icnResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isSaturday) {
    console.log("[DailyPipeline] Step 9: Running ICN validation on existing projects...");
    try {
      const stepStart = Date.now();
      const validationResult = await icnValidateAllProjects();
      icnValidationResult = {
        ran: true,
        validated: validationResult.totalChecked,
        contractorsFound: validationResult.totalContractorsAdded,
        failed: validationResult.totalChecked - validationResult.totalMatched,
      };
      completeStep(icnValidationStep, {
        checked: validationResult.totalChecked,
        matched: validationResult.totalMatched,
        updated: validationResult.totalUpdated,
        contractorsAdded: validationResult.totalContractorsAdded,
      });
      recordSourceRun("icn_gateway", true, validationResult.totalContractorsAdded, Math.round((Date.now() - stepStart) / 1000));
      console.log(`[DailyPipeline] ICN validation complete: ${validationResult.totalChecked} projects checked, ${validationResult.totalContractorsAdded} contractors found`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] ICN validation failed:", errMsg);
      errors.push(`ICN Validation: ${errMsg}`);
      failStep(icnValidationStep, errMsg);
      recordSourceRun("icn_gateway", false, 0, 0, errMsg);
    }

    // Also run legacy ICN scraper
    console.log("[DailyPipeline] Step 9b: Running legacy ICN scraper...");
    try {
      const scrapeResult = await runIcnScraper();
      icnResult = {
        ran: true,
        totalNewProjects: scrapeResult.totalNewProjects,
        totalDuplicates: scrapeResult.totalDuplicates,
        totalErrors: scrapeResult.totalErrors,
        duration: scrapeResult.duration,
      };
      completeStep(icnStep, {
        newProjects: scrapeResult.totalNewProjects,
        duplicates: scrapeResult.totalDuplicates,
        errors: scrapeResult.totalErrors,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      failStep(icnStep, errMsg);
    }
  } else {
    skipStep(icnValidationStep, "Runs on Saturdays only");
    skipStep(icnStep, "Runs on Saturdays only");
  }
  steps.push(icnValidationStep);
  steps.push(icnStep);

  // ════════════════════════════════════════════════════════════
  // CONTACT & SCORING PIPELINE
  // ════════════════════════════════════════════════════════════

  // ── Step 10: Contact Enrichment ──
  const enrichmentStep = startStep("Contact Enrichment");
  console.log("[DailyPipeline] Step 10: Enriching contacts...");
  let enrichmentResult;
  try {
    enrichmentResult = await runEnrichmentPipeline();
    completeStep(enrichmentStep, {
      processed: enrichmentResult.processed,
      enriched: enrichmentResult.enriched,
      notFound: enrichmentResult.notFound,
      failed: enrichmentResult.failed,
      apolloCreditsUsed: enrichmentResult.dailyUsed,
    });
    console.log(
      `[DailyPipeline] Enrichment complete: ${enrichmentResult.enriched} contacts enriched`
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Enrichment failed:", errMsg);
    errors.push(`Enrichment: ${errMsg}`);
    failStep(enrichmentStep, errMsg);
    enrichmentResult = { processed: 0, enriched: 0, notFound: 0, failed: 0, dailyUsed: 0, results: [] };
  }
  steps.push(enrichmentStep);

  // ── Step 11: Web Stakeholder Discovery ──
  const webDiscoveryStep = startStep("Web Stakeholder Discovery");
  console.log("[DailyPipeline] Step 11: Running open-web stakeholder discovery...");
  try {
    const webResult = await runBulkWebDiscovery(20);
    completeStep(webDiscoveryStep, {
      projectsProcessed: webResult.processed,
      contactsFound: webResult.contactsFound,
      errors: webResult.errors.length,
    });
    console.log(
      `[DailyPipeline] Web discovery complete: ${webResult.contactsFound} contacts found across ${webResult.processed} projects`
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Web stakeholder discovery failed:", errMsg);
    errors.push(`Web Discovery: ${errMsg}`);
    failStep(webDiscoveryStep, errMsg);
  }
  steps.push(webDiscoveryStep);

  // ── Step 12: Apollo Selective Gap-Fill ──
  const apolloStep = startStep("Apollo Gap-Fill");
  console.log("[DailyPipeline] Step 12: Running selective Apollo gap-fill...");
  try {
    const eligibility = await findEligibleProjects(10);
    if (!eligibility.budgetStatus.withinBudget) {
      skipStep(apolloStep, `Budget exhausted — daily: ${eligibility.budgetStatus.dailyUsed}/${eligibility.budgetStatus.dailyCap}, monthly: ${eligibility.budgetStatus.monthlyUsed}/${eligibility.budgetStatus.monthlyCap}`);
      console.log(`[DailyPipeline] Apollo gap-fill skipped: budget exhausted`);
    } else if (eligibility.eligible.length === 0) {
      skipStep(apolloStep, "No eligible projects with gaps to fill");
      console.log(`[DailyPipeline] Apollo gap-fill skipped: no eligible projects`);
    } else {
      let totalVerified = 0;
      let totalNewContacts = 0;
      let totalCreditsUsed = 0;
      let projectsProcessed = 0;

      for (const proj of eligibility.eligible) {
        try {
          const currentBudget = await getBudgetStatus();
          if (!currentBudget.withinBudget) {
            console.log(`[DailyPipeline] Apollo budget hit during gap-fill, stopping`);
            break;
          }

          const plan = await buildGapFillPlan(proj.projectId, proj.maxCredits);
          if (plan.actions.length === 0) continue;

          for (const action of plan.actions) {
            if (action.type === "verify_email" && action.contactId) {
              try {
                const result = await revealContactEmail(action.contactId, {
                  userId: 0,
                  userName: "pipeline-auto",
                });
                if (result) {
                  totalVerified++;
                  totalCreditsUsed++;
                }
              } catch (revealErr) {
                console.warn(`[DailyPipeline] Apollo reveal failed for contact ${action.contactId}:`, revealErr instanceof Error ? revealErr.message : String(revealErr));
              }
            } else if (action.type === "find_additional") {
              try {
                const searchResult = await enrichProjectContacts(
                  proj.projectId,
                  0,
                  { maxPerCompany: 3, enrichEmails: true }
                );
                totalNewContacts += searchResult.totalFound;
                totalCreditsUsed += searchResult.enrichCreditsUsed;
              } catch (searchErr) {
                console.warn(`[DailyPipeline] Apollo search failed for project ${proj.projectId}:`, searchErr instanceof Error ? searchErr.message : String(searchErr));
              }
            }
          }
          projectsProcessed++;
          console.log(`[DailyPipeline] Apollo gap-fill: ${proj.projectName} (${proj.reason}) — ${plan.actions.length} actions`);
        } catch (projErr) {
          console.warn(`[DailyPipeline] Apollo gap-fill failed for project ${proj.projectId}:`, projErr instanceof Error ? projErr.message : String(projErr));
        }
      }

      completeStep(apolloStep, {
        projectsProcessed,
        emailsVerified: totalVerified,
        newContacts: totalNewContacts,
        creditsUsed: totalCreditsUsed,
        eligibleProjects: eligibility.eligible.length,
      });
      console.log(`[DailyPipeline] Apollo gap-fill complete: ${projectsProcessed} projects, ${totalVerified} emails verified, ${totalNewContacts} new contacts, ${totalCreditsUsed} credits used`);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Apollo gap-fill failed:", errMsg);
    errors.push(`Apollo Gap-Fill: ${errMsg}`);
    failStep(apolloStep, errMsg);
  }
  steps.push(apolloStep);

  // ── Step 13: Business Line Scoring ──
  const blScoringStep = startStep("Business Line Scoring");
  console.log("[DailyPipeline] Step 13: Scoring projects across 9 business lines...");
  try {
    const { getUnscoredProjectIds: getUnscored, scoreAndSaveProjects: bulkScore } = await import("./businessLineScoring");
    const unscoredIds = await getUnscored(30);
    if (unscoredIds.length > 0) {
      const blResult = await bulkScore(unscoredIds);
      completeStep(blScoringStep, {
        scored: blResult.scored,
        failed: blResult.failed,
        total: unscoredIds.length,
      });
      console.log(`[DailyPipeline] BL Scoring complete: ${blResult.scored} scored, ${blResult.failed} failed out of ${unscoredIds.length}`);
    } else {
      completeStep(blScoringStep, { scored: 0, failed: 0, total: 0 });
      console.log("[DailyPipeline] No unscored projects found");
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] BL Scoring failed:", errMsg);
    failStep(blScoringStep, errMsg);
  }
  steps.push(blScoringStep);

  // ── Step 14: Weekly Digest (Mondays) ──
  const digestStep = startStep("Weekly Digest");
  if (isMonday) {
    console.log("[DailyPipeline] Step 14: Sending weekly intelligence digest (Monday run)...");
    try {
      const digestResult = await sendWeeklyDigests();
      completeStep(digestStep, {
        sent: digestResult.sent,
        failed: digestResult.failed,
        skipped: digestResult.skipped,
      });
      console.log(`[DailyPipeline] Weekly digest sent: ${digestResult.sent} sent, ${digestResult.failed} failed, ${digestResult.skipped} skipped`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] Weekly digest failed:", errMsg);
      failStep(digestStep, errMsg);
    }
  } else {
    skipStep(digestStep, "Runs on Mondays only");
    console.log("[DailyPipeline] Step 14: Skipping weekly digest (runs on Mondays only)");
  }
  steps.push(digestStep);

  // ── Step 15: Staleness Check ──
  const stalenessStep = startStep("Staleness Check");
  console.log("[DailyPipeline] Step 15: Running project staleness check...");
  try {
    const staleCount = await markStaleProjects();
    completeStep(stalenessStep, { markedStale: staleCount });
    if (staleCount > 0) {
      console.log(`[DailyPipeline] Marked ${staleCount} projects as stale (no activity in 30+ days, no pipeline claims)`);
    } else {
      console.log("[DailyPipeline] No new stale projects found");
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Staleness check failed:", errMsg);
    failStep(stalenessStep, errMsg);
  }
  steps.push(stalenessStep);

  // ── Step 16: Contractor & Delivery Pattern Engine (Wednesdays + Saturdays) ──
  const contractorStep = startStep("Contractor Engine");
  if (dayOfWeek === 3 || dayOfWeek === 6) {
    console.log("[DailyPipeline] Step 16: Running contractor & delivery pattern engine...");
    try {
      const ceResult = await runContractorEngine();
      completeStep(contractorStep, {
        companies: ceResult.registry.totalCompanies,
        newCompanies: ceResult.registry.newCompanies,
        pairings: ceResult.pairings.totalPairings,
        patterns: ceResult.patterns.totalPatterns,
      });
      console.log(`[DailyPipeline] Contractor engine complete: ${ceResult.registry.totalCompanies} companies, ${ceResult.pairings.totalPairings} pairings, ${ceResult.patterns.totalPatterns} patterns`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      failStep(contractorStep, errMsg);
      errors.push(`Contractor engine: ${errMsg}`);
      console.error("[DailyPipeline] Contractor engine failed:", errMsg);
    }
  } else {
    skipStep(contractorStep, "Runs on Wednesdays and Saturdays");
    console.log("[DailyPipeline] Step 16: Skipping contractor engine (runs Wed/Sat)");
  }
  steps.push(contractorStep);

  // ── Step 17: Source Monitoring Snapshot ──
  const monitorStep = startStep("Source Monitoring Snapshot");
  console.log("[DailyPipeline] Step 17: Recording source monitoring snapshot...");
  try {
    completeStep(monitorStep, {
      totalSteps: steps.length,
      completed: steps.filter(s => s.status === "completed").length,
      failed: steps.filter(s => s.status === "failed").length,
      skipped: steps.filter(s => s.status === "skipped").length,
    });
  } catch (err: unknown) {
    failStep(monitorStep, err instanceof Error ? err.message : String(err));
  }
  steps.push(monitorStep);

  const duration = Math.round((Date.now() - startTime) / 1000);
  const completedAt = new Date().toISOString();

  const result: DailyPipelineResult = {
    harvest: {
      totalSources: harvestResult.totalSources,
      totalNew: harvestResult.totalNew,
      totalDuplicates: harvestResult.totalDuplicates,
      totalErrors: harvestResult.totalErrors,
    },
    extraction: {
      processed: extractionResult.processed,
      extracted: extractionResult.extracted,
      duplicates: extractionResult.duplicates,
      failed: extractionResult.failed,
      creditsUsed: extractionResult.creditsUsed,
    },
    enrichment: {
      processed: enrichmentResult.processed,
      enriched: enrichmentResult.enriched,
      notFound: enrichmentResult.notFound,
      failed: enrichmentResult.failed,
      dailyUsed: enrichmentResult.dailyUsed,
    },
    asxMonitor: asxResult,
    projectory: projectoryResult,
    projectoryEnrichment: projectoryEnrichResult,
    icnValidation: icnValidationResult,
    dmirs: dmirsResult,
    aemo: aemoResult,
    gov: govResult,
    austender: austenderResult,
    icn: icnResult,
    duration,
    completedAt,
    steps,
  };

  // ── Save pipeline run results to database ──
  if (runId) {
    try {
      const db = await getDb();
      if (!db) throw new Error("No database connection");

      const hasErrors = errors.length > 0;
      const hasFailed = steps.some(s => s.status === "failed");

      await db.update(pipelineRuns).set({
        status: hasFailed ? "failed" : "completed",
        completedAt: new Date(),
        durationMs: duration * 1000,
        // RSS harvest stats
        feedsFetched: harvestResult.totalSources,
        feedErrors: harvestResult.totalErrors,
        articlesIngested: harvestResult.totalNew,
        articlesSkippedKeyword: (harvestResult as any).totalSkipped || 0,
        articlesDuplicate: harvestResult.totalDuplicates,
        // Extraction stats
        articlesExtracted: extractionResult.extracted,
        projectsCreated: extractionResult.extracted + projectoryResult.totalNewProjects + govResult.totalNewProjects + dmirsResult.totalNewProjects + austenderResult.totalNewProjects + aemoResult.totalNewProjects + icnResult.totalNewProjects + asxResult.newProjects,
        projectsDuplicate: extractionResult.duplicates,
        drillingCampaignsCreated: (extractionResult as any).drillingCampaignsInserted || 0,
        awardedProjectsCreated: (extractionResult as any).awardedProjectsInserted || 0,
        // Scraper stats
        austenderContracts: austenderResult.totalNewProjects,
        dmirsProjects: dmirsResult.totalNewProjects,
        projectoryProjects: projectoryResult.totalNewProjects,
        projectoryEnriched: projectoryEnrichResult.enriched,
        govProjects: govResult.totalNewProjects,
        aemoProjects: aemoResult.totalNewProjects,
        icnProjects: icnResult.totalNewProjects,
        // Contact enrichment
        contactsEnriched: enrichmentResult.enriched,
        apolloCreditsUsed: enrichmentResult.dailyUsed,
        // Step-level detail
        steps: steps,
        // Errors
        errors: hasErrors ? errors : null,
      }).where(eq(pipelineRuns.id, runId));
      console.log(`[DailyPipeline] Pipeline run ${runId} logged successfully (${steps.filter(s => s.status === "completed").length} completed, ${steps.filter(s => s.status === "skipped").length} skipped, ${steps.filter(s => s.status === "failed").length} failed)`);
    } catch (err) {
      console.error("[DailyPipeline] Failed to update pipeline run log:", err);
    }
  }

  console.log(`[DailyPipeline] Pipeline complete in ${duration}s`);
  return result;
}

// ── In-process scheduler ──
// Runs daily at 06:00 UTC (16:00 AEST)

let schedulerStarted = false;

export function startDailyScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  function scheduleNext(): void {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(6, 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    const delay = next.getTime() - now.getTime();
    const hoursUntil = Math.round(delay / 3600000 * 10) / 10;
    console.log(`[DailyPipeline] Next run scheduled in ${hoursUntil}h at ${next.toISOString()}`);

    setTimeout(async () => {
      try {
        await runDailyPipeline("scheduler");
      } catch (err: unknown) {
        console.error("[DailyPipeline] Scheduled run failed:", err instanceof Error ? err.message : String(err));
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}
