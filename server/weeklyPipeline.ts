/**
 * Weekly Pipeline Runner — "Sunday Mega-Scrape"
 *
 * Runs EVERY scraper in a single pass (unlike the daily pipeline which
 * spreads scrapers across different days of the week).
 *
 * Scheduled for Sunday 9pm AWST (13:00 UTC) via in-process scheduler.
 *
 * Pipeline order:
 * 1. RSS Harvest — fetch all configured feeds
 * 2. AI Extraction — extract projects from queued articles (increased cap)
 * 3. Projectory Scraper — crawl all 6 categories
 * 4. DMIRS MINEDEX — WA mining registrations
 * 5. AEMO — energy generation projects
 * 6. Government Major Projects — Infrastructure Australia + NREPL
 * 7. AusTender — federal government contracts
 * 8. ICN Gateway — major project work packages
 * 9. Contact Enrichment — enrich all new contacts
 * 10. Weekly Report Generation — create report row with stats
 * 11. Weekly Digest — send email summaries to subscribed users
 * 12. Staleness Check — mark old projects as stale
 * 13. Notify Owner — summary notification
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
import { markStaleProjects, getDb } from "./db";
import { notifyOwner } from "./_core/notification";
import { projects, contacts, reports } from "../drizzle/schema";
import { sql, eq, gte } from "drizzle-orm";

export interface WeeklyPipelineResult {
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
  enrichment: {
    processed: number;
    enriched: number;
    notFound: number;
    failed: number;
    dailyUsed: number;
  };
  digest: {
    sent: number;
    failed: number;
    skipped: number;
  };
  staleCount: number;
  totalNewProjects: number;
  totalNewContacts: number;
  duration: number;
  completedAt: string;
}

export async function runWeeklyPipeline(): Promise<WeeklyPipelineResult> {
  const startTime = Date.now();
  console.log("[WeeklyPipeline] ═══════════════════════════════════════════════");
  console.log("[WeeklyPipeline] Starting WEEKLY MEGA-SCRAPE (Sunday 9pm AWST)");
  console.log("[WeeklyPipeline] ═══════════════════════════════════════════════");

  let totalNewProjects = 0;
  let totalNewContacts = 0;

  // ── Step 1: RSS Harvest ──
  console.log("[WeeklyPipeline] Step 1/12: Harvesting ALL RSS feeds...");
  let harvestResult;
  try {
    harvestResult = await harvestAllFeeds();
    console.log(
      `[WeeklyPipeline] ✓ Harvest: ${harvestResult.totalNew} new articles from ${harvestResult.totalSources} sources`
    );
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Harvest failed:", err instanceof Error ? err.message : String(err));
    harvestResult = { totalSources: 0, totalFetched: 0, totalNew: 0, totalDuplicates: 0, totalErrors: 1 };
  }

  // ── Step 2: AI Extraction ──
  console.log("[WeeklyPipeline] Step 2/12: Running AI extraction on queued articles...");
  let extractionResult;
  try {
    extractionResult = await runExtractionPipeline();
    totalNewProjects += extractionResult.extracted;
    console.log(
      `[WeeklyPipeline] ✓ Extraction: ${extractionResult.extracted} projects from ${extractionResult.processed} articles`
    );
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Extraction failed:", err instanceof Error ? err.message : String(err));
    extractionResult = { processed: 0, extracted: 0, duplicates: 0, skipped: 0, failed: 0, creditsUsed: 0, results: [] };
  }

  // ── Step 3: Projectory Scraper ──
  console.log("[WeeklyPipeline] Step 3/12: Scraping Projectory (all 6 categories)...");
  let projectoryResult = { ran: false, totalNewProjects: 0, totalNewContacts: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
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
    totalNewProjects += scrapeResult.totalNewProjects;
    totalNewContacts += scrapeResult.totalNewContacts;
    console.log(`[WeeklyPipeline] ✓ Projectory: ${scrapeResult.totalNewProjects} new projects, ${scrapeResult.totalNewContacts} contacts`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Projectory failed:", err instanceof Error ? err.message : String(err));
    projectoryResult.ran = true;
    projectoryResult.totalErrors = 1;
  }

  // ── Step 4: DMIRS MINEDEX ──
  console.log("[WeeklyPipeline] Step 4/12: Scraping DMIRS MINEDEX (WA mining)...");
  let dmirsResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  try {
    const scrapeResult = await runDmirsScraper();
    dmirsResult = {
      ran: true,
      totalNewProjects: scrapeResult.totalNewProjects,
      totalDuplicates: scrapeResult.totalDuplicates,
      totalErrors: scrapeResult.totalErrors,
      duration: scrapeResult.duration,
    };
    totalNewProjects += scrapeResult.totalNewProjects;
    console.log(`[WeeklyPipeline] ✓ DMIRS: ${scrapeResult.totalNewProjects} new projects`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ DMIRS failed:", err instanceof Error ? err.message : String(err));
    dmirsResult.ran = true;
    dmirsResult.totalErrors = 1;
  }

  // ── Step 5: AEMO ──
  console.log("[WeeklyPipeline] Step 5/12: Scraping AEMO generation projects...");
  let aemoResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalSkipped: 0, totalErrors: 0, duration: 0 };
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
    totalNewProjects += scrapeResult.totalNewProjects;
    console.log(`[WeeklyPipeline] ✓ AEMO: ${scrapeResult.totalNewProjects} new projects`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ AEMO failed:", err instanceof Error ? err.message : String(err));
    aemoResult.ran = true;
    aemoResult.totalErrors = 1;
  }

  // ── Step 6: Government Major Projects ──
  console.log("[WeeklyPipeline] Step 6/12: Scraping government major projects...");
  let govResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  try {
    const scrapeResult = await runGovScraper();
    govResult = {
      ran: true,
      totalNewProjects: scrapeResult.totalNewProjects,
      totalDuplicates: scrapeResult.totalDuplicates,
      totalErrors: scrapeResult.totalErrors,
      duration: scrapeResult.duration,
    };
    totalNewProjects += scrapeResult.totalNewProjects;
    console.log(`[WeeklyPipeline] ✓ Gov: ${scrapeResult.totalNewProjects} new projects`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Gov failed:", err instanceof Error ? err.message : String(err));
    govResult.ran = true;
    govResult.totalErrors = 1;
  }

  // ── Step 7: AusTender ──
  console.log("[WeeklyPipeline] Step 7/12: Scraping AusTender contracts...");
  let austenderResult = { ran: false, totalFetched: 0, totalRelevant: 0, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
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
    totalNewProjects += scrapeResult.totalNewProjects;
    console.log(`[WeeklyPipeline] ✓ AusTender: ${scrapeResult.totalNewProjects} new from ${scrapeResult.totalRelevant} relevant`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ AusTender failed:", err instanceof Error ? err.message : String(err));
    austenderResult.ran = true;
    austenderResult.totalErrors = 1;
  }

  // ── Step 8: ICN Gateway ──
  console.log("[WeeklyPipeline] Step 8/12: Scraping ICN Gateway projects...");
  let icnResult = { ran: false, totalNewProjects: 0, totalDuplicates: 0, totalErrors: 0, duration: 0 };
  try {
    const scrapeResult = await runIcnScraper();
    icnResult = {
      ran: true,
      totalNewProjects: scrapeResult.totalNewProjects,
      totalDuplicates: scrapeResult.totalDuplicates,
      totalErrors: scrapeResult.totalErrors,
      duration: scrapeResult.duration,
    };
    totalNewProjects += scrapeResult.totalNewProjects;
    console.log(`[WeeklyPipeline] ✓ ICN: ${scrapeResult.totalNewProjects} new projects`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ ICN failed:", err instanceof Error ? err.message : String(err));
    icnResult.ran = true;
    icnResult.totalErrors = 1;
  }

  // ── Step 9: Contact Enrichment ──
  console.log("[WeeklyPipeline] Step 9/12: Enriching contacts on new projects...");
  let enrichmentResult;
  try {
    enrichmentResult = await runEnrichmentPipeline();
    totalNewContacts += enrichmentResult.enriched;
    console.log(
      `[WeeklyPipeline] ✓ Enrichment: ${enrichmentResult.enriched} contacts enriched`
    );
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Enrichment failed:", err instanceof Error ? err.message : String(err));
    enrichmentResult = { processed: 0, enriched: 0, notFound: 0, failed: 0, dailyUsed: 0, results: [] };
  }

  // ── Step 10: Weekly Digest ──
  console.log("[WeeklyPipeline] Step 10/12: Sending weekly intelligence digest...");
  let digestResult = { sent: 0, failed: 0, skipped: 0 };
  try {
    digestResult = await sendWeeklyDigests();
    console.log(`[WeeklyPipeline] ✓ Digest: ${digestResult.sent} sent, ${digestResult.failed} failed, ${digestResult.skipped} skipped`);
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Digest failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Step 11: Staleness Check ──
  console.log("[WeeklyPipeline] Step 11/12: Running project staleness check...");
  let staleCount = 0;
  try {
    staleCount = await markStaleProjects();
    if (staleCount > 0) {
      console.log(`[WeeklyPipeline] ✓ Marked ${staleCount} projects as stale`);
    } else {
      console.log("[WeeklyPipeline] ✓ No new stale projects found");
    }
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Staleness check failed:", err instanceof Error ? err.message : String(err));
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  const completedAt = new Date().toISOString();

  // ── Step 12: Notify Owner ──
  console.log("[WeeklyPipeline] Step 12/12: Sending owner notification...");
  try {
    const totalProjectsDb = await getTotalProjectCount();
    const totalContactsDb = await getTotalContactCount();

    await notifyOwner({
      title: "Weekly Mega-Scrape Complete",
      content: [
        `**Weekly Pipeline Summary — ${new Date().toLocaleDateString("en-AU", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}**`,
        "",
        `Duration: ${Math.floor(duration / 60)}m ${duration % 60}s`,
        "",
        "**New This Week:**",
        `- RSS Articles: ${harvestResult.totalNew} new`,
        `- AI Extracted: ${extractionResult.extracted} projects`,
        `- Projectory: ${projectoryResult.totalNewProjects} projects`,
        `- DMIRS: ${dmirsResult.totalNewProjects} projects`,
        `- AEMO: ${aemoResult.totalNewProjects} projects`,
        `- Gov: ${govResult.totalNewProjects} projects`,
        `- AusTender: ${austenderResult.totalNewProjects} projects`,
        `- ICN: ${icnResult.totalNewProjects} projects`,
        `- Contacts Enriched: ${enrichmentResult.enriched}`,
        "",
        `**Total New Projects: ${totalNewProjects}**`,
        `**Total New Contacts: ${totalNewContacts}**`,
        "",
        `**Database Totals:**`,
        `- Projects: ${totalProjectsDb}`,
        `- Contacts: ${totalContactsDb}`,
        "",
        `Digest: ${digestResult.sent} sent | Stale: ${staleCount} marked`,
      ].join("\n"),
    });
    console.log("[WeeklyPipeline] ✓ Owner notification sent");
  } catch (err: unknown) {
    console.error("[WeeklyPipeline] ✗ Owner notification failed:", err instanceof Error ? err.message : String(err));
  }

  const result: WeeklyPipelineResult = {
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
    projectory: projectoryResult,
    dmirs: dmirsResult,
    aemo: aemoResult,
    gov: govResult,
    austender: austenderResult,
    icn: icnResult,
    enrichment: {
      processed: enrichmentResult.processed,
      enriched: enrichmentResult.enriched,
      notFound: enrichmentResult.notFound,
      failed: enrichmentResult.failed,
      dailyUsed: enrichmentResult.dailyUsed,
    },
    digest: digestResult,
    staleCount,
    totalNewProjects,
    totalNewContacts,
    duration,
    completedAt,
  };

  console.log("[WeeklyPipeline] ═══════════════════════════════════════════════");
  console.log(`[WeeklyPipeline] COMPLETE: ${totalNewProjects} new projects, ${totalNewContacts} new contacts in ${Math.floor(duration / 60)}m ${duration % 60}s`);
  console.log("[WeeklyPipeline] ═══════════════════════════════════════════════");

  return result;
}

// ── Helper: Get total project count ──
async function getTotalProjectCount(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(projects);
    return Number(row.count);
  } catch {
    return 0;
  }
}

// ── Helper: Get total contact count ──
async function getTotalContactCount(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(contacts);
    return Number(row.count);
  } catch {
    return 0;
  }
}

// ── In-process scheduler ──
// Runs every Sunday at 13:00 UTC (21:00 AWST / 9pm Perth Time)

let weeklySchedulerStarted = false;

export function startWeeklyScheduler(): void {
  if (weeklySchedulerStarted) return;
  weeklySchedulerStarted = true;

  function scheduleNextSunday(): void {
    const now = new Date();
    const next = new Date(now);

    // Find next Sunday
    const daysUntilSunday = (7 - now.getUTCDay()) % 7;
    next.setDate(now.getDate() + (daysUntilSunday === 0 ? 0 : daysUntilSunday));
    next.setUTCHours(13, 0, 0, 0); // 13:00 UTC = 21:00 AWST

    // If we've already passed Sunday 13:00 UTC this week, schedule for next Sunday
    if (next <= now) {
      next.setDate(next.getDate() + 7);
    }

    const delay = next.getTime() - now.getTime();
    const hoursUntil = Math.round(delay / 3600000 * 10) / 10;
    console.log(`[WeeklyPipeline] Next Sunday mega-scrape scheduled in ${hoursUntil}h at ${next.toISOString()} (9pm AWST)`);

    setTimeout(async () => {
      try {
        console.log("[WeeklyPipeline] Timer fired — starting weekly mega-scrape...");
        await runWeeklyPipeline();
      } catch (err: unknown) {
        console.error("[WeeklyPipeline] Scheduled run failed:", err instanceof Error ? err.message : String(err));
      }
      scheduleNextSunday();
    }, delay);
  }

  scheduleNextSunday();
}
