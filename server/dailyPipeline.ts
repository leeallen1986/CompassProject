/**
 * Daily Pipeline Runner
 *
 * Orchestrates the full daily pipeline:
 * 1. RSS Harvest — fetch all configured feeds
 * 2. AI Extraction — extract projects from queued articles (capped)
 * 3. Contact Enrichment — enrich pending contacts via LinkedIn (capped)
 * 4. Notify owner with summary
 *
 * Can be triggered via:
 * - Admin dashboard button
 * - Scheduled task (external cron hitting the /api/pipeline/daily endpoint)
 * - In-process setInterval (runs at 06:00 UTC daily)
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
import { markStaleProjects } from "./db";

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
}

export async function runDailyPipeline(): Promise<DailyPipelineResult> {
  const startTime = Date.now();
  console.log("[DailyPipeline] Starting daily pipeline run...");

  // Step 1: RSS Harvest
  console.log("[DailyPipeline] Step 1/3: Harvesting RSS feeds...");
  let harvestResult;
  try {
    harvestResult = await harvestAllFeeds();
    console.log(
      `[DailyPipeline] Harvest complete: ${harvestResult.totalNew} new articles from ${harvestResult.totalSources} sources`
    );
  } catch (err: unknown) {
    console.error("[DailyPipeline] Harvest failed:", err instanceof Error ? err.message : String(err));
    harvestResult = { totalSources: 0, totalFetched: 0, totalNew: 0, totalDuplicates: 0, totalErrors: 1 };
  }

  // Step 2: AI Extraction
  console.log("[DailyPipeline] Step 2/3: Running AI extraction...");
  let extractionResult;
  try {
    extractionResult = await runExtractionPipeline();
    console.log(
      `[DailyPipeline] Extraction complete: ${extractionResult.extracted} projects from ${extractionResult.processed} articles`
    );
  } catch (err: unknown) {
    console.error("[DailyPipeline] Extraction failed:", err instanceof Error ? err.message : String(err));
    extractionResult = { processed: 0, extracted: 0, duplicates: 0, skipped: 0, failed: 0, creditsUsed: 0, results: [] };
  }

  // Step 3: Projectory Scrape (weekly — runs on Mondays)
  const isMonday = new Date().getUTCDay() === 1;
  let projectoryResult = { ran: false, totalNewProjects: 0, totalNewContacts: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isMonday) {
    console.log("[DailyPipeline] Step 3/5: Scraping Projectory (weekly Monday run)...");
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
      console.log(`[DailyPipeline] Projectory complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      console.error("[DailyPipeline] Projectory scrape failed:", err instanceof Error ? err.message : String(err));
      projectoryResult.totalErrors = 1;
    }
  } else {
    console.log("[DailyPipeline] Skipping Projectory (runs on Mondays only)");
  }

  // Step 4: DMIRS Scrape (weekly — runs on Wednesdays)
  const isWednesday = new Date().getUTCDay() === 3;
  let dmirsResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isWednesday) {
    console.log("[DailyPipeline] Step 4/6: Scraping DMIRS MINEDEX (weekly Wednesday run)...");
    try {
      const scrapeResult = await runDmirsScraper();
      dmirsResult = {
        ran: true,
        totalNewProjects: scrapeResult.totalNewProjects,
        totalDuplicates: scrapeResult.totalDuplicates,
        totalErrors: scrapeResult.totalErrors,
        duration: scrapeResult.duration,
      };
      console.log(`[DailyPipeline] DMIRS complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      console.error("[DailyPipeline] DMIRS scrape failed:", err instanceof Error ? err.message : String(err));
      dmirsResult.totalErrors = 1;
    }
  } else {
    console.log("[DailyPipeline] Skipping DMIRS (runs on Wednesdays only)");
  }

  // Step 5: AEMO Scrape (weekly — runs on Fridays)
  const isFriday = new Date().getUTCDay() === 5;
  let aemoResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalSkipped: 0, totalErrors: 0, duration: 0 };
  if (isFriday) {
    console.log("[DailyPipeline] Step 5/7: Scraping AEMO generation projects (weekly Friday run)...");
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
      console.log(`[DailyPipeline] AEMO complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      console.error("[DailyPipeline] AEMO scrape failed:", err instanceof Error ? err.message : String(err));
      aemoResult.totalErrors = 1;
    }
  } else {
    console.log("[DailyPipeline] Skipping AEMO (runs on Fridays only)");
  }

  // Step 6: Government Major Projects Scrape (weekly — runs on Tuesdays)
  const isTuesday = new Date().getUTCDay() === 2;
  let govResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isTuesday) {
    console.log("[DailyPipeline] Step 6/8: Scraping government major projects (weekly Tuesday run)...");
    try {
      const scrapeResult = await runGovScraper();
      govResult = {
        ran: true,
        totalNewProjects: scrapeResult.totalNewProjects,
        totalDuplicates: scrapeResult.totalDuplicates,
        totalErrors: scrapeResult.totalErrors,
        duration: scrapeResult.duration,
      };
      console.log(`[DailyPipeline] Gov complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      console.error("[DailyPipeline] Gov scrape failed:", err instanceof Error ? err.message : String(err));
      govResult.totalErrors = 1;
    }
  } else {
    console.log("[DailyPipeline] Skipping Gov projects (runs on Tuesdays only)");
  }

  // Step 7: AusTender Scrape (weekly — runs on Thursdays)
  const isThursday = new Date().getUTCDay() === 4;
  let austenderResult = { ran: false, totalFetched: 0, totalRelevant: 0, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isThursday) {
    console.log("[DailyPipeline] Step 7/10: Scraping AusTender contracts (weekly Thursday run)...");
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
      console.log(`[DailyPipeline] AusTender complete: ${scrapeResult.totalNewProjects} new projects from ${scrapeResult.totalRelevant} relevant contracts`);
    } catch (err: unknown) {
      console.error("[DailyPipeline] AusTender scrape failed:", err instanceof Error ? err.message : String(err));
      austenderResult.totalErrors = 1;
    }
  } else {
    console.log("[DailyPipeline] Skipping AusTender (runs on Thursdays only)");
  }

  // Step 8: ICN Gateway Scrape (weekly — runs on Saturdays)
  const isSaturday = new Date().getUTCDay() === 6;
  let icnResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  if (isSaturday) {
    console.log("[DailyPipeline] Step 8/10: Scraping ICN Gateway projects (weekly Saturday run)...");
    try {
      const scrapeResult = await runIcnScraper();
      icnResult = {
        ran: true,
        totalNewProjects: scrapeResult.totalNewProjects,
        totalDuplicates: scrapeResult.totalDuplicates,
        totalErrors: scrapeResult.totalErrors,
        duration: scrapeResult.duration,
      };
      console.log(`[DailyPipeline] ICN complete: ${scrapeResult.totalNewProjects} new projects`);
    } catch (err: unknown) {
      console.error("[DailyPipeline] ICN scrape failed:", err instanceof Error ? err.message : String(err));
      icnResult.totalErrors = 1;
    }
  } else {
    console.log("[DailyPipeline] Skipping ICN Gateway (runs on Saturdays only)");
  }

  // Step 9: Contact Enrichment
  console.log("[DailyPipeline] Step 9/10: Enriching contacts...");
  let enrichmentResult;
  try {
    enrichmentResult = await runEnrichmentPipeline();
    console.log(
      `[DailyPipeline] Enrichment complete: ${enrichmentResult.enriched} contacts enriched`
    );
  } catch (err: unknown) {
    console.error("[DailyPipeline] Enrichment failed:", err instanceof Error ? err.message : String(err));
    enrichmentResult = { processed: 0, enriched: 0, notFound: 0, failed: 0, dailyUsed: 0, results: [] };
  }

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
  };

  // Step 10: Weekly digest notification (Mondays only)
  if (isMonday) {
    console.log("[DailyPipeline] Step 10/10: Sending weekly intelligence digest (Monday run)...");
    try {
      const digestResult = await sendWeeklyDigests();
      console.log(`[DailyPipeline] Weekly digest sent: ${digestResult.sent} sent, ${digestResult.failed} failed, ${digestResult.skipped} skipped`);
    } catch (err: unknown) {
      console.error("[DailyPipeline] Weekly digest failed:", err instanceof Error ? err.message : String(err));
    }
  } else {
    console.log("[DailyPipeline] Skipping weekly digest (runs on Mondays only)");
  }

  // Step 11: Auto-staleness check (runs daily)
  console.log("[DailyPipeline] Step 11: Running project staleness check...");
  try {
    const staleCount = await markStaleProjects();
    if (staleCount > 0) {
      console.log(`[DailyPipeline] Marked ${staleCount} projects as stale (no activity in 30+ days, no pipeline claims)`);
    } else {
      console.log("[DailyPipeline] No new stale projects found");
    }
  } catch (err: unknown) {
    console.error("[DailyPipeline] Staleness check failed:", err instanceof Error ? err.message : String(err));
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
        await runDailyPipeline();
      } catch (err: unknown) {
        console.error("[DailyPipeline] Scheduled run failed:", err instanceof Error ? err.message : String(err));
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}
