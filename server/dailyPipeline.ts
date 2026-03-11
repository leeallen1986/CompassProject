/**
 * Daily Pipeline Runner
 *
 * Orchestrates the full daily pipeline:
 * 1. RSS Harvest — fetch all configured feeds
 * 2. AI Extraction — extract projects from queued articles (capped)
 * 3. Projectory Scrape (Mondays)
 * 4. Gov Major Projects Scrape (Tuesdays)
 * 5. DMIRS MINEDEX Scrape (Wednesdays)
 * 6. AusTender Scrape (Thursdays)
 * 7. AEMO Scrape (Fridays)
 * 8. ICN Gateway Scrape (Saturdays)
 * 9. Contact Enrichment
 * 10. Weekly Digest (Mondays)
 * 11. Staleness Check
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
import { markStaleProjects, getDb } from "./db";
import { pipelineRuns, type PipelineStep } from "../drizzle/schema";
import { eq } from "drizzle-orm";

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
  projectory: {
    ran: boolean;
    totalNewProjects: number;
    totalNewContacts: number;
    totalDuplicates: number;
    totalErrors: number;
    duration: number;
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
  console.log("[DailyPipeline] Starting daily pipeline run...");

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

  // ── Step 1: RSS Harvest ──
  const harvestStep = startStep("RSS Harvest");
  console.log("[DailyPipeline] Step 1: Harvesting RSS feeds...");
  let harvestResult;
  try {
    harvestResult = await harvestAllFeeds();
    completeStep(harvestStep, {
      sources: harvestResult.totalSources,
      newArticles: harvestResult.totalNew,
      duplicates: harvestResult.totalDuplicates,
      errors: harvestResult.totalErrors,
    });
    console.log(
      `[DailyPipeline] Harvest complete: ${harvestResult.totalNew} new articles from ${harvestResult.totalSources} sources`
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[DailyPipeline] Harvest failed:", errMsg);
    errors.push(`Harvest: ${errMsg}`);
    failStep(harvestStep, errMsg);
    harvestResult = { totalSources: 0, totalFetched: 0, totalNew: 0, totalDuplicates: 0, totalErrors: 1 };
  }
  steps.push(harvestStep);

  // ── Step 2: AI Extraction ──
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

  // ── Step 3: Projectory Scrape (Mondays) ──
  const isMonday = new Date().getUTCDay() === 1;
  const projectoryStep = startStep("Projectory Scrape");
  let projectoryResult = { ran: false, totalNewProjects: 0, totalNewContacts: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isMonday) {
    console.log("[DailyPipeline] Step 3: Scraping Projectory (weekly Monday run)...");
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
      console.log(`[DailyPipeline] Projectory complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] Projectory scrape failed:", errMsg);
      errors.push(`Projectory: ${errMsg}`);
      failStep(projectoryStep, errMsg);
      projectoryResult.totalErrors = 1;
    }
  } else {
    skipStep(projectoryStep, "Runs on Mondays only");
    console.log("[DailyPipeline] Skipping Projectory (runs on Mondays only)");
  }
  steps.push(projectoryStep);

  // ── Step 4: Government Major Projects (Tuesdays) ──
  const isTuesday = new Date().getUTCDay() === 2;
  const govStep = startStep("Gov Major Projects Scrape");
  let govResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isTuesday) {
    console.log("[DailyPipeline] Step 4: Scraping government major projects (weekly Tuesday run)...");
    try {
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
      console.log(`[DailyPipeline] Gov complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] Gov scrape failed:", errMsg);
      errors.push(`Gov: ${errMsg}`);
      failStep(govStep, errMsg);
      govResult.totalErrors = 1;
    }
  } else {
    skipStep(govStep, "Runs on Tuesdays only");
    console.log("[DailyPipeline] Skipping Gov projects (runs on Tuesdays only)");
  }
  steps.push(govStep);

  // ── Step 5: DMIRS MINEDEX (Wednesdays) ──
  const isWednesday = new Date().getUTCDay() === 3;
  const dmirsStep = startStep("DMIRS MINEDEX Scrape");
  let dmirsResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isWednesday) {
    console.log("[DailyPipeline] Step 5: Scraping DMIRS MINEDEX (weekly Wednesday run)...");
    try {
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
      console.log(`[DailyPipeline] DMIRS complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] DMIRS scrape failed:", errMsg);
      errors.push(`DMIRS: ${errMsg}`);
      failStep(dmirsStep, errMsg);
      dmirsResult.totalErrors = 1;
    }
  } else {
    skipStep(dmirsStep, "Runs on Wednesdays only");
    console.log("[DailyPipeline] Skipping DMIRS (runs on Wednesdays only)");
  }
  steps.push(dmirsStep);

  // ── Step 6: AusTender (Thursdays) ──
  const isThursday = new Date().getUTCDay() === 4;
  const austenderStep = startStep("AusTender Scrape");
  let austenderResult = { ran: false, totalFetched: 0, totalRelevant: 0, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isThursday) {
    console.log("[DailyPipeline] Step 6: Scraping AusTender contracts (weekly Thursday run)...");
    try {
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
      console.log(`[DailyPipeline] AusTender complete: ${scrapeResult.totalNewProjects} new projects from ${scrapeResult.totalRelevant} relevant contracts`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] AusTender scrape failed:", errMsg);
      errors.push(`AusTender: ${errMsg}`);
      failStep(austenderStep, errMsg);
      austenderResult.totalErrors = 1;
    }
  } else {
    skipStep(austenderStep, "Runs on Thursdays only");
    console.log("[DailyPipeline] Skipping AusTender (runs on Thursdays only)");
  }
  steps.push(austenderStep);

  // ── Step 7: AEMO (Fridays) ──
  const isFriday = new Date().getUTCDay() === 5;
  const aemoStep = startStep("AEMO Scrape");
  let aemoResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalSkipped: 0, totalErrors: 0, duration: 0 };
  if (isFriday) {
    console.log("[DailyPipeline] Step 7: Scraping AEMO generation projects (weekly Friday run)...");
    try {
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
      console.log(`[DailyPipeline] AEMO complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] AEMO scrape failed:", errMsg);
      errors.push(`AEMO: ${errMsg}`);
      failStep(aemoStep, errMsg);
      aemoResult.totalErrors = 1;
    }
  } else {
    skipStep(aemoStep, "Runs on Fridays only");
    console.log("[DailyPipeline] Skipping AEMO (runs on Fridays only)");
  }
  steps.push(aemoStep);

  // ── Step 8: ICN Gateway (Saturdays) ──
  const isSaturday = new Date().getUTCDay() === 6;
  const icnStep = startStep("ICN Gateway Scrape");
  let icnResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isSaturday) {
    console.log("[DailyPipeline] Step 8: Scraping ICN Gateway (weekly Saturday run)...");
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
      console.log(`[DailyPipeline] ICN complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[DailyPipeline] ICN scrape failed:", errMsg);
      errors.push(`ICN: ${errMsg}`);
      failStep(icnStep, errMsg);
      icnResult.totalErrors = 1;
    }
  } else {
    skipStep(icnStep, "Runs on Saturdays only");
    console.log("[DailyPipeline] Skipping ICN Gateway (runs on Saturdays only)");
  }
  steps.push(icnStep);

  // ── Step 9: Contact Enrichment ──
  const enrichmentStep = startStep("Contact Enrichment");
  console.log("[DailyPipeline] Step 9: Enriching contacts...");
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

  // ── Step 10: Web Stakeholder Discovery ──
  const webDiscoveryStep = startStep("Web Stakeholder Discovery");
  console.log("[DailyPipeline] Step 10: Running open-web stakeholder discovery...");
  try {
    const webResult = await runBulkWebDiscovery(20); // 20 projects per run
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

  // ── Step 11: Weekly Digest (Mondays) ──
  const digestStep = startStep("Weekly Digest");
  if (isMonday) {
    console.log("[DailyPipeline] Step 11: Sending weekly intelligence digest (Monday run)...");
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
    console.log("[DailyPipeline] Skipping weekly digest (runs on Mondays only)");
  }
  steps.push(digestStep);

  // ── Step 12: Staleness Check ──
  const stalenessStep = startStep("Staleness Check");
  console.log("[DailyPipeline] Step 12: Running project staleness check...");
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
    projectory: projectoryResult,
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
        projectsCreated: extractionResult.extracted + projectoryResult.totalNewProjects + govResult.totalNewProjects + dmirsResult.totalNewProjects + austenderResult.totalNewProjects + aemoResult.totalNewProjects + icnResult.totalNewProjects,
        projectsDuplicate: extractionResult.duplicates,
        drillingCampaignsCreated: (extractionResult as any).drillingCampaignsInserted || 0,
        awardedProjectsCreated: (extractionResult as any).awardedProjectsInserted || 0,
        // Scraper stats
        austenderContracts: austenderResult.totalNewProjects,
        dmirsProjects: dmirsResult.totalNewProjects,
        projectoryProjects: projectoryResult.totalNewProjects,
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
