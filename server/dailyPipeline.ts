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
 * 19. Hot Project SLA Enforcement (daily)
 * 20. Discovery Queue Processing (daily, batch 10)
 * 21. Weekly Digest (Mondays)
 * 22. Thursday Mid-Week Reminder (Thursdays)
 * 23. Staleness Check
 * 24. Source Monitoring Snapshot
 *
 * Every step is logged with timing, counts, and error detail into the pipelineRuns table.
 */
import { harvestAllFeeds } from "./rssHarvester";
import { runExtractionPipeline } from "./aiExtractor";
import { runEnrichmentPipeline, runStaleTierBackfill } from "./contactEnrichment";
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
import { enrichProjectContacts, revealContactEmail, manualContactApolloPass } from "./apolloEnrichment";
import { markStaleProjects, runDuplicateDetectionSweep, getDb } from "./db";
import { pipelineRuns, reports, type PipelineStep } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

// New source architecture imports
import { scanTargetCompanies } from "./asxMonitor";
import { runTendersWAScraper } from "./tendersWAScraper";
import { runQtolNTIsolated, isSubprocessEnabled, getSubprocessTimeoutMs } from "./qtolNTSubprocess";
import { enrichUnenrichedProjects, getSessionStatus as getProjectorySessionStatus } from "./projectoryEnrichment";
import { validateAllProjects as icnValidateAllProjects } from "./icnEnrichment";
import { recordSourceRun } from "./sourceMonitoring";
import { runContractorEngine } from "./contractorEngine";
import { classifyAllProjects } from "./tierClassification";
import { runContractorEnrichmentPass } from "./contractorEnrichmentPass";
import { backfillOrphanContacts } from "./backfillOrphanContacts";
import { cleanContractorUrls } from "./cleanContractorUrls";
import { classifyAllContactRelevance } from "./roleRelevance";
import { runBulkSecondPass } from "./secondPassContactSearch";
import { enforceHotProjectSLA, processDiscoveryQueue } from "./discoveryQueue";
import { runDigestSafePromotion } from "./digestSafePromotion";

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
  discoveryQueue: {
    slaQueued: number;
    slaAlreadyOk: number;
    slaSkipped: number;
    processed: number;
    newSendReady: number;
    newNamedNoEmail: number;
    newRoleOnly: number;
    blocked: number;
    failed: number;
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
const ENRICHMENT_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutes for contact enrichment
// Per-run batch limit: process at most this many contacts per automatic pipeline run.
// Rationale: 24,236 pending contacts caused the scheduler to time out at 25 min.
// At ~2s per contact, 200 contacts = ~400s (~6.7 min), well within the 25-min window.
// The backlog drains across successive nightly runs (200/night ≈ 121 nights to clear).
// Manual admin-triggered runs can use a higher limit via the Admin dashboard.
const ENRICHMENT_BATCH_SIZE = 200;

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
  "Hot Project SLA Enforcement",
  "Discovery Queue Processing",
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
    // Mark any runs stuck in "running" for more than 5 hours as failed.
    // The pipeline can legitimately run for 60-90 minutes, so we use 5h to avoid
    // falsely marking an in-progress run as failed on a server restart.
    const oneHourAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
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

// ── Self-ping keepalive ──
// CloudRun recycles containers that have no HTTP traffic for ~15 min.
// During a long pipeline run (35+ min), no user requests may arrive,
// so the container gets killed mid-pipeline. This keepalive pings the
// server's own /api/ping endpoint every 2 minutes to simulate traffic.
function startKeepalive(): { stop: () => void } {
  const port = process.env.PORT || "3000";
  const url = `http://localhost:${port}/api/ping`;
  let stopped = false;
  const interval = setInterval(async () => {
    if (stopped) return;
    try {
      await fetch(url, { signal: AbortSignal.timeout(5000) });
    } catch {
      // Ignore — best-effort keepalive
    }
  }, 2 * 60 * 1000); // every 2 minutes
  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}

// ── Main pipeline ──

export async function runDailyPipeline(triggeredBy?: string): Promise<DailyPipelineResult> {
  // Start keepalive at the outer level so it's cleaned up even on timeout
  const keepalive = startKeepalive();
  try {
    return await withTimeout(_runDailyPipelineInner(triggeredBy), PIPELINE_TIMEOUT_MS, "Daily pipeline global timeout");
  } finally {
    keepalive.stop();
  }
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

  /**
   * Write a partial progress checkpoint to pipelineRuns.
   * Called after each major step group so that if the pipeline is killed mid-run,
   * the DB record shows the stats that were completed rather than all-zero.
   * Fire-and-forget: errors are logged but never rethrow.
   */
  async function writeProgressCheckpoint(
    partial: Record<string, unknown>,
    opts?: { currentStep?: string; lastActivityNote?: string }
  ): Promise<void> {
    if (!runId) return;
    try {
      const db = await getDb();
      if (!db) return;
      await db.update(pipelineRuns)
        .set({
          ...partial,
          steps,
          errors: errors.length > 0 ? errors : null,
          lastProgressAt: new Date(),
          ...(opts?.currentStep !== undefined ? { currentStep: opts.currentStep } : {}),
          ...(opts?.lastActivityNote ? { lastActivityNote: opts.lastActivityNote } : {}),
        } as any)
        .where(eq(pipelineRuns.id, runId));
    } catch (err) {
      console.warn(`[DailyPipeline] Progress checkpoint write failed (non-fatal):`, err instanceof Error ? err.message : String(err));
    }
  }

  /** Fire-and-forget: mark the current step name so Admin shows what's running */
  function markStepStarted(stepName: string): void {
    void writeProgressCheckpoint({}, { currentStep: stepName });
  }

  // ── Step 1: RSS Harvest (daily) ──
  markStepStarted("RSS Harvest");
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
  markStepStarted("AI Extraction");
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
  // ── Progress checkpoint 1/4: harvest + extraction ──
  void writeProgressCheckpoint({
    feedsFetched: harvestResult.totalSources,
    feedErrors: harvestResult.totalErrors,
    articlesIngested: harvestResult.totalNew,
    articlesDuplicate: harvestResult.totalDuplicates,
    articlesExtracted: extractionResult.extracted,
    projectsCreated: extractionResult.extracted,
    projectsDuplicate: extractionResult.duplicates,
  }, {
    lastActivityNote: `Harvest: ${harvestResult.totalNew} new articles from ${harvestResult.totalSources} sources. Extraction: ${extractionResult.extracted} projects from ${extractionResult.processed} articles.`,
  });

  // ── Step 3: ASX Targeted Monitoring (daily — lightweight) ──
  markStepStarted("ASX Targeted Monitoring");
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
  markStepStarted("Tenders WA");
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
  // Runs in an isolated child process with a hard wall-clock kill timer.
  // Feature flags:
  //   QTOL_NT_SUBPROCESS_ENABLED    = "true" (default) | "false"
  //   QTOL_NT_SUBPROCESS_TIMEOUT_MS = ms (default: 300000 = 5 min)
  // If the child hangs, it is killed unconditionally and the step is marked
  // failed — the pipeline continues to the next step regardless.
  markStepStarted("QTOL NT");
  const qtolNTStep = startStep("QTOL NT");
  console.log(
    `[DailyPipeline] Step 3b: Scraping QTOL NT ` +
    `(subprocess=${isSubprocessEnabled()}, timeout=${Math.round(getSubprocessTimeoutMs() / 1000)}s)...`
  );
  let qtolNTResult = { ran: false, tendersFound: 0, tendersRelevant: 0, projectsCreated: 0, projectsUpdated: 0, priorityIssuerTenders: 0, degraded: false, degradedReason: undefined as string | undefined, errors: 0 };
  {
    // ── Circuit breaker: always continues pipeline regardless of outcome ──
    const stepStart = Date.now();
    const isolated = await runQtolNTIsolated(canonicalReportId || runId || 0);
    const stepDurationSec = Math.round((Date.now() - stepStart) / 1000);

    if (isolated.status === "success" && isolated.data) {
      const ntData = isolated.data;
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
      recordSourceRun("qtol_nt", !ntData.degraded, ntData.projectsCreated, stepDurationSec);
      console.log(`[DailyPipeline] QTOL NT complete: ${ntData.tendersFound} found, ${ntData.projectsCreated} created`);
    } else {
      // failed or timed_out — circuit breaker: log, mark step failed, continue pipeline
      const errMsg = isolated.errorSummary ?? `QTOL NT ${isolated.status} after ${stepDurationSec}s`;
      console.error(
        `[DailyPipeline] QTOL NT step ${isolated.status} — circuit breaker engaged, ` +
        `pipeline will continue. Reason: ${errMsg}`
      );
      errors.push(`QTOL NT: ${errMsg}`);
      failStep(qtolNTStep, errMsg);
      recordSourceRun("qtol_nt", false, 0, stepDurationSec, errMsg);
    }
  }
  steps.push(qtolNTStep);

  // ── Step 4: AusTender (Thursdays) ──
  const isThursday = dayOfWeek === 4;
  markStepStarted("AusTender OCDS API");
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
  markStepStarted("DMIRS MINEDEX API");
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
  markStepStarted("Gov Major Projects");
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
  markStepStarted("AEMO Generation Info");
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
  markStepStarted("Projectory Enrichment");
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
  let icnResult = { ran: false, totalNewProjects: 0, totalUpdated: 0, totalDuplicates: 0, totalErrors: 0, duration: 0, reactivated: [] as string[] };
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
        totalUpdated: scrapeResult.totalUpdated,
        totalDuplicates: scrapeResult.totalDuplicates,
        totalErrors: scrapeResult.totalErrors,
        duration: scrapeResult.duration,
        reactivated: scrapeResult.reactivated,
      };
      completeStep(icnStep, {
        newProjects: scrapeResult.totalNewProjects,
        updated: scrapeResult.totalUpdated,
        reactivated: scrapeResult.reactivated.length,
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
  // ── Progress checkpoint 2/4: scrapers complete ──
  void writeProgressCheckpoint({
    feedsFetched: harvestResult.totalSources,
    feedErrors: harvestResult.totalErrors,
    articlesIngested: harvestResult.totalNew,
    articlesDuplicate: harvestResult.totalDuplicates,
    articlesExtracted: extractionResult.extracted,
    projectsCreated: extractionResult.extracted + projectoryResult.totalNewProjects + govResult.totalNewProjects + dmirsResult.totalNewProjects + austenderResult.totalNewProjects + aemoResult.totalNewProjects + icnResult.totalNewProjects + asxResult.newProjects,
    projectsDuplicate: extractionResult.duplicates,
    drillingCampaignsCreated: (extractionResult as any).drillingCampaignsInserted || 0,
    awardedProjectsCreated: (extractionResult as any).awardedProjectsInserted || 0,
    austenderContracts: austenderResult.totalNewProjects,
    dmirsProjects: dmirsResult.totalNewProjects,
    projectoryProjects: projectoryResult.totalNewProjects,
    govProjects: govResult.totalNewProjects,
    aemoProjects: aemoResult.totalNewProjects,
    icnProjects: icnResult.totalNewProjects,
  });

  // ════════════════════════════════════════════════════════════
  // CONTACT & SCORING PIPELINE
  // ════════════════════════════════════════════════════════════

  // ── Step 10: Contact Enrichment ──
  markStepStarted("Contact Enrichment");
  const enrichmentStep = startStep("Contact Enrichment");
  console.log("[DailyPipeline] Step 10: Enriching contacts...");
  let enrichmentResult;
  try {
    enrichmentResult = await withTimeout(runEnrichmentPipeline(ENRICHMENT_BATCH_SIZE), ENRICHMENT_TIMEOUT_MS, "Contact Enrichment");
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

  // ── Step 10a: Stale Trust-Tier Backfill ──
  // Promotes contacts already meeting send_ready criteria but stuck at named_unverified.
  // Zero API cost, safe to run every day (promote-only, never demotes).
  const staleTierStep = startStep("Stale Trust-Tier Backfill");
  try {
    const staleTierResult = await runStaleTierBackfill();
    completeStep(staleTierStep, { promoted: staleTierResult.promoted });
    if (staleTierResult.promoted > 0) {
      console.log(`[DailyPipeline] Step 10a: Promoted ${staleTierResult.promoted} stale contacts to send_ready`);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Stale tier backfill failed:", errMsg);
    failStep(staleTierStep, errMsg);
  }
  steps.push(staleTierStep);

  // ── Progress checkpoint 3/4: contact enrichment complete ──
  void writeProgressCheckpoint({
    feedsFetched: harvestResult.totalSources,
    feedErrors: harvestResult.totalErrors,
    articlesIngested: harvestResult.totalNew,
    articlesDuplicate: harvestResult.totalDuplicates,
    articlesExtracted: extractionResult.extracted,
    projectsCreated: extractionResult.extracted + projectoryResult.totalNewProjects + govResult.totalNewProjects + dmirsResult.totalNewProjects + austenderResult.totalNewProjects + aemoResult.totalNewProjects + icnResult.totalNewProjects + asxResult.newProjects,
    projectsDuplicate: extractionResult.duplicates,
    drillingCampaignsCreated: (extractionResult as any).drillingCampaignsInserted || 0,
    awardedProjectsCreated: (extractionResult as any).awardedProjectsInserted || 0,
    austenderContracts: austenderResult.totalNewProjects,
    dmirsProjects: dmirsResult.totalNewProjects,
    projectoryProjects: projectoryResult.totalNewProjects,
    govProjects: govResult.totalNewProjects,
    aemoProjects: aemoResult.totalNewProjects,
    icnProjects: icnResult.totalNewProjects,
    contactsEnriched: enrichmentResult.enriched,
    apolloCreditsUsed: enrichmentResult.dailyUsed,
  }, {
    lastActivityNote: `Contact enrichment: ${enrichmentResult.enriched} contacts enriched (${enrichmentResult.dailyUsed} Apollo credits used).`,
  });

  // ── Step 11: Web Stakeholder Discovery ──
  markStepStarted("Web Stakeholder Discovery");
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
  markStepStarted("Apollo Gap-Fill");
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

  // ── Step 12b: Apollo Backfill Pass (warm/hot projects with 0 send_ready, remaining budget) ──
  // Runs after the primary gap-fill to chip away at the backlog of projects with 0 send_ready contacts.
  // Uses whatever budget remains after the gap-fill (up to 100 credits max — raised from 30 to accelerate coverage).
  const apolloBackfillStep = startStep("Apollo Backfill Pass");
  try {
    const backfillBudget = await getBudgetStatus();
    if (!backfillBudget.withinBudget || backfillBudget.dailyRemaining < 5) {
      skipStep(apolloBackfillStep, `Budget too low for backfill — daily remaining: ${backfillBudget.dailyRemaining}`);
      console.log(`[DailyPipeline] Apollo backfill skipped: only ${backfillBudget.dailyRemaining} credits remaining`);
    } else {
      const maxBackfillCredits = Math.min(100, backfillBudget.dailyRemaining);
      console.log(`[DailyPipeline] Step 12b: Apollo backfill pass — targeting warm/hot projects with 0 send_ready (budget: ${maxBackfillCredits} credits)...`);

      // Query projects with 0 send_ready but eligible named_unverified contacts
      const db = await getDb();
      const backfillTargets = db ? await db.execute(
        sql`SELECT DISTINCT
          cp.projectId,
          p.name AS projectName,
          p.priority,
          SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) AS send_ready_count,
          SUM(CASE WHEN c.contactTrustTier = 'named_unverified'
            AND c.rejectionReason IS NULL AND c.crmOrphan = 0
            AND (c.enrichmentSource = 'apollo' OR c.linkedin IS NOT NULL)
            AND (c.enrichmentStatus IS NULL
              OR (c.enrichmentStatus NOT IN ('enriched', 'not_found') AND c.enrichedAt IS NULL)
              OR c.enrichedAt < DATE_SUB(NOW(), INTERVAL 7 DAY))
          THEN 1 ELSE 0 END) AS eligible_count
        FROM projects p
        JOIN contactProjects cp ON cp.projectId = p.id
        JOIN contacts c ON c.id = cp.contactId AND c.rejectionReason IS NULL AND c.crmOrphan = 0
        WHERE p.priority IN ('hot', 'warm')
          AND p.lifecycleStatus = 'active'
          AND (p.suppressed IS NULL OR p.suppressed = 0)
        GROUP BY cp.projectId, p.name, p.priority
        HAVING send_ready_count = 0 AND eligible_count > 0
        ORDER BY p.priority = 'hot' DESC, eligible_count DESC
        LIMIT 20`
      ) : null;

      const rows = (backfillTargets as any)?.[0] ?? [];
      let backfillRevealed = 0;
      let backfillSkipped = 0;
      let backfillCredits = 0;

      for (const row of rows) {
        const currentBudget = await getBudgetStatus();
        if (!currentBudget.withinBudget || backfillCredits >= maxBackfillCredits) break;

        // Get the top eligible contact for this project
        const contactRows = db ? await db.execute(
          sql`SELECT c.id FROM contacts c
            JOIN contactProjects cp ON cp.contactId = c.id
            WHERE cp.projectId = ${row.projectId}
              AND c.contactTrustTier = 'named_unverified'
              AND c.rejectionReason IS NULL AND c.crmOrphan = 0
              AND (c.enrichmentSource = 'apollo' OR c.linkedin IS NOT NULL)
              AND (c.enrichmentStatus IS NULL
                OR (c.enrichmentStatus NOT IN ('enriched', 'not_found') AND c.enrichedAt IS NULL)
                OR c.enrichedAt < DATE_SUB(NOW(), INTERVAL 7 DAY))
            ORDER BY c.linkedin IS NOT NULL DESC, c.enrichmentSource = 'apollo' DESC
            LIMIT 3`
        ) : null;

        const contactList = (contactRows as any)?.[0] ?? [];
        for (const contactRow of contactList) {
          if (backfillCredits >= maxBackfillCredits) break;
          try {
            const revealed = await revealContactEmail(contactRow.id, { userId: 0, userName: "pipeline-backfill" });
            if (revealed) {
              backfillRevealed++;
              backfillCredits++;
              console.log(`[DailyPipeline] Backfill revealed contact ${contactRow.id} for project ${row.projectId}`);
              break; // One reveal per project is enough to qualify for digestSafe
            } else {
              backfillSkipped++;
            }
          } catch {
            backfillSkipped++;
          }
        }
      }

      completeStep(apolloBackfillStep, { revealed: backfillRevealed, skipped: backfillSkipped, creditsUsed: backfillCredits, projectsTargeted: rows.length });
      console.log(`[DailyPipeline] Apollo backfill complete: ${backfillRevealed} revealed, ${backfillSkipped} skipped, ${backfillCredits} credits used`);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Apollo backfill failed:", errMsg);
    failStep(apolloBackfillStep, errMsg);
  }
  steps.push(apolloBackfillStep);

  // ── Step 12d: Manual Contact Apollo Pass ──
  // Targets the large backlog of manually-imported contacts (enrichmentSource = 'manual')
  // on hot/warm active projects that have no email yet. These contacts are excluded from
  // the LinkedIn enrichment step, so they never get emails unless Apollo is called for them.
  const manualApolloStep = startStep("Manual Contact Apollo Pass");
  try {
    const manualBudget = await getBudgetStatus();
    if (!manualBudget.withinBudget || manualBudget.dailyRemaining < 5) {
      skipStep(manualApolloStep, `Budget too low for manual pass — daily remaining: ${manualBudget.dailyRemaining}`);
      console.log(`[DailyPipeline] Manual Apollo pass skipped: only ${manualBudget.dailyRemaining} credits remaining`);
    } else {
      const maxManualCredits = Math.min(150, manualBudget.dailyRemaining);
      console.log(`[DailyPipeline] Step 12d: Manual Contact Apollo Pass — targeting manual pending contacts on hot/warm projects (budget: ${maxManualCredits} credits)...`);
      const manualResult = await manualContactApolloPass({ maxCredits: maxManualCredits });
      completeStep(manualApolloStep, {
        processed: manualResult.processed,
        revealed: manualResult.revealed,
        skipped: manualResult.skipped,
        failed: manualResult.failed,
        creditsUsed: manualResult.creditsUsed,
        projectsTargeted: manualResult.projectsTargeted,
      });
      console.log(`[DailyPipeline] Manual Apollo pass complete: ${manualResult.revealed} revealed, ${manualResult.skipped} skipped, ${manualResult.creditsUsed} credits used across ${manualResult.projectsTargeted} projects`);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Manual Apollo pass failed:", errMsg);
    failStep(manualApolloStep, errMsg);
  }
  steps.push(manualApolloStep);

  // ── Step 12c: DigestSafe Auto-Promotion ──
  // Runs after all Apollo enrichment to promote newly qualifying projects.
  const digestSafeStep = startStep("DigestSafe Promotion");
  try {
    console.log("[DailyPipeline] Step 12c: Running digestSafe auto-promotion...");
    const promoResult = await runDigestSafePromotion();
    completeStep(digestSafeStep, {
      promoted: promoResult.promoted,
      alreadySafe: promoResult.alreadySafe,
      skipped: promoResult.skipped,
      errors: promoResult.errors,
    });
    console.log(`[DailyPipeline] DigestSafe promotion: ${promoResult.promoted} promoted, ${promoResult.alreadySafe} already safe, ${promoResult.skipped} skipped`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] DigestSafe promotion failed:", errMsg);
    failStep(digestSafeStep, errMsg);
  }
  steps.push(digestSafeStep);

  // ── Step 13: Business Line Scoring ──
  markStepStarted("Business Line Scoring");
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
  markStepStarted("Tier Classification");
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
  // Fix 7: Run contractor enrichment DAILY for hot/warm projects (was Tue/Fri only).
  // This unblocks 6+ government-owner projects that are permanently stuck without contractors.
  const contractorEnrichStep = startStep("Contractor Enrichment Pass");
  console.log("[DailyPipeline] Step 16: Running contractor enrichment pass on projects missing contractors (daily for hot/warm)...");
  try {
    const ceResult = await runContractorEnrichmentPass(30);
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
  // DISCOVERY QUEUE
  // ════════════════════════════════════════════════════════════

  // ── Step 19: Hot Project SLA Enforcement (daily) ──
  const hotSlaStep = startStep("Hot Project SLA Enforcement");
  console.log("[DailyPipeline] Step 19: Enforcing hot project SLA — queuing discovery for hot/actioned projects missing contacts...");
  let slaResult = { queued: 0, alreadyOk: 0, skipped: 0 };
  try {
    slaResult = await withTimeout(enforceHotProjectSLA(), STEP_TIMEOUT_MS, "Hot Project SLA");
    completeStep(hotSlaStep, {
      queued: slaResult.queued,
      alreadyOk: slaResult.alreadyOk,
      skipped: slaResult.skipped,
    });
    console.log(`[DailyPipeline] Hot SLA enforcement: ${slaResult.queued} queued, ${slaResult.alreadyOk} already OK, ${slaResult.skipped} skipped`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Hot SLA enforcement failed:", errMsg);
    errors.push(`Hot SLA: ${errMsg}`);
    failStep(hotSlaStep, errMsg);
  }
  steps.push(hotSlaStep);

  // ── Step 20: Discovery Queue Processing (daily, batch 50) ──
  // Processes the highest-priority queued projects (Priority A first).
  // Fix 3: Raised from 3 to 50 to clear the 456-project backlog in ~10 days.
  // Each project triggers Apollo/web/LLM discovery which can take 5-15s per project.
  // Batch=50 keeps total pipeline runtime under 25 minutes (within ENRICHMENT_TIMEOUT_MS).
  const DISCOVERY_QUEUE_BATCH = 50;
  markStepStarted("Discovery Queue Processing");
  const discoveryQueueStep = startStep("Discovery Queue Processing");
  console.log(`[DailyPipeline] Step 20: Processing discovery queue (batch ${DISCOVERY_QUEUE_BATCH}, Priority A first)...`);
  let discoveryQueueResult = { processed: 0, priorityA: 0, priorityB: 0, priorityC: 0, newSendReady: 0, newNamedNoEmail: 0, newRoleOnly: 0, blocked: 0, failed: 0, results: [] as any[] };
  try {
    discoveryQueueResult = await withTimeout(
      processDiscoveryQueue({ maxBatch: DISCOVERY_QUEUE_BATCH }),
      ENRICHMENT_TIMEOUT_MS, // 25 min — same as contact enrichment
      "Discovery Queue"
    );
    completeStep(discoveryQueueStep, {
      processed: discoveryQueueResult.processed,
      priorityA: discoveryQueueResult.priorityA,
      priorityB: discoveryQueueResult.priorityB,
      priorityC: discoveryQueueResult.priorityC,
      newSendReady: discoveryQueueResult.newSendReady,
      newNamedNoEmail: discoveryQueueResult.newNamedNoEmail,
      newRoleOnly: discoveryQueueResult.newRoleOnly,
      blocked: discoveryQueueResult.blocked,
      failed: discoveryQueueResult.failed,
    });
    console.log(`[DailyPipeline] Discovery queue: ${discoveryQueueResult.processed} processed — ${discoveryQueueResult.newSendReady} send-ready, ${discoveryQueueResult.newNamedNoEmail} named-no-email, ${discoveryQueueResult.newRoleOnly} role-only, ${discoveryQueueResult.blocked} blocked, ${discoveryQueueResult.failed} failed`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Discovery queue processing failed:", errMsg);
    errors.push(`Discovery Queue: ${errMsg}`);
    failStep(discoveryQueueStep, errMsg);
  }
  steps.push(discoveryQueueStep);
  // ── Progress checkpoint 4/4: discovery queue complete ──
  void writeProgressCheckpoint({
    feedsFetched: harvestResult.totalSources,
    feedErrors: harvestResult.totalErrors,
    articlesIngested: harvestResult.totalNew,
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
  }, {
    lastActivityNote: `Discovery queue: ${discoveryQueueResult.processed} projects processed — ${discoveryQueueResult.newSendReady} send-ready, ${discoveryQueueResult.newNamedNoEmail} named-no-email.`,
  });

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
  markStepStarted("Staleness Check");
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
  markStepStarted("Duplicate Detection Sweep");
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

  // ── Step 23: Orphan Contact Backfill (Fix 5) ──
  const backfillStep = startStep("Orphan Contact Backfill");
  console.log("[DailyPipeline] Step 23: Backfilling orphan enriched contacts to projects...");
  try {
    const backfillResult = await backfillOrphanContacts(false);
    completeStep(backfillStep, {
      totalOrphans: backfillResult.totalOrphans,
      matchedHigh: backfillResult.matchedHigh,
      matchedMedium: backfillResult.matchedMedium,
      unmatched: backfillResult.unmatched,
      linksCreated: backfillResult.linksCreated,
    });
    console.log(`[DailyPipeline] Orphan backfill: ${backfillResult.linksCreated} links created (${backfillResult.matchedHigh} high, ${backfillResult.matchedMedium} medium confidence)`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Orphan backfill failed:", errMsg);
    failStep(backfillStep, errMsg);
  }
  steps.push(backfillStep);

  // ── Step 24: URL-as-Contractor Cleanup (Fix 6) ──
  const urlCleanupStep = startStep("URL Contractor Cleanup");
  console.log("[DailyPipeline] Step 24: Cleaning URL-as-contractor-name data...");
  try {
    const cleanResult = await cleanContractorUrls(false);
    completeStep(urlCleanupStep, {
      scanned: cleanResult.totalProjectsScanned,
      projectsCleaned: cleanResult.projectsWithUrlContractors,
      contractorsRemoved: cleanResult.contractorsRemoved,
      requeued: cleanResult.projectsRequeued,
    });
    console.log(`[DailyPipeline] URL cleanup: ${cleanResult.projectsWithUrlContractors} projects cleaned, ${cleanResult.contractorsRemoved} URL contractors removed, ${cleanResult.projectsRequeued} requeued`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] URL contractor cleanup failed:", errMsg);
    failStep(urlCleanupStep, errMsg);
  }
  steps.push(urlCleanupStep);

  // ── Step 25: Source Monitoring Snapshot ──
  const monitorStep = startStep("Source Monitoring Snapshot");
  console.log("[DailyPipeline] Step 25: Recording source monitoring snapshot...");
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
        // Clear currentStep on completion so Admin shows no active step
        currentStep: null,
        lastProgressAt: new Date(),
        lastActivityNote: `Pipeline ${coreStatus}: ${extractionResult.extracted} projects extracted, ${enrichmentResult.enriched} contacts enriched in ${Math.round((Date.now() - startTime) / 60000)} min.`,
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
    discoveryQueue: {
      slaQueued: slaResult.queued,
      slaAlreadyOk: slaResult.alreadyOk,
      slaSkipped: slaResult.skipped,
      processed: discoveryQueueResult.processed,
      newSendReady: discoveryQueueResult.newSendReady,
      newNamedNoEmail: discoveryQueueResult.newNamedNoEmail,
      newRoleOnly: discoveryQueueResult.newRoleOnly,
      blocked: discoveryQueueResult.blocked,
      failed: discoveryQueueResult.failed,
    },
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

      // Force-complete override: if the cleanup job marked this run as 'failed' during a server restart
      // mid-run, we override it back to 'completed' here since the pipeline actually finished.
      // We do NOT override if there was a critical step failure — that's a genuine failure.
      const [currentRunRecord] = await db.select({ status: pipelineRuns.status }).from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
      if (!hasCriticalFailure && currentRunRecord?.status === 'failed') {
        console.warn(`[DailyPipeline] ⚠ Run ${runId} was marked 'failed' by cleanup (server restart mid-run) but pipeline completed successfully — overriding status to 'completed'`);
      }

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
  console.log(`  Discovery SLA:   ${slaResult.queued} queued, ${slaResult.alreadyOk} already OK, ${slaResult.skipped} skipped`);
  console.log(`  Discovery Queue: ${discoveryQueueResult.processed} processed — ${discoveryQueueResult.newSendReady} send-ready, ${discoveryQueueResult.failed} failed`);
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

/**
 * Start the in-process daily pipeline scheduler.
 *
 * PRODUCTION NOTE:
 * This in-process scheduler is a DEVELOPMENT FALLBACK ONLY.
 * In production (NODE_ENV=production), the pipeline is triggered externally
 * by a Manus scheduled task that POSTs to POST /api/scheduled/pipeline daily
 * at 20:00 UTC. That external trigger is the source of truth for production
 * and is immune to CloudRun idle shutdowns.
 *
 * This scheduler is kept active in development so local dev environments
 * still get automatic pipeline runs without needing an external scheduler.
 * In production, it logs a warning and exits immediately.
 */
export function startDailyScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Always run startup cleanup regardless of environment
  cleanupStaleRuns().then(count => {
    if (count > 0) console.log(`[DailyPipeline] Startup cleanup: marked ${count} stale runs as failed`);
  }).catch(() => {});

  // In production, the external Manus scheduled task is the source of truth.
  // Do NOT start the in-process scheduler — it would be unreliable on CloudRun.
  // Guard checks both NODE_ENV and DISABLE_DEV_SCHEDULER because the platform
  // may start the app via the dev script (NODE_ENV=development) even in production.
  const isProduction = process.env.NODE_ENV === "production";
  const isDisabled = process.env.DISABLE_DEV_SCHEDULER === "true";
  if (isProduction || isDisabled) {
    console.log(
      `[DailyPipeline] In-process scheduler DISABLED (NODE_ENV=${process.env.NODE_ENV}, DISABLE_DEV_SCHEDULER=${process.env.DISABLE_DEV_SCHEDULER}). ` +
      "Daily pipeline is triggered externally via POST /api/scheduled/run-pipeline."
    );
    return;
  }

  // Development mode: use in-process setTimeout as a convenience.
  console.log(`[DailyPipeline] Development mode: in-process scheduler active (${PIPELINE_HOUR_UTC}:00 UTC daily).`);

  function scheduleNext(): void {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(PIPELINE_HOUR_UTC, 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    const delay = next.getTime() - now.getTime();
    const hoursUntil = Math.round(delay / 3600000 * 10) / 10;
    console.log(`[DailyPipeline] [DEV] Next run scheduled in ${hoursUntil}h at ${next.toISOString()} (${PIPELINE_HOUR_UTC}:00 UTC daily)`);

    setTimeout(async () => {
      try {
        await runDailyPipeline("scheduler-dev");
      } catch (err: unknown) {
        console.error("[DailyPipeline] [DEV] Scheduled run failed:", err instanceof Error ? err.message : String(err));
      }
      // Always schedule next run, even if current one failed/timed out
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

/**
 * SIGTERM handler — marks any in-flight pipeline run as failed before the
 * container exits. CloudRun sends SIGTERM before killing the process, giving
 * us a short window to update the DB. Without this, runs stay stuck in
 * "running" status until the next startup cleanup (which can be hours later).
 *
 * Note: Node.js timers (setTimeout / withTimeout) are destroyed on SIGTERM,
 * so they cannot self-report failure. This handler is the only reliable path.
 */
let sigtermHandlerRegistered = false;
export function registerSigtermHandler(): void {
  if (sigtermHandlerRegistered) return;
  sigtermHandlerRegistered = true;

  process.on("SIGTERM", async () => {
    console.log("[DailyPipeline] SIGTERM received — marking running pipeline runs as failed...");
    try {
      const db = await getDb();
      if (db) {
        const result = await db
          .update(pipelineRuns)
          .set({
            status: "failed",
            completedAt: new Date(),
            errors: ["Container shutdown (SIGTERM)"],
          })
          .where(eq(pipelineRuns.status, "running"));
        const affected = (result as unknown as { affectedRows?: number })?.affectedRows ?? 0;
        console.log(`[DailyPipeline] SIGTERM cleanup: marked ${affected} running run(s) as failed.`);
      }
    } catch (err: unknown) {
      console.error("[DailyPipeline] SIGTERM cleanup error:", err instanceof Error ? err.message : String(err));
    } finally {
      process.exit(0);
    }
  });
}
