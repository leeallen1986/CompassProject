/**
 * Daily Pipeline Runner — v2 (Source Architecture Overhaul)
 *
 * Sources are categorised into three roles:
 *   PRIMARY DISCOVERY   — RSS feeds, AusTender, DMIRS, ASX monitoring
 *   SECONDARY CONFIRM   — Gov major projects, AEMO, old Projectory scraper
 *   ENRICHMENT          — Projectory authenticated enrichment, ICN validation
 *
 * Pipeline order (v3 — enrichment-before-digest):
 *  1. RSS Harvest (daily)
 *  2. AI Extraction (daily)
 *  3. ASX Targeted Monitoring (daily)
 *  4. AusTender OCDS API (Thursdays)
 *  5. DMIRS MINEDEX API (Wednesdays)
 *  6. Gov Major Projects (Tuesdays)
 *  7. AEMO Generation Info (Fridays)
 *  8. Projectory Enrichment (daily)
 *  9. ICN Validation (Saturdays)
 * 10. Contact Enrichment
 * 11. Web Stakeholder Discovery
 * 12. Apollo Selective Gap-Fill
 * 13. Business Line Scoring
 * 14. Tier Classification (daily)
 * 15. Contractor & Delivery Pattern Engine (Wed/Sat)
 * 16. Contractor Enrichment Pass (Tue/Fri)
 * 17. Role Relevance Classification (daily)
 * 18. Second-Pass Contact Search (Wed/Sat)
 * 19. Weekly Digest (Mondays)
 * 20. Thursday Mid-Week Reminder (Thursdays)
 * 21. Staleness Check
 * 22. Source Monitoring Snapshot
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
// Email digests are now handled exclusively by persistentScheduler (not pipeline)
// import { sendWeeklyDigests, sendThursdayReminders } from "./emailDigest";
import { runBulkWebDiscovery } from "./webStakeholderDiscovery";
import { findEligibleProjects, buildGapFillPlan, getBudgetStatus } from "./apolloEligibility";
import { enrichProjectContacts, revealContactEmail } from "./apolloEnrichment";
import { markStaleProjects, runDuplicateDetectionSweep, getDb } from "./db";
import { pipelineRuns, reports, type PipelineStep } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

// New source architecture imports
import { scanTargetCompanies } from "./asxMonitor";
import { runTendersWAScraper } from "./tendersWAScraper";
import { runQtolNTScraper } from "./qtolNTScraper";
import { enrichUnenrichedProjects, getSessionStatus as getProjectorySessionStatus } from "./projectoryEnrichment";
import { validateAllProjects as icnValidateAllProjects } from "./icnEnrichment";
import { recordSourceRun } from "./sourceMonitoring";
import { runContractorEngine } from "./contractorEngine";
import { classifyAllProjects } from "./tierClassification";
import { runContractorEnrichmentPass } from "./contractorEnrichmentPass";
import { classifyAllContactRelevance } from "./roleRelevance";
import { runBulkSecondPass } from "./secondPassContactSearch";

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
  tendersWA: {
    ran: boolean;
    tendersFound: number;
    tendersRelevant: number;
    projectsCreated: number;
    projectsUpdated: number;
    degraded: boolean;
    degradedReason?: string;
    errors: number;
  };
  qtolNT: {
    ran: boolean;
    tendersFound: number;
    tendersRelevant: number;
    projectsCreated: number;
    projectsUpdated: number;
    priorityIssuerTenders: number;
    degraded: boolean;
    degradedReason?: string;
    errors: number;
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

// ── Pipeline timeout ──
const PIPELINE_TIMEOUT_MS = 90 * 60 * 1000; // 90 minutes max (enrichment is downstream and bounded)
const STEP_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes per step max
const ENRICHMENT_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutes for contact enrichment (500 contacts × ~2s each)

/**
 * Steps that are considered "critical" for the pipeline to be marked as completed.
 * Enrichment steps (contact enrichment, web discovery, Apollo gap-fill) are NOT critical —
 * their failure is recorded in errors[] but does not flip the run status to "failed".
 */
const CRITICAL_STEP_NAMES = new Set([
  "RSS Harvest",
  "AI Extraction",
  "Tier Classification",
  "Staleness Check",
  "Source Monitoring Snapshot",
]);

/** Enrichment step names — failures are tolerated; run still completes */
const ENRICHMENT_STEP_NAMES = new Set([
  "Contact Enrichment",
  "Web Stakeholder Discovery",
  "Apollo Gap-Fill",
  "Role Relevance Classification",
  "Second-Pass Contact Search",
  "Contractor Enrichment Pass",
]);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${Math.round(ms/1000)}s: ${label}`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// ── Cleanup stale runs on startup ──
export async function cleanupStaleRuns(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;
    // Mark any runs stuck in "running" for more than 1 hour as failed
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const staleRuns = await db.select({ id: pipelineRuns.id })
      .from(pipelineRuns)
      .where(and(
        eq(pipelineRuns.status, "running"),
        sql`${pipelineRuns.startedAt} < ${oneHourAgo}`
      ));
    if (staleRuns.length > 0) {
      for (const run of staleRuns) {
        await db.update(pipelineRuns).set({
          status: "failed",
          completedAt: new Date(),
          errors: ["Pipeline run timed out or server restarted — marked as failed during cleanup"],
        }).where(eq(pipelineRuns.id, run.id));
      }
      console.log(`[DailyPipeline] Cleaned up ${staleRuns.length} stale pipeline runs: ${staleRuns.map(r => r.id).join(", ")}`);
    }
    return staleRuns.length;
  } catch (err) {
    console.error("[DailyPipeline] Failed to cleanup stale runs:", err);
    return 0;
  }
}

// ── Main pipeline ──

export async function runDailyPipeline(triggeredBy?: string): Promise<DailyPipelineResult> {
  // Wrap the entire pipeline in a global timeout
  return withTimeout(_runDailyPipelineInner(triggeredBy), PIPELINE_TIMEOUT_MS, "Daily pipeline global timeout");
}

async function _runDailyPipelineInner(triggeredBy?: string): Promise<DailyPipelineResult> {
  const startTime = Date.now();
  const steps: PipelineStep[] = [];
  const errors: string[] = [];
  const dayOfWeek = new Date().getUTCDay(); // 0=Sun, 1=Mon, ...
  console.log("[DailyPipeline] Starting daily pipeline run (v3 — with timeouts)...");

  // Create pipeline run log entry
  let runId: number | null = null;
  let canonicalReportId: number = 0;
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

      // ── Create or reuse a canonical report for today ──
      // All scrapers should link their projects to this single report ID.
      // Previously, each scraper created its own report row (fragmentation bug).
      const today = new Date();
      const weekEnding = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const existing = await db.select().from(reports).where(eq(reports.weekEnding, weekEnding)).limit(1);
      if (existing.length > 0) {
        canonicalReportId = existing[0].id;
        console.log(`[DailyPipeline] Reusing today's report: ID ${canonicalReportId} (weekEnding=${weekEnding})`);
      } else {
        const [newReport] = await db.insert(reports).values({
          weekEnding,
          generatedTime: today.toISOString(),
          totalProjects: 0,
          hotProjects: 0,
          warmProjects: 0,
          coldProjects: 0,
          confirmedContractors: 0,
          predictedContractors: 0,
          capexOpportunities: 0,
          totalContacts: 0,
          sourcesSearched: "Pipeline (multi-source)",
          newProjectsCount: 0,
          executiveSummaryMain: "Auto-generated from daily pipeline run.",
        });
        canonicalReportId = Number(newReport.insertId);
        console.log(`[DailyPipeline] Created new canonical report: ID ${canonicalReportId} (weekEnding=${weekEnding})`);
      }
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
    harvestResult = await withTimeout(harvestAllFeeds(), STEP_TIMEOUT_MS, "RSS Harvest");
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
    extractionResult = await withTimeout(runExtractionPipeline(), STEP_TIMEOUT_MS, "AI Extraction");
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
    const asxData = await withTimeout(scanTargetCompanies(7), STEP_TIMEOUT_MS, "ASX Monitoring");
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

  // ── Step 3a: Tenders WA (daily) ──
  const tendersWAStep = startStep("Tenders WA");
  console.log("[DailyPipeline] Step 3a: Scraping Tenders WA...");
  let tendersWAResult = { ran: false, tendersFound: 0, tendersRelevant: 0, projectsCreated: 0, projectsUpdated: 0, degraded: false, degradedReason: undefined as string | undefined, errors: 0 };
  try {
    const stepStart = Date.now();
    const waData = await withTimeout(runTendersWAScraper(canonicalReportId || runId || 0), STEP_TIMEOUT_MS, "Tenders WA");
    tendersWAResult = {
      ran: true,
      tendersFound: waData.tendersFound,
      tendersRelevant: waData.tendersRelevant,
      projectsCreated: waData.projectsCreated,
      projectsUpdated: waData.projectsUpdated,
      degraded: waData.degraded,
      degradedReason: waData.degradedReason,
      errors: waData.errors.length,
    };
    if (waData.degraded) {
      skipStep(tendersWAStep, waData.degradedReason || "Tenders WA unavailable");
    } else {
      completeStep(tendersWAStep, {
        tendersFound: waData.tendersFound,
        tendersRelevant: waData.tendersRelevant,
        projectsCreated: waData.projectsCreated,
        projectsUpdated: waData.projectsUpdated,
        errors: waData.errors.length,
      });
    }
    recordSourceRun("tenders_wa", !waData.degraded, waData.projectsCreated, Math.round((Date.now() - stepStart) / 1000));
    console.log(`[DailyPipeline] Tenders WA complete: ${waData.tendersFound} found, ${waData.projectsCreated} created`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Tenders WA failed:", errMsg);
    errors.push(`TendersWA: ${errMsg}`);
    failStep(tendersWAStep, errMsg);
    recordSourceRun("tenders_wa", false, 0, 0, errMsg);
  }
  steps.push(tendersWAStep);

  // ── Step 3b: QTOL NT (daily) ──
  const qtolNTStep = startStep("QTOL NT");
  console.log("[DailyPipeline] Step 3b: Scraping QTOL NT...");
  let qtolNTResult = { ran: false, tendersFound: 0, tendersRelevant: 0, projectsCreated: 0, projectsUpdated: 0, priorityIssuerTenders: 0, degraded: false, degradedReason: undefined as string | undefined, errors: 0 };
  try {
    const stepStart = Date.now();
    const ntData = await withTimeout(runQtolNTScraper(canonicalReportId || runId || 0), STEP_TIMEOUT_MS, "QTOL NT");
    qtolNTResult = {
      ran: true,
      tendersFound: ntData.tendersFound,
      tendersRelevant: ntData.tendersRelevant,
      projectsCreated: ntData.projectsCreated,
      projectsUpdated: ntData.projectsUpdated,
      priorityIssuerTenders: ntData.priorityIssuerTenders,
      degraded: ntData.degraded,
      degradedReason: ntData.degradedReason,
      errors: ntData.errors.length,
    };
    if (ntData.degraded) {
      skipStep(qtolNTStep, ntData.degradedReason || "QTOL NT unavailable");
    } else {
      completeStep(qtolNTStep, {
        tendersFound: ntData.tendersFound,
        tendersRelevant: ntData.tendersRelevant,
        projectsCreated: ntData.projectsCreated,
        projectsUpdated: ntData.projectsUpdated,
        priorityIssuerTenders: ntData.priorityIssuerTenders,
        errors: ntData.errors.length,
      });
    }
    recordSourceRun("qtol_nt", !ntData.degraded, ntData.projectsCreated, Math.round((Date.now() - stepStart) / 1000));
    console.log(`[DailyPipeline] QTOL NT complete: ${ntData.tendersFound} found, ${ntData.projectsCreated} created`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] QTOL NT failed:", errMsg);
    errors.push(`QTOL NT: ${errMsg}`);
    failStep(qtolNTStep, errMsg);
    recordSourceRun("qtol_nt", false, 0, 0, errMsg);
  }
  steps.push(qtolNTStep);

  // ── Step 4: AusTender (Thursdays) ──
  const isThursday = dayOfWeek === 4;
  const austenderStep = startStep("AusTender OCDS API");
  let austenderResult = { ran: false, totalFetched: 0, totalRelevant: 0, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isThursday) {
    console.log("[DailyPipeline] Step 4: Scraping AusTender contracts (weekly Thursday run)...");
    try {
      const stepStart = Date.now();
      const scrapeResult = await withTimeout(runAusTenderScraper(), STEP_TIMEOUT_MS, "AusTender");
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
      const scrapeResult = await withTimeout(runDmirsScraper(), STEP_TIMEOUT_MS, "DMIRS");
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
      const scrapeResult = await withTimeout(runGovScraper(), STEP_TIMEOUT_MS, "Gov Major Projects");
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
      const scrapeResult = await withTimeout(runAemoScraper(), STEP_TIMEOUT_MS, "AEMO");
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
      const enrichResult = await withTimeout(enrichUnenrichedProjects(15), STEP_TIMEOUT_MS, "Projectory Enrichment"); // 15 projects per daily run
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
      const scrapeResult = await withTimeout(runProjectoryScraper(), STEP_TIMEOUT_MS, "Projectory Legacy");
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
      const validationResult = await withTimeout(icnValidateAllProjects(), STEP_TIMEOUT_MS, "ICN Validation");
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
      const scrapeResult = await withTimeout(runIcnScraper(), STEP_TIMEOUT_MS, "ICN Legacy");
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
    enrichmentResult = await withTimeout(runEnrichmentPipeline(), ENRICHMENT_TIMEOUT_MS, "Contact Enrichment");
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
    const webResult = await withTimeout(runBulkWebDiscovery(20), STEP_TIMEOUT_MS, "Web Stakeholder Discovery");
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
    const unscoredIds = await getUnscored(100);
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

  // ── Step 14: Tier Classification (daily — classify new/unclassified projects) ──
  const tierStep = startStep("Tier Classification");
  console.log("[DailyPipeline] Step 14: Running tier classification on projects...");
  try {
    const tierResult = await classifyAllProjects();
    completeStep(tierStep, {
      total: tierResult.total,
      classified: tierResult.classified,
      tier1: tierResult.tier1Count,
      tier2: tierResult.tier2Count,
      tier3: tierResult.tier3Count,
    });
    console.log(`[DailyPipeline] Tier classification complete: ${tierResult.tier1Count} actionable, ${tierResult.tier2Count} warm, ${tierResult.tier3Count} monitor`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Tier classification failed:", errMsg);
    failStep(tierStep, errMsg);
  }
  steps.push(tierStep);

  // ── Step 15: Contractor & Delivery Pattern Engine (Wednesdays + Saturdays) ──
  const contractorStep = startStep("Contractor Engine");
  if (dayOfWeek === 3 || dayOfWeek === 6) {
    console.log("[DailyPipeline] Step 15: Running contractor & delivery pattern engine...");
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
    console.log("[DailyPipeline] Step 15: Skipping contractor engine (runs Wed/Sat)");
  }
  steps.push(contractorStep);

  // ── Step 16: Contractor Enrichment Pass (Tuesdays + Fridays) ──
  const contractorEnrichStep = startStep("Contractor Enrichment Pass");
  if (dayOfWeek === 2 || dayOfWeek === 5) {
    console.log("[DailyPipeline] Step 16: Running contractor enrichment pass on projects missing contractors...");
    try {
      const ceResult = await runContractorEnrichmentPass(20);
      completeStep(contractorEnrichStep, {
        total: ceResult.total,
        enriched: ceResult.enriched,
        contractorsDiscovered: ceResult.contractorsDiscovered,
        failed: ceResult.failed,
        skipped: ceResult.skipped,
      });
      console.log(`[DailyPipeline] Contractor enrichment pass: ${ceResult.enriched} enriched, ${ceResult.contractorsDiscovered} contractors discovered, ${ceResult.failed} failed`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] Contractor enrichment pass failed:", errMsg);
      failStep(contractorEnrichStep, errMsg);
    }
  } else {
    skipStep(contractorEnrichStep, "Runs on Tuesdays and Fridays");
    console.log("[DailyPipeline] Step 16: Skipping contractor enrichment pass (runs Tue/Fri)");
  }
  steps.push(contractorEnrichStep);

  // ── Step 17: Role Relevance Classification (daily — classify all contacts) ──
  const roleRelevanceStep = startStep("Role Relevance Classification");
  console.log("[DailyPipeline] Step 17: Classifying contact role relevance...");
  try {
      const roleResult = await withTimeout(classifyAllContactRelevance(), STEP_TIMEOUT_MS, "Role Relevance");
    completeStep(roleRelevanceStep, {
      total: roleResult.total,
      high: roleResult.highCount,
      medium: roleResult.mediumCount,
      low: roleResult.lowCount,
    });
    console.log(`[DailyPipeline] Role relevance classification complete: ${roleResult.highCount} high, ${roleResult.mediumCount} medium, ${roleResult.lowCount} low`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    failStep(roleRelevanceStep, errMsg);
    console.error("[DailyPipeline] Role relevance classification failed:", errMsg);
  }
  steps.push(roleRelevanceStep);

  // ── Step 18: Second-Pass Contact Search (Wednesdays + Saturdays) ──
  const secondPassStep = startStep("Second-Pass Contact Search");
  if (dayOfWeek === 3 || dayOfWeek === 6) {
    console.log("[DailyPipeline] Step 18: Running second-pass contact search for projects with few relevant contacts...");
    try {
      const spResult = await withTimeout(runBulkSecondPass(30), STEP_TIMEOUT_MS, "Second-Pass Contact Search");
      completeStep(secondPassStep, {
        projectsProcessed: spResult.projectsProcessed,
        totalContactsAdded: spResult.totalContactsAdded,
        projectsImproved: spResult.projectsImproved,
      });
      console.log(`[DailyPipeline] Second-pass complete: ${spResult.totalContactsAdded} contacts added across ${spResult.projectsImproved} projects`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      failStep(secondPassStep, errMsg);
      console.error("[DailyPipeline] Second-pass contact search failed:", errMsg);
    }
  } else {
    skipStep(secondPassStep, "Runs on Wednesdays and Saturdays");
    console.log("[DailyPipeline] Step 18: Skipping second-pass contact search (runs Wed/Sat)");
  }
  steps.push(secondPassStep);

  // ════════════════════════════════════════════════════════════
  // DIGEST & NOTIFICATIONS
  // Email digests are now handled exclusively by the persistentScheduler
  // to prevent duplicate sends. The per-user deduplication in emailDigest.ts
  // provides a safety net, but the pipeline no longer triggers sends directly.
  // ════════════════════════════════════════════════════════════
  console.log("[DailyPipeline] Digest emails are handled by persistentScheduler (not pipeline). Skipping.");

  // ════════════════════════════════════════════════════════════
  // HOUSEKEEPING
  // ════════════════════════════════════════════════════════════

  // ── Step 21: Staleness Check ──
  const stalenessStep = startStep("Staleness Check");
  console.log("[DailyPipeline] Step 21: Running project staleness check...");
  try {
    const staleResult = await markStaleProjects();
    const staleCount = staleResult.staled + staleResult.archived;
    completeStep(stalenessStep, { markedStale: staleResult.staled, archived: staleResult.archived });
    if (staleCount > 0) {
      console.log(`[DailyPipeline] Marked ${staleResult.staled} projects as stale, ${staleResult.archived} archived (Stage 5A freshness check)`);
    } else {
      console.log("[DailyPipeline] No new stale or archived projects found");
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Staleness check failed:", errMsg);
    failStep(stalenessStep, errMsg);
  }
  steps.push(stalenessStep);

  // ── Step 22: Duplicate Detection Sweep ──
  const dupSweepStep = startStep("Duplicate Detection Sweep");
  console.log("[DailyPipeline] Step 22: Running duplicate detection sweep (Stage 5C)...");
  try {
    const dupResult = await runDuplicateDetectionSweep();
    completeStep(dupSweepStep, { clustersFound: dupResult.clustersFound, newAssignments: dupResult.newAssignments });
    console.log(`[DailyPipeline] Duplicate sweep complete: ${dupResult.clustersFound} clusters found, ${dupResult.newAssignments} new cluster assignments`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Duplicate sweep failed:", errMsg);
    failStep(dupSweepStep, errMsg);
  }
  steps.push(dupSweepStep);

  // ── Step 23: Source Monitoring Snapshot ──
  const monitorStep = startStep("Source Monitoring Snapshot");
  console.log("[DailyPipeline] Step 23: Recording source monitoring snapshot...");
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

  // ── Write core completion record BEFORE enrichment results are considered ──
  // This ensures the run is always recorded as completed if all critical steps passed,
  // even if enrichment steps timed out or failed downstream.
  const coreStepsFailed = steps.filter(s => CRITICAL_STEP_NAMES.has(s.name) && s.status === "failed");
  const enrichmentStepsFailed = steps.filter(s => ENRICHMENT_STEP_NAMES.has(s.name) && s.status === "failed");
  const coreStatus: "completed" | "failed" = coreStepsFailed.length > 0 ? "failed" : "completed";

  if (runId) {
    try {
      const db = await getDb();
      if (!db) throw new Error("No database connection");
      await db.update(pipelineRuns).set({
        status: coreStatus,
        completedAt: new Date(),
        durationMs: Math.round((Date.now() - startTime) * 1000),
        feedsFetched: harvestResult.totalSources,
        feedErrors: harvestResult.totalErrors,
        articlesIngested: harvestResult.totalNew,
        articlesSkippedKeyword: (harvestResult as any).totalSkipped || 0,
        articlesDuplicate: harvestResult.totalDuplicates,
        articlesExtracted: extractionResult.extracted,
        projectsCreated: extractionResult.extracted + projectoryResult.totalNewProjects + govResult.totalNewProjects + dmirsResult.totalNewProjects + austenderResult.totalNewProjects + aemoResult.totalNewProjects + icnResult.totalNewProjects + asxResult.newProjects,
        projectsDuplicate: extractionResult.duplicates,
        drillingCampaignsCreated: (extractionResult as any).drillingCampaignsInserted || 0,
        awardedProjectsCreated: (extractionResult as any).awardedProjectsInserted || 0,
        austenderContracts: austenderResult.totalNewProjects,
        dmirsProjects: dmirsResult.totalNewProjects,
        projectoryProjects: projectoryResult.totalNewProjects,
        projectoryEnriched: projectoryEnrichResult.enriched,
        govProjects: govResult.totalNewProjects,
        aemoProjects: aemoResult.totalNewProjects,
        icnProjects: icnResult.totalNewProjects,
        contactsEnriched: enrichmentResult.enriched,
        apolloCreditsUsed: enrichmentResult.dailyUsed,
        steps: steps,
        errors: errors.length > 0 ? errors : null,
      }).where(eq(pipelineRuns.id, runId));
      console.log(`[DailyPipeline] Core completion record written (status=${coreStatus}, ${coreStepsFailed.length} critical failures, ${enrichmentStepsFailed.length} enrichment failures tolerated)`);
    } catch (err) {
      console.error("[DailyPipeline] Failed to write core completion record:", err);
    }
  }

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
    tendersWA: tendersWAResult,
    qtolNT: qtolNTResult,
    duration,
    completedAt,
    steps,
  };

  // ── Final update: refresh with complete duration and final step list ──
  if (runId) {
    try {
      const db = await getDb();
      if (!db) throw new Error("No database connection");

      const hasErrors = errors.length > 0;
      // Only critical step failures flip the run to "failed"
      const hasCriticalFailure = steps.some(s => CRITICAL_STEP_NAMES.has(s.name) && s.status === "failed");

      await db.update(pipelineRuns).set({
        status: hasCriticalFailure ? "failed" : "completed",
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

  // ── Health Summary Log ──
  const criticalFailed = steps.filter(s => CRITICAL_STEP_NAMES.has(s.name) && s.status === "failed");
  const enrichmentFailed = steps.filter(s => ENRICHMENT_STEP_NAMES.has(s.name) && s.status === "failed");
  const degradedSources: string[] = [];
  if (asxResult.newProjects === 0 && asxResult.companiesChecked === 0) degradedSources.push("ASX (endpoint 404)");
  if (projectoryEnrichResult.enriched === 0 && projectoryResult.totalNewProjects === 0) degradedSources.push("Projectory (service 415)");

  console.log("\n" + "═".repeat(60));
  console.log("  PIPELINE RUN SUMMARY");
  console.log("═".repeat(60));
  console.log(`  Run ID:          ${runId || "N/A"}`);
  console.log(`  Status:          ${criticalFailed.length > 0 ? "FAILED (critical)" : "COMPLETED"}`);
  console.log(`  Duration:        ${duration}s`);
  console.log(`  Critical steps:  ${criticalFailed.length === 0 ? "All passed" : criticalFailed.map(s => s.name).join(", ") + " FAILED"}`);
  console.log(`  Enrichment:      ${enrichmentFailed.length === 0 ? "All passed" : enrichmentFailed.map(s => s.name).join(", ") + " failed (tolerated)"}`);
  if (degradedSources.length > 0) {
    console.log(`  Degraded:        ${degradedSources.join(", ")}`);
  }
  console.log(`  RSS:             ${harvestResult.totalNew} new / ${harvestResult.totalDuplicates} dupes / ${harvestResult.totalErrors} errors`);
  console.log(`  Projects:        ${extractionResult.extracted} extracted, ${asxResult.newProjects} ASX, ${dmirsResult.totalNewProjects} DMIRS`);
  console.log(`  Contacts:        ${enrichmentResult.enriched} enriched, ${enrichmentResult.dailyUsed} Apollo credits`);
  console.log("═".repeat(60) + "\n");

  console.log(`[DailyPipeline] Pipeline complete in ${duration}s`);
  return result;
}

// ── In-process scheduler ──
// Runs daily at 20:00 UTC (04:00 AEST / 04:00 AWST next day)
// Scheduled 3 hours before the Monday 23:00 UTC digest window to ensure
// fresh data is available for the freshness gate check.

let schedulerStarted = false;

/** UTC hour at which the daily pipeline runs. Must be before DIGEST_HOUR (23). */
const PIPELINE_HOUR_UTC = 20;

export function startDailyScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Cleanup stale runs from previous server instances
  cleanupStaleRuns().then(count => {
    if (count > 0) console.log(`[DailyPipeline] Startup cleanup: marked ${count} stale runs as failed`);
  }).catch(() => {});

  function scheduleNext(): void {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(PIPELINE_HOUR_UTC, 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    const delay = next.getTime() - now.getTime();
    const hoursUntil = Math.round(delay / 3600000 * 10) / 10;
    console.log(`[DailyPipeline] Next run scheduled in ${hoursUntil}h at ${next.toISOString()} (${PIPELINE_HOUR_UTC}:00 UTC daily)`);

    setTimeout(async () => {
      try {
        await runDailyPipeline("scheduler");
      } catch (err: unknown) {
        console.error("[DailyPipeline] Scheduled run failed:", err instanceof Error ? err.message : String(err));
      }
      // Always schedule next run, even if current one failed/timed out
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}
