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
import { notifyOwner } from "./_core/notification";

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

  // Step 4: Contact Enrichment
  console.log("[DailyPipeline] Step 4/5: Enriching contacts...");
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
    duration,
    completedAt,
  };

  // Notify owner with summary
  try {
    await notifyOwner({
      title: "Daily Pipeline Complete",
      content: [
        `Pipeline completed in ${duration}s at ${completedAt}.`,
        ``,
        `RSS Harvest: ${harvestResult.totalNew} new articles from ${harvestResult.totalSources} sources`,
        `AI Extraction: ${extractionResult.extracted} projects extracted (${extractionResult.creditsUsed} LLM credits used today)`,
        `Contact Enrichment: ${enrichmentResult.enriched} contacts enriched (${enrichmentResult.dailyUsed}/30 daily cap)`,
        projectoryResult.ran ? `Projectory Scrape: ${projectoryResult.totalNewProjects} new projects, ${projectoryResult.totalNewContacts} contacts (${projectoryResult.duration}s)` : `Projectory: Skipped (runs Mondays only)`,
        ``,
        `Errors: ${harvestResult.totalErrors} harvest, ${extractionResult.failed} extraction, ${enrichmentResult.failed} enrichment, ${projectoryResult.totalErrors} projectory`,
      ].join("\n"),
    });
  } catch (err: unknown) {
    console.error("[DailyPipeline] Failed to notify owner:", err instanceof Error ? err.message : String(err));
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
