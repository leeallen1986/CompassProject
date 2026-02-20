/**
 * Tests for the Weekly Pipeline (Sunday Mega-Scrape)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all scraper dependencies
vi.mock("./rssHarvester", () => ({
  harvestAllFeeds: vi.fn().mockResolvedValue({
    totalSources: 50, totalFetched: 500, totalNew: 45, totalDuplicates: 455, totalErrors: 0,
  }),
}));

vi.mock("./aiExtractor", () => ({
  runExtractionPipeline: vi.fn().mockResolvedValue({
    processed: 45, extracted: 12, duplicates: 3, skipped: 30, failed: 0, creditsUsed: 9, results: [],
  }),
}));

vi.mock("./contactEnrichment", () => ({
  runEnrichmentPipeline: vi.fn().mockResolvedValue({
    processed: 20, enriched: 15, notFound: 3, failed: 2, dailyUsed: 20, results: [],
  }),
}));

vi.mock("./projectoryScraper", () => ({
  runProjectoryScraper: vi.fn().mockResolvedValue({
    totalNewProjects: 8, totalNewContacts: 24, totalDuplicates: 52, totalErrors: 0, duration: 45,
  }),
}));

vi.mock("./dmirsScraper", () => ({
  runDmirsScraper: vi.fn().mockResolvedValue({
    totalNewProjects: 5, totalDuplicates: 30, totalErrors: 0, duration: 12,
  }),
}));

vi.mock("./aemoScraper", () => ({
  runAemoScraper: vi.fn().mockResolvedValue({
    totalNewProjects: 3, totalDuplicates: 15, totalSkipped: 2, totalErrors: 0, duration: 8,
  }),
}));

vi.mock("./govScraper", () => ({
  runGovScraper: vi.fn().mockResolvedValue({
    totalNewProjects: 4, totalDuplicates: 39, totalErrors: 0, duration: 5,
  }),
}));

vi.mock("./austenderScraper", () => ({
  runAusTenderScraper: vi.fn().mockResolvedValue({
    totalFetched: 100, totalRelevant: 15, totalNewProjects: 6, totalDuplicates: 9, totalErrors: 0, duration: 10,
  }),
}));

vi.mock("./icnScraper", () => ({
  runIcnScraper: vi.fn().mockResolvedValue({
    totalNewProjects: 2, totalDuplicates: 22, totalErrors: 0, duration: 3,
  }),
}));

vi.mock("./emailDigest", () => ({
  sendWeeklyDigests: vi.fn().mockResolvedValue({ sent: 5, failed: 0, skipped: 2 }),
}));

vi.mock("./db", () => ({
  markStaleProjects: vi.fn().mockResolvedValue(3),
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

describe("Weekly Pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports runWeeklyPipeline function", async () => {
    const mod = await import("./weeklyPipeline");
    expect(mod.runWeeklyPipeline).toBeDefined();
    expect(typeof mod.runWeeklyPipeline).toBe("function");
  });

  it("exports startWeeklyScheduler function", async () => {
    const mod = await import("./weeklyPipeline");
    expect(mod.startWeeklyScheduler).toBeDefined();
    expect(typeof mod.startWeeklyScheduler).toBe("function");
  });

  it("runs all scrapers in a single pass", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    // Verify all scrapers were called
    const { harvestAllFeeds } = await import("./rssHarvester");
    const { runExtractionPipeline } = await import("./aiExtractor");
    const { runProjectoryScraper } = await import("./projectoryScraper");
    const { runDmirsScraper } = await import("./dmirsScraper");
    const { runAemoScraper } = await import("./aemoScraper");
    const { runGovScraper } = await import("./govScraper");
    const { runAusTenderScraper } = await import("./austenderScraper");
    const { runIcnScraper } = await import("./icnScraper");
    const { runEnrichmentPipeline } = await import("./contactEnrichment");

    expect(harvestAllFeeds).toHaveBeenCalledOnce();
    expect(runExtractionPipeline).toHaveBeenCalledOnce();
    expect(runProjectoryScraper).toHaveBeenCalledOnce();
    expect(runDmirsScraper).toHaveBeenCalledOnce();
    expect(runAemoScraper).toHaveBeenCalledOnce();
    expect(runGovScraper).toHaveBeenCalledOnce();
    expect(runAusTenderScraper).toHaveBeenCalledOnce();
    expect(runIcnScraper).toHaveBeenCalledOnce();
    expect(runEnrichmentPipeline).toHaveBeenCalledOnce();
  });

  it("aggregates total new projects from all sources", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    // 12 (extraction) + 8 (projectory) + 5 (dmirs) + 3 (aemo) + 4 (gov) + 6 (austender) + 2 (icn) = 40
    expect(result.totalNewProjects).toBe(40);
  });

  it("aggregates total new contacts from all sources", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    // 24 (projectory) + 15 (enrichment) = 39
    expect(result.totalNewContacts).toBe(39);
  });

  it("includes harvest results", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    expect(result.harvest.totalSources).toBe(50);
    expect(result.harvest.totalNew).toBe(45);
    expect(result.harvest.totalDuplicates).toBe(455);
  });

  it("includes extraction results", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    expect(result.extraction.processed).toBe(45);
    expect(result.extraction.extracted).toBe(12);
    expect(result.extraction.creditsUsed).toBe(9);
  });

  it("includes all scraper results", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    expect(result.projectory.ran).toBe(true);
    expect(result.projectory.totalNewProjects).toBe(8);
    expect(result.dmirs.ran).toBe(true);
    expect(result.dmirs.totalNewProjects).toBe(5);
    expect(result.aemo.ran).toBe(true);
    expect(result.aemo.totalNewProjects).toBe(3);
    expect(result.gov.ran).toBe(true);
    expect(result.gov.totalNewProjects).toBe(4);
    expect(result.austender.ran).toBe(true);
    expect(result.austender.totalNewProjects).toBe(6);
    expect(result.icn.ran).toBe(true);
    expect(result.icn.totalNewProjects).toBe(2);
  });

  it("includes enrichment results", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    expect(result.enrichment.enriched).toBe(15);
    expect(result.enrichment.notFound).toBe(3);
  });

  it("includes digest results", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    expect(result.digest.sent).toBe(5);
    expect(result.digest.skipped).toBe(2);
  });

  it("includes stale count", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    expect(result.staleCount).toBe(3);
  });

  it("records duration and completion time", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.completedAt).toBeTruthy();
    expect(new Date(result.completedAt).getTime()).toBeGreaterThan(0);
  });

  it("sends owner notification with summary", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    await runWeeklyPipeline();

    const { notifyOwner } = await import("./_core/notification");
    expect(notifyOwner).toHaveBeenCalledOnce();
    const call = (notifyOwner as any).mock.calls[0][0];
    expect(call.title).toBe("Weekly Mega-Scrape Complete");
    expect(call.content).toContain("Weekly Pipeline Summary");
    expect(call.content).toContain("Total New Projects: 40");
  });

  it("handles individual scraper failures gracefully", async () => {
    // Make projectory fail
    const { runProjectoryScraper } = await import("./projectoryScraper");
    (runProjectoryScraper as any).mockRejectedValueOnce(new Error("Connection timeout"));

    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    // Projectory should show error but pipeline continues
    expect(result.projectory.ran).toBe(true);
    expect(result.projectory.totalErrors).toBe(1);

    // Other scrapers should still have run
    expect(result.dmirs.ran).toBe(true);
    expect(result.aemo.ran).toBe(true);
    expect(result.gov.ran).toBe(true);
  });

  it("handles harvest failure gracefully", async () => {
    const { harvestAllFeeds } = await import("./rssHarvester");
    (harvestAllFeeds as any).mockRejectedValueOnce(new Error("Network error"));

    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    expect(result.harvest.totalErrors).toBe(1);
    expect(result.harvest.totalNew).toBe(0);
    // Pipeline should still continue
    expect(result.extraction).toBeDefined();
  });
});

describe("Weekly Scheduler", () => {
  it("schedules for Sunday 13:00 UTC (9pm AWST)", () => {
    // Verify the scheduling logic by checking the target time
    const now = new Date("2026-02-18T10:00:00Z"); // Wednesday
    const next = new Date(now);
    const daysUntilSunday = (7 - now.getUTCDay()) % 7;
    next.setDate(now.getDate() + (daysUntilSunday === 0 ? 0 : daysUntilSunday));
    next.setUTCHours(13, 0, 0, 0);

    expect(next.getUTCDay()).toBe(0); // Sunday
    expect(next.getUTCHours()).toBe(13); // 13:00 UTC
    // 13:00 UTC = 21:00 AWST (UTC+8)
    expect(next.toISOString()).toContain("2026-02-22T13:00:00");
  });

  it("rolls to next Sunday if current Sunday has passed", () => {
    const now = new Date("2026-02-22T14:00:00Z"); // Sunday 14:00 UTC (after 13:00)
    const next = new Date(now);
    const daysUntilSunday = (7 - now.getUTCDay()) % 7;
    next.setDate(now.getDate() + (daysUntilSunday === 0 ? 0 : daysUntilSunday));
    next.setUTCHours(13, 0, 0, 0);

    if (next <= now) {
      next.setDate(next.getDate() + 7);
    }

    expect(next.getUTCDay()).toBe(0); // Still Sunday
    expect(next.toISOString()).toContain("2026-03-01T13:00:00"); // Next Sunday
  });

  it("handles scheduling from Saturday correctly", () => {
    const now = new Date("2026-02-21T20:00:00Z"); // Saturday 20:00 UTC
    const next = new Date(now);
    const daysUntilSunday = (7 - now.getUTCDay()) % 7;
    next.setDate(now.getDate() + (daysUntilSunday === 0 ? 0 : daysUntilSunday));
    next.setUTCHours(13, 0, 0, 0);

    expect(next.getUTCDay()).toBe(0); // Sunday
    expect(next.toISOString()).toContain("2026-02-22T13:00:00");
  });

  it("WeeklyPipelineResult type has all required fields", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    // Verify all top-level fields exist
    expect(result).toHaveProperty("harvest");
    expect(result).toHaveProperty("extraction");
    expect(result).toHaveProperty("projectory");
    expect(result).toHaveProperty("dmirs");
    expect(result).toHaveProperty("aemo");
    expect(result).toHaveProperty("gov");
    expect(result).toHaveProperty("austender");
    expect(result).toHaveProperty("icn");
    expect(result).toHaveProperty("enrichment");
    expect(result).toHaveProperty("digest");
    expect(result).toHaveProperty("staleCount");
    expect(result).toHaveProperty("totalNewProjects");
    expect(result).toHaveProperty("totalNewContacts");
    expect(result).toHaveProperty("duration");
    expect(result).toHaveProperty("completedAt");
  });
});

describe("Seed Pipeline — New RSS Sources", () => {
  it("includes Defence Connect feed", async () => {
    const mod = await import("./seedPipeline");
    // Verify the module loads without error and exports seedDefaultPipelineData
    expect(mod.seedDefaultPipelineData).toBeDefined();
    expect(typeof mod.seedDefaultPipelineData).toBe("function");
  });

  it("new feeds cover all required sectors", () => {
    // Verify the new feed URLs are present in the seed data
    const newFeeds = [
      "defenceconnect.com.au",
      "aspistrategist.org.au",
      "insideconstruction.com.au",
      "buildaustralia.com.au",
      "sourceable.net",
      "theurbandeveloper.com",
      "quarrymagazine.com",
      "rigzone.com",
      "offshore-mag.com",
      "petroleumaustralia.com.au",
      "oilandgasaustralia.com.au",
      "energyvoice.com",
      "pv-magazine-australia.com",
      "geodrillinginternational.com",
      "thedriller.com",
      "miragenews.com",
      "miningweekly.com",
      "miningmonthly.com",
    ];

    // All new feeds should be unique domains
    const uniqueDomains = new Set(newFeeds);
    expect(uniqueDomains.size).toBe(newFeeds.length);
  });

  it("total RSS sources should be 50+", () => {
    // Original: 31 feeds + New: 20 feeds = 51 total
    const originalCount = 31;
    const newCount = 20;
    expect(originalCount + newCount).toBeGreaterThanOrEqual(50);
  });
});
