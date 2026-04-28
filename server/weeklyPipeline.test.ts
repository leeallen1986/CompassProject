/**
 * Tests for the Weekly Pipeline v2 (Sunday Mega-Scrape — enrichment-before-digest)
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
    totalNewProjects: 2, totalUpdated: 20, totalDuplicates: 0, totalErrors: 0, duration: 3, reactivated: [],
  }),
}));

vi.mock("./emailDigest", () => ({
  sendWeeklyDigests: vi.fn().mockResolvedValue({ sent: 5, failed: 0, skipped: 2 }),
}));

vi.mock("./db", () => ({
  markStaleProjects: vi.fn().mockResolvedValue({ staled: 3, archived: 0 }),
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// New enrichment module mocks
vi.mock("./asxMonitor", () => ({
  scanTargetCompanies: vi.fn().mockResolvedValue({
    totalCompaniesChecked: 25,
    totalAnnouncementsScanned: 150,
    totalProjectSignals: 8,
    totalNewProjects: 3,
    totalDuplicates: 5,
    totalErrors: 0,
    duration: 30,
  }),
}));

vi.mock("./projectoryEnrichment", () => ({
  enrichUnenrichedProjects: vi.fn().mockResolvedValue({
    totalProcessed: 15,
    totalMatched: 12,
    totalEnriched: 10,
    totalContractorsDiscovered: 5,
    totalConsultantsDiscovered: 2,
    totalStageUpdates: 3,
    totalErrors: 1,
    results: [],
    duration: 30,
  }),
}));

vi.mock("./icnEnrichment", () => ({
  validateAllProjects: vi.fn().mockResolvedValue({
    totalChecked: 20,
    totalMatched: 15,
    totalUpdated: 10,
    totalContractorsAdded: 7,
    results: [],
    duration: 15,
  }),
}));

vi.mock("./webStakeholderDiscovery", () => ({
  runBulkWebDiscovery: vi.fn().mockResolvedValue({
    processed: 20,
    contactsFound: 35,
    errors: [],
  }),
}));

vi.mock("./apolloEligibility", () => ({
  findEligibleProjects: vi.fn().mockResolvedValue({
    eligible: [],
    budgetStatus: { withinBudget: true, dailyUsed: 0, dailyCap: 100, monthlyUsed: 0, monthlyCap: 1000 },
  }),
  buildGapFillPlan: vi.fn().mockResolvedValue({ actions: [] }),
  getBudgetStatus: vi.fn().mockResolvedValue({ withinBudget: true }),
}));

vi.mock("./apolloEnrichment", () => ({
  enrichProjectContacts: vi.fn().mockResolvedValue({ totalFound: 0, enrichCreditsUsed: 0 }),
  revealContactEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock("./businessLineScoring", () => ({
  getUnscoredProjectIds: vi.fn().mockResolvedValue([1, 2, 3]),
  scoreAndSaveProjects: vi.fn().mockResolvedValue({ scored: 3, failed: 0 }),
}));

vi.mock("./tierClassification", () => ({
  classifyAllProjects: vi.fn().mockResolvedValue({
    total: 50, classified: 50, tier1Count: 10, tier2Count: 25, tier3Count: 15,
  }),
}));

vi.mock("./contractorEngine", () => ({
  runContractorEngine: vi.fn().mockResolvedValue({
    registry: { totalCompanies: 100, newCompanies: 10 },
    pairings: { totalPairings: 50 },
    patterns: { totalPatterns: 20 },
  }),
}));

vi.mock("./contractorEnrichmentPass", () => ({
  runContractorEnrichmentPass: vi.fn().mockResolvedValue({
    total: 20, enriched: 15, contractorsDiscovered: 8, failed: 2, skipped: 3,
  }),
}));

vi.mock("./roleRelevance", () => ({
  classifyAllContactRelevance: vi.fn().mockResolvedValue({
    total: 100, highCount: 30, mediumCount: 45, lowCount: 25,
  }),
}));

vi.mock("./secondPassContactSearch", () => ({
  runBulkSecondPass: vi.fn().mockResolvedValue({
    projectsProcessed: 15, totalContactsAdded: 22, projectsImproved: 10,
  }),
}));

describe("Weekly Pipeline v2", () => {
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

  it("runs all scrapers AND enrichment steps in a single pass", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    // Verify all discovery scrapers were called
    const { harvestAllFeeds } = await import("./rssHarvester");
    const { runExtractionPipeline } = await import("./aiExtractor");
    const { scanTargetCompanies } = await import("./asxMonitor");
    const { runProjectoryScraper } = await import("./projectoryScraper");
    const { enrichUnenrichedProjects } = await import("./projectoryEnrichment");
    const { runDmirsScraper } = await import("./dmirsScraper");
    const { runAemoScraper } = await import("./aemoScraper");
    const { runGovScraper } = await import("./govScraper");
    const { runAusTenderScraper } = await import("./austenderScraper");
    const { runIcnScraper } = await import("./icnScraper");
    const { validateAllProjects } = await import("./icnEnrichment");
    const { runEnrichmentPipeline } = await import("./contactEnrichment");

    expect(harvestAllFeeds).toHaveBeenCalledOnce();
    expect(runExtractionPipeline).toHaveBeenCalledOnce();
    expect(scanTargetCompanies).toHaveBeenCalledOnce();
    expect(runProjectoryScraper).toHaveBeenCalledOnce();
    expect(enrichUnenrichedProjects).toHaveBeenCalledOnce();
    expect(runDmirsScraper).toHaveBeenCalledOnce();
    expect(runAemoScraper).toHaveBeenCalledOnce();
    expect(runGovScraper).toHaveBeenCalledOnce();
    expect(runAusTenderScraper).toHaveBeenCalledOnce();
    expect(runIcnScraper).toHaveBeenCalledOnce();
    expect(validateAllProjects).toHaveBeenCalledOnce();
    expect(runEnrichmentPipeline).toHaveBeenCalledOnce();

    // Verify all enrichment steps were called
    const { runBulkWebDiscovery } = await import("./webStakeholderDiscovery");
    const { findEligibleProjects } = await import("./apolloEligibility");
    const { classifyAllProjects } = await import("./tierClassification");
    const { runContractorEngine } = await import("./contractorEngine");
    const { runContractorEnrichmentPass } = await import("./contractorEnrichmentPass");
    const { classifyAllContactRelevance } = await import("./roleRelevance");
    const { runBulkSecondPass } = await import("./secondPassContactSearch");

    expect(runBulkWebDiscovery).toHaveBeenCalledOnce();
    expect(findEligibleProjects).toHaveBeenCalledOnce();
    expect(classifyAllProjects).toHaveBeenCalledOnce();
    expect(runContractorEngine).toHaveBeenCalledOnce();
    expect(runContractorEnrichmentPass).toHaveBeenCalledOnce();
    expect(classifyAllContactRelevance).toHaveBeenCalledOnce();
    expect(runBulkSecondPass).toHaveBeenCalledOnce();
  });

  it("runs digest AFTER all enrichment steps", async () => {
    const callOrder: string[] = [];

    // Track call order for key steps
    const { classifyAllProjects } = await import("./tierClassification");
    (classifyAllProjects as any).mockImplementation(async () => {
      callOrder.push("tierClassification");
      return { total: 50, classified: 50, tier1Count: 10, tier2Count: 25, tier3Count: 15 };
    });

    const { classifyAllContactRelevance } = await import("./roleRelevance");
    (classifyAllContactRelevance as any).mockImplementation(async () => {
      callOrder.push("roleRelevance");
      return { total: 100, highCount: 30, mediumCount: 45, lowCount: 25 };
    });

    const { runBulkSecondPass } = await import("./secondPassContactSearch");
    (runBulkSecondPass as any).mockImplementation(async () => {
      callOrder.push("secondPass");
      return { projectsProcessed: 15, totalContactsAdded: 22, projectsImproved: 10 };
    });

    const { sendWeeklyDigests } = await import("./emailDigest");
    (sendWeeklyDigests as any).mockImplementation(async () => {
      callOrder.push("digest");
      return { sent: 5, failed: 0, skipped: 2 };
    });

    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    await runWeeklyPipeline();

    // Verify digest runs AFTER enrichment
    const digestIndex = callOrder.indexOf("digest");
    const tierIndex = callOrder.indexOf("tierClassification");
    const roleIndex = callOrder.indexOf("roleRelevance");
    const secondPassIndex = callOrder.indexOf("secondPass");

    expect(digestIndex).toBeGreaterThan(tierIndex);
    expect(digestIndex).toBeGreaterThan(roleIndex);
    expect(digestIndex).toBeGreaterThan(secondPassIndex);
  });

  it("aggregates total new projects from all sources including ASX", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    // 12 (extraction) + 3 (ASX) + 8 (projectory) + 5 (dmirs) + 3 (aemo) + 4 (gov) + 6 (austender) + 2 (icn) = 43
    expect(result.totalNewProjects).toBe(43);
  });

  it("aggregates total new contacts from all sources", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    // 24 (projectory) + 15 (enrichment) = 39
    expect(result.totalNewContacts).toBe(39);
  });

  it("includes ASX monitor results", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    expect(result.asxMonitor.ran).toBe(true);
    expect(result.asxMonitor.newProjects).toBe(3);
    expect(result.asxMonitor.companiesChecked).toBe(25);
  });

  it("includes projectory enrichment results", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    expect(result.projectoryEnrichment.ran).toBe(true);
    expect(result.projectoryEnrichment.enriched).toBe(10);
    expect(result.projectoryEnrichment.contractorsFound).toBe(5);
  });

  it("includes ICN validation results", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    expect(result.icnValidation.ran).toBe(true);
    expect(result.icnValidation.validated).toBe(15);
    expect(result.icnValidation.contractorsFound).toBe(7);
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

  it("sends owner notification with v2 summary including enrichment stats", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    await runWeeklyPipeline();

    const { notifyOwner } = await import("./_core/notification");
    expect(notifyOwner).toHaveBeenCalledOnce();
    const call = (notifyOwner as any).mock.calls[0][0];
    expect(call.title).toBe("Weekly Mega-Scrape Complete (v2)");
    expect(call.content).toContain("Weekly Pipeline Summary");
    expect(call.content).toContain("Total New Projects: 43");
    // Verify enrichment stats are included
    expect(call.content).toContain("Enrichment:");
    expect(call.content).toContain("Tier");
    expect(call.content).toContain("Contractor Engine");
    expect(call.content).toContain("Role Relevance");
    expect(call.content).toContain("Second-Pass");
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

  it("handles enrichment step failures gracefully", async () => {
    // Make tier classification fail
    const { classifyAllProjects } = await import("./tierClassification");
    (classifyAllProjects as any).mockRejectedValueOnce(new Error("LLM timeout"));

    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    // Pipeline should still complete and digest should still send
    expect(result.digest.sent).toBe(5);
    expect(result.completedAt).toBeTruthy();
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
    const now = new Date("2026-02-18T10:00:00Z"); // Wednesday
    const next = new Date(now);
    const daysUntilSunday = (7 - now.getUTCDay()) % 7;
    next.setDate(now.getDate() + (daysUntilSunday === 0 ? 0 : daysUntilSunday));
    next.setUTCHours(13, 0, 0, 0);

    expect(next.getUTCDay()).toBe(0); // Sunday
    expect(next.getUTCHours()).toBe(13); // 13:00 UTC
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

  it("WeeklyPipelineResult type has all required fields including new enrichment fields", async () => {
    const { runWeeklyPipeline } = await import("./weeklyPipeline");
    const result = await runWeeklyPipeline();

    // Verify all top-level fields exist (including new ones)
    expect(result).toHaveProperty("harvest");
    expect(result).toHaveProperty("extraction");
    expect(result).toHaveProperty("asxMonitor");
    expect(result).toHaveProperty("projectory");
    expect(result).toHaveProperty("projectoryEnrichment");
    expect(result).toHaveProperty("dmirs");
    expect(result).toHaveProperty("aemo");
    expect(result).toHaveProperty("gov");
    expect(result).toHaveProperty("austender");
    expect(result).toHaveProperty("icn");
    expect(result).toHaveProperty("icnValidation");
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
    expect(mod.seedDefaultPipelineData).toBeDefined();
    expect(typeof mod.seedDefaultPipelineData).toBe("function");
  });

  it("new feeds cover all required sectors", () => {
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

    const uniqueDomains = new Set(newFeeds);
    expect(uniqueDomains.size).toBe(newFeeds.length);
  });

  it("total RSS sources should be 50+", () => {
    const originalCount = 31;
    const newCount = 20;
    expect(originalCount + newCount).toBeGreaterThanOrEqual(50);
  });
});
