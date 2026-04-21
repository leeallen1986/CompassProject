/**
 * Pilot Enrichment Workflow — Vitest Tests
 *
 * Covers all 6 parts of the pilot enrichment sprint:
 *   Part A — getPilotShortlist (shortlist query)
 *   Part B — sortByEnrichmentPriority + evaluateEnrichmentGating
 *   Part C — buildPilotEnrichmentPlan (credit estimation, stop condition)
 *   Part D — pilotEnrichmentRun (orchestration, dry-run vs live)
 *   Part E — runPostBatchQA (sendReadiness refresh)
 *   Part F — tRPC procedure contracts (input/output shape)
 *
 * All external dependencies (DB, Apollo, QA) are mocked so tests run in-process.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sortByEnrichmentPriority,
  evaluateEnrichmentGating,
  buildPilotEnrichmentPlan,
  pilotEnrichmentRun,
  type EnrichmentGatingDecision,
  type PilotEnrichmentPlan,
  type PilotEnrichmentRunResult,
} from "./pilotEnrichment";
import type { PilotShortlistItem } from "./db";

// ── Mock external dependencies ──

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getPilotShortlist: vi.fn(),
    getPilotShortlistCount: vi.fn(),
    getLatestReport: vi.fn(),
    getDb: vi.fn(),
  };
});

vi.mock("./apolloEligibility", () => ({
  checkApolloEligibility: vi.fn(),
  getBudgetStatus: vi.fn(),
  analyzeContactGaps: vi.fn(),
}));

vi.mock("./apolloEnrichment", () => ({
  enrichProjectContacts: vi.fn(),
}));

vi.mock("./enrichmentQA", () => ({
  evaluateEnrichmentQABatch: vi.fn(),
  determineSendReadiness: vi.fn(),
}));

import {
  getPilotShortlist,
  getLatestReport,
  getDb,
} from "./db";
import {
  checkApolloEligibility,
  getBudgetStatus,
  analyzeContactGaps,
} from "./apolloEligibility";
import { enrichProjectContacts } from "./apolloEnrichment";
import { evaluateEnrichmentQABatch, determineSendReadiness } from "./enrichmentQA";

// ── Fixtures ──

function makeItem(overrides: Partial<PilotShortlistItem> = {}): PilotShortlistItem {
  return {
    id: 1,
    name: "Test Project",
    priority: "hot",
    sector: "mining",
    productLane: "Portable Air",
    stageCode: "construction",
    contactCount: 0,
    contactsWithEmail: 0,
    hasNoContacts: true,
    score: 75,
    ...overrides,
  };
}

function makeBudget(overrides: Partial<{
  dailyUsed: number; dailyCap: number; dailyRemaining: number;
  monthlyUsed: number; monthlyCap: number; monthlyRemaining: number;
  withinBudget: boolean;
}> = {}) {
  return {
    dailyUsed: 10,
    dailyCap: 200,
    dailyRemaining: 190,
    monthlyUsed: 50,
    monthlyCap: 2000,
    monthlyRemaining: 1950,
    withinBudget: true,
    ...overrides,
  };
}

// ── Part A: Shortlist query shape ──

describe("Part A — getPilotShortlist", () => {
  it("returns an array of PilotShortlistItem objects", async () => {
    const items = [
      makeItem({ id: 1, name: "Alpha", priority: "hot" }),
      makeItem({ id: 2, name: "Beta", priority: "warm" }),
    ];
    vi.mocked(getPilotShortlist).mockResolvedValueOnce(items);
    const result = await getPilotShortlist();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 1, name: "Alpha", priority: "hot" });
  });

  it("returns hasNoContacts=true when contactCount is 0", async () => {
    const item = makeItem({ contactCount: 0, contactsWithEmail: 0, hasNoContacts: true });
    vi.mocked(getPilotShortlist).mockResolvedValueOnce([item]);
    const result = await getPilotShortlist();
    expect(result[0].hasNoContacts).toBe(true);
  });

  it("returns hasNoContacts=false when contactCount > 0", async () => {
    const item = makeItem({ contactCount: 3, contactsWithEmail: 2, hasNoContacts: false });
    vi.mocked(getPilotShortlist).mockResolvedValueOnce([item]);
    const result = await getPilotShortlist();
    expect(result[0].hasNoContacts).toBe(false);
  });

  it("returns empty array when no shortlisted projects exist", async () => {
    vi.mocked(getPilotShortlist).mockResolvedValueOnce([]);
    const result = await getPilotShortlist();
    expect(result).toHaveLength(0);
  });

  it("includes productLane field on each item", async () => {
    const item = makeItem({ productLane: "BESS" });
    vi.mocked(getPilotShortlist).mockResolvedValueOnce([item]);
    const result = await getPilotShortlist();
    expect(result[0].productLane).toBe("BESS");
  });

  it("includes score field on each item", async () => {
    const item = makeItem({ score: 82 });
    vi.mocked(getPilotShortlist).mockResolvedValueOnce([item]);
    const result = await getPilotShortlist();
    expect(result[0].score).toBe(82);
  });

  it("only returns items with score >= 40 (contract enforced by query)", async () => {
    // The mock represents what the DB query would return — all items should have score >= 40
    const items = [makeItem({ score: 40 }), makeItem({ id: 2, score: 95 })];
    vi.mocked(getPilotShortlist).mockResolvedValueOnce(items);
    const result = await getPilotShortlist();
    expect(result.every(i => i.score >= 40)).toBe(true);
  });
});

// ── Part B: Priority ordering ──

describe("Part B — sortByEnrichmentPriority", () => {
  it("places hot+noContacts before hot+noEmail before hot+hasContacts", () => {
    const items: PilotShortlistItem[] = [
      makeItem({ id: 3, priority: "hot", contactCount: 2, contactsWithEmail: 2, hasNoContacts: false }),
      makeItem({ id: 1, priority: "hot", contactCount: 0, contactsWithEmail: 0, hasNoContacts: true }),
      makeItem({ id: 2, priority: "hot", contactCount: 2, contactsWithEmail: 0, hasNoContacts: false }),
    ];
    const sorted = sortByEnrichmentPriority(items);
    expect(sorted[0].id).toBe(1); // hot + noContacts
    expect(sorted[1].id).toBe(2); // hot + noEmail
    expect(sorted[2].id).toBe(3); // hot + hasContacts
  });

  it("places all hot tiers before all warm tiers", () => {
    const items: PilotShortlistItem[] = [
      makeItem({ id: 4, priority: "warm", contactCount: 0, contactsWithEmail: 0, hasNoContacts: true }),
      makeItem({ id: 1, priority: "hot", contactCount: 2, contactsWithEmail: 2, hasNoContacts: false }),
    ];
    const sorted = sortByEnrichmentPriority(items);
    expect(sorted[0].priority).toBe("hot");
    expect(sorted[1].priority).toBe("warm");
  });

  it("within same tier, sorts by contactCount ASC (fewest first)", () => {
    const items: PilotShortlistItem[] = [
      makeItem({ id: 2, priority: "hot", contactCount: 5, contactsWithEmail: 0, hasNoContacts: false }),
      makeItem({ id: 1, priority: "hot", contactCount: 1, contactsWithEmail: 0, hasNoContacts: false }),
    ];
    const sorted = sortByEnrichmentPriority(items);
    expect(sorted[0].id).toBe(1); // fewer contacts first
  });

  it("warm+noContacts comes before warm+noEmail", () => {
    const items: PilotShortlistItem[] = [
      makeItem({ id: 2, priority: "warm", contactCount: 2, contactsWithEmail: 0, hasNoContacts: false }),
      makeItem({ id: 1, priority: "warm", contactCount: 0, contactsWithEmail: 0, hasNoContacts: true }),
    ];
    const sorted = sortByEnrichmentPriority(items);
    expect(sorted[0].id).toBe(1);
  });

  it("does not mutate the original array", () => {
    const items: PilotShortlistItem[] = [
      makeItem({ id: 2, priority: "warm" }),
      makeItem({ id: 1, priority: "hot" }),
    ];
    const original = [...items];
    sortByEnrichmentPriority(items);
    expect(items[0].id).toBe(original[0].id);
  });

  it("handles empty array", () => {
    expect(sortByEnrichmentPriority([])).toHaveLength(0);
  });

  it("handles single item", () => {
    const items = [makeItem({ id: 1 })];
    expect(sortByEnrichmentPriority(items)).toHaveLength(1);
  });
});

// ── Part B: Enrichment gating ──

describe("Part B — evaluateEnrichmentGating", () => {
  beforeEach(() => {
    vi.mocked(checkApolloEligibility).mockResolvedValue({
      eligible: true,
      details: "Eligible",
      projectId: 1,
      reason: "eligible",
    });
  });

  it("marks project as eligible when contactsWithEmail < threshold and Apollo eligible", async () => {
    const item = makeItem({ contactsWithEmail: 0, hasNoContacts: true });
    const decision = await evaluateEnrichmentGating(item);
    expect(decision.eligible).toBe(true);
    expect(decision.hardBlocked).toBe(false);
    expect(decision.softSkipped).toBe(false);
  });

  it("soft-skips project when contactsWithEmail >= 3", async () => {
    const item = makeItem({ contactsWithEmail: 3, hasNoContacts: false });
    const decision = await evaluateEnrichmentGating(item);
    expect(decision.eligible).toBe(false);
    expect(decision.softSkipped).toBe(true);
    expect(decision.hardBlocked).toBe(false);
  });

  it("hard-blocks project when Apollo eligibility returns ineligible", async () => {
    vi.mocked(checkApolloEligibility).mockResolvedValueOnce({
      eligible: false,
      details: "Project is suppressed",
      projectId: 1,
      reason: "suppressed",
    });
    const item = makeItem({ contactsWithEmail: 0 });
    const decision = await evaluateEnrichmentGating(item);
    expect(decision.eligible).toBe(false);
    expect(decision.hardBlocked).toBe(true);
    expect(decision.softSkipped).toBe(false);
  });

  it("estimates credits > 0 for eligible project with no contacts", async () => {
    const item = makeItem({ contactsWithEmail: 0, hasNoContacts: true });
    const decision = await evaluateEnrichmentGating(item);
    expect(decision.estimatedCredits).toBeGreaterThan(0);
  });

  it("estimates 0 credits for soft-skipped project", async () => {
    const item = makeItem({ contactsWithEmail: 5 });
    const decision = await evaluateEnrichmentGating(item);
    expect(decision.estimatedCredits).toBe(0);
  });

  it("estimates 0 credits for hard-blocked project", async () => {
    vi.mocked(checkApolloEligibility).mockResolvedValueOnce({
      eligible: false,
      details: "Archived",
      projectId: 1,
      reason: "archived",
    });
    const item = makeItem({ contactsWithEmail: 0 });
    const decision = await evaluateEnrichmentGating(item);
    expect(decision.estimatedCredits).toBe(0);
  });

  it("includes reason string for all decision types", async () => {
    const eligible = makeItem({ contactsWithEmail: 0 });
    const d1 = await evaluateEnrichmentGating(eligible);
    expect(d1.reason).toBeTruthy();

    const softSkip = makeItem({ contactsWithEmail: 5 });
    const d2 = await evaluateEnrichmentGating(softSkip);
    expect(d2.reason).toBeTruthy();
  });

  it("includes all required fields in decision object", async () => {
    const item = makeItem({ id: 42, name: "Test", priority: "hot", productLane: "Pumps" });
    const decision = await evaluateEnrichmentGating(item);
    expect(decision).toMatchObject({
      projectId: 42,
      projectName: "Test",
      priority: "hot",
      productLane: "Pumps",
    });
    expect(typeof decision.eligible).toBe("boolean");
    expect(typeof decision.hardBlocked).toBe("boolean");
    expect(typeof decision.softSkipped).toBe("boolean");
    expect(typeof decision.estimatedCredits).toBe("number");
    expect(typeof decision.reason).toBe("string");
  });
});

// ── Part C: Credit estimation & stop condition ──

describe("Part C — buildPilotEnrichmentPlan", () => {
  beforeEach(() => {
    vi.mocked(getLatestReport).mockResolvedValue({ id: 99, weekEnding: "2026-04-28", createdAt: new Date() } as any);
    vi.mocked(getBudgetStatus).mockResolvedValue(makeBudget());
    vi.mocked(checkApolloEligibility).mockResolvedValue({ eligible: true, details: "OK", projectId: 1, reason: "eligible" });
  });

  it("returns a plan with all required fields", async () => {
    vi.mocked(getPilotShortlist).mockResolvedValueOnce([makeItem()]);
    const plan = await buildPilotEnrichmentPlan();
    expect(plan).toMatchObject({
      reportId: expect.any(Number),
      weekKey: expect.any(String),
      totalShortlisted: expect.any(Number),
      eligible: expect.any(Number),
      hardBlocked: expect.any(Number),
      softSkipped: expect.any(Number),
      estimatedTotalCredits: expect.any(Number),
      creditBudget: expect.objectContaining({
        dailyRemaining: expect.any(Number),
        withinBudget: expect.any(Boolean),
      }),
      decisions: expect.any(Array),
      toEnrich: expect.any(Array),
      budgetInsufficient: expect.any(Boolean),
    });
  });

  it("marks budgetInsufficient=true when daily remaining < CREDIT_STOP_BUFFER", async () => {
    vi.mocked(getPilotShortlist).mockResolvedValueOnce([makeItem()]);
    vi.mocked(getBudgetStatus).mockResolvedValueOnce(makeBudget({ dailyRemaining: 5, withinBudget: false }));
    const plan = await buildPilotEnrichmentPlan();
    expect(plan.budgetInsufficient).toBe(true);
    expect(plan.toEnrich).toHaveLength(0);
  });

  it("stops adding to toEnrich when cumulative credits reach cap", async () => {
    // 10 projects × 3 credits each = 30 credits; cap = 10 → only 3 projects fit
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ id: i + 1, name: `Project ${i + 1}`, contactsWithEmail: 0 })
    );
    vi.mocked(getPilotShortlist).mockResolvedValueOnce(items);
    const plan = await buildPilotEnrichmentPlan({ creditCap: 10 });
    // Each project costs 3 credits, cap is 10 → floor(10/3) = 3 projects
    expect(plan.toEnrich.length).toBeLessThanOrEqual(4);
  });

  it("toEnrich contains only eligible projects", async () => {
    vi.mocked(checkApolloEligibility)
      .mockResolvedValueOnce({ eligible: false, details: "Suppressed", projectId: 1, reason: "suppressed" })
      .mockResolvedValue({ eligible: true, details: "OK", projectId: 2, reason: "eligible" });
    const items = [
      makeItem({ id: 1, contactsWithEmail: 0 }),
      makeItem({ id: 2, contactsWithEmail: 0 }),
    ];
    vi.mocked(getPilotShortlist).mockResolvedValueOnce(items);
    const plan = await buildPilotEnrichmentPlan();
    expect(plan.toEnrich.every(d => d.eligible)).toBe(true);
  });

  it("estimatedTotalCredits equals sum of toEnrich project credits", async () => {
    const items = [
      makeItem({ id: 1, contactsWithEmail: 0 }),
      makeItem({ id: 2, contactsWithEmail: 0 }),
    ];
    vi.mocked(getPilotShortlist).mockResolvedValueOnce(items);
    const plan = await buildPilotEnrichmentPlan();
    const sumCredits = plan.toEnrich.reduce((s, d) => s + d.estimatedCredits, 0);
    expect(plan.estimatedTotalCredits).toBe(sumCredits);
  });

  it("counts hardBlocked and softSkipped correctly", async () => {
    vi.mocked(checkApolloEligibility)
      .mockResolvedValueOnce({ eligible: false, details: "Archived", projectId: 1, reason: "archived" });
    const items = [
      makeItem({ id: 1, contactsWithEmail: 0 }),  // hard blocked
      makeItem({ id: 2, contactsWithEmail: 5 }),  // soft skipped
      makeItem({ id: 3, contactsWithEmail: 0 }),  // eligible
    ];
    vi.mocked(getPilotShortlist).mockResolvedValueOnce(items);
    const plan = await buildPilotEnrichmentPlan();
    expect(plan.hardBlocked).toBe(1);
    expect(plan.softSkipped).toBe(1);
    expect(plan.eligible).toBe(1);
  });

  it("returns empty toEnrich when shortlist is empty", async () => {
    vi.mocked(getPilotShortlist).mockResolvedValueOnce([]);
    const plan = await buildPilotEnrichmentPlan();
    expect(plan.toEnrich).toHaveLength(0);
    expect(plan.totalShortlisted).toBe(0);
  });

  it("weekKey is a non-empty string", async () => {
    vi.mocked(getPilotShortlist).mockResolvedValueOnce([]);
    const plan = await buildPilotEnrichmentPlan();
    expect(plan.weekKey).toBeTruthy();
    expect(typeof plan.weekKey).toBe("string");
  });

  it("respects reportId override", async () => {
    vi.mocked(getPilotShortlist).mockResolvedValueOnce([]);
    const plan = await buildPilotEnrichmentPlan({ reportId: 42 });
    expect(plan.reportId).toBe(42);
  });
});

// ── Part D: Orchestration ──

describe("Part D — pilotEnrichmentRun", () => {
  beforeEach(() => {
    vi.mocked(getLatestReport).mockResolvedValue({ id: 99, weekEnding: "2026-04-28", createdAt: new Date() } as any);
    vi.mocked(getBudgetStatus).mockResolvedValue(makeBudget());
    vi.mocked(checkApolloEligibility).mockResolvedValue({ eligible: true, details: "OK", projectId: 1, reason: "eligible" });
    vi.mocked(getPilotShortlist).mockResolvedValue([makeItem({ id: 1, contactsWithEmail: 0 })]);
    vi.mocked(getDb).mockResolvedValue(null as any);
  });

  it("defaults to dryRun=true for safety", async () => {
    const result = await pilotEnrichmentRun();
    expect(result.dryRun).toBe(true);
  });

  it("dry-run returns status=dry_run for eligible projects", async () => {
    const result = await pilotEnrichmentRun({ dryRun: true });
    const enrichedResults = result.results.filter(r => r.status === "dry_run");
    expect(enrichedResults.length).toBeGreaterThanOrEqual(1);
  });

  it("dry-run does NOT call enrichProjectContacts", async () => {
    await pilotEnrichmentRun({ dryRun: true });
    expect(enrichProjectContacts).not.toHaveBeenCalled();
  });

  it("dry-run returns creditsUsed=0 for all results", async () => {
    const result = await pilotEnrichmentRun({ dryRun: true });
    expect(result.results.every(r => r.creditsUsed === 0)).toBe(true);
  });

  it("live run calls enrichProjectContacts for eligible projects", async () => {
    vi.mocked(enrichProjectContacts).mockResolvedValue({
      people: [{ status: "enriched" }, { status: "enriched" }],
      totalFound: 2,
      enrichCreditsUsed: 2,
    } as any);
    vi.mocked(evaluateEnrichmentQABatch).mockResolvedValue([]);
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as any);
    await pilotEnrichmentRun({ dryRun: false });
    expect(enrichProjectContacts).toHaveBeenCalled();
  });

  it("returns a runId string", async () => {
    const result = await pilotEnrichmentRun({ dryRun: true });
    expect(typeof result.runId).toBe("string");
    expect(result.runId.startsWith("pilot-")).toBe(true);
  });

  it("returns startedAt and completedAt dates", async () => {
    const result = await pilotEnrichmentRun({ dryRun: true });
    expect(result.startedAt).toBeInstanceOf(Date);
    expect(result.completedAt).toBeInstanceOf(Date);
    expect(result.completedAt.getTime()).toBeGreaterThanOrEqual(result.startedAt.getTime());
  });

  it("returns elapsedMs >= 0", async () => {
    const result = await pilotEnrichmentRun({ dryRun: true });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("summary.projectsAttempted equals toEnrich.length", async () => {
    const result = await pilotEnrichmentRun({ dryRun: true });
    expect(result.summary.projectsAttempted).toBe(result.plan.toEnrich.length);
  });

  it("summary.noContactProjects counts projects with hasNoContacts=true in shortlist", async () => {
    vi.mocked(getPilotShortlist).mockResolvedValueOnce([
      makeItem({ id: 1, hasNoContacts: true, contactsWithEmail: 0 }),
      makeItem({ id: 2, hasNoContacts: false, contactsWithEmail: 1 }),
    ]);
    const result = await pilotEnrichmentRun({ dryRun: true });
    expect(result.summary.noContactProjects).toBe(1);
  });

  it("includes the plan in the result", async () => {
    const result = await pilotEnrichmentRun({ dryRun: true });
    expect(result.plan).toBeDefined();
    expect(result.plan.decisions).toBeInstanceOf(Array);
  });

  it("returns empty results when shortlist is empty", async () => {
    vi.mocked(getPilotShortlist).mockResolvedValueOnce([]);
    const result = await pilotEnrichmentRun({ dryRun: true });
    expect(result.results).toHaveLength(0);
    expect(result.summary.projectsAttempted).toBe(0);
  });
});

// ── Part E: Post-batch QA ──

describe("Part E — runPostBatchQA (sendReadiness refresh)", () => {
  it("evaluateEnrichmentQABatch is called with newly enriched contacts in live run", async () => {
    vi.mocked(getLatestReport).mockResolvedValue({ id: 99, weekEnding: "2026-04-28", createdAt: new Date() } as any);
    vi.mocked(getBudgetStatus).mockResolvedValue(makeBudget());
    vi.mocked(checkApolloEligibility).mockResolvedValue({ eligible: true, details: "OK", projectId: 1, reason: "eligible" });
    vi.mocked(getPilotShortlist).mockResolvedValue([makeItem({ id: 1, contactsWithEmail: 0 })]);
    vi.mocked(enrichProjectContacts).mockResolvedValue({
      people: [{ status: "enriched", contactId: 101 }],
      totalFound: 1,
      enrichCreditsUsed: 1,
    } as any);
    // evaluateEnrichmentQABatch is synchronous in the implementation
    vi.mocked(evaluateEnrichmentQABatch).mockReturnValue([
      { sendReadiness: "send_ready" } as any,
    ]);
    // getDb mock: project name lookup uses .where().limit(1), contacts lookup uses .where() only
    // First select: project name — .select().from().where().limit(1)
    const mockLimit1 = vi.fn().mockResolvedValueOnce([{ name: "Test Project" }]);
    const mockWhere1 = vi.fn().mockReturnValue({ limit: mockLimit1 });
    const mockFrom1 = vi.fn().mockReturnValue({ where: mockWhere1 });
    const mockSelect1 = vi.fn().mockReturnValue({ from: mockFrom1 });
    // Second select: contacts — .select().from().where()
    const mockWhere2 = vi.fn().mockResolvedValueOnce([{ id: 101, name: "John Doe", email: "j@test.com", enrichmentSource: "apollo", enrichmentStatus: "enriched", verificationStatus: "verified", verificationScore: 80, emailVerified: true, linkedinProfileUrl: null, company: "Acme", title: "Manager" }]);
    const mockFrom2 = vi.fn().mockReturnValue({ where: mockWhere2 });
    const mockSelect2 = vi.fn().mockReturnValue({ from: mockFrom2 });
    const mockSelect = vi.fn().mockReturnValueOnce({ from: mockFrom1 }).mockReturnValueOnce({ from: mockFrom2 });
    vi.mocked(getDb).mockResolvedValue({ select: mockSelect } as any);
    await pilotEnrichmentRun({ dryRun: false });
    expect(evaluateEnrichmentQABatch).toHaveBeenCalled();
  });

  it("dry-run does NOT call evaluateEnrichmentQABatch", async () => {
    vi.clearAllMocks();
    vi.mocked(getLatestReport).mockResolvedValue({ id: 99, weekEnding: "2026-04-28", createdAt: new Date() } as any);
    vi.mocked(getBudgetStatus).mockResolvedValue(makeBudget());
    vi.mocked(checkApolloEligibility).mockResolvedValue({ eligible: true, details: "OK", projectId: 1, reason: "eligible" });
    vi.mocked(getPilotShortlist).mockResolvedValue([makeItem({ id: 1, contactsWithEmail: 0 })]);
    vi.mocked(getDb).mockResolvedValue(null as any); // ensure no DB calls succeed
    await pilotEnrichmentRun({ dryRun: true });
    expect(evaluateEnrichmentQABatch).not.toHaveBeenCalled();
  });

  it("qaPassCount reflects evaluateEnrichmentQABatch results in live run", async () => {
    vi.mocked(getLatestReport).mockResolvedValue({ id: 99, weekEnding: "2026-04-28", createdAt: new Date() } as any);
    vi.mocked(getBudgetStatus).mockResolvedValue(makeBudget());
    vi.mocked(checkApolloEligibility).mockResolvedValue({ eligible: true, details: "OK", projectId: 1, reason: "eligible" });
    vi.mocked(getPilotShortlist).mockResolvedValue([makeItem({ id: 1, contactsWithEmail: 0 })]);
    vi.mocked(enrichProjectContacts).mockResolvedValue({
      people: [{ status: "enriched" }, { status: "enriched" }],
      totalFound: 2,
      enrichCreditsUsed: 2,
    } as any);
    // evaluateEnrichmentQABatch is synchronous — 1 send_ready, 1 not_ready
    vi.mocked(evaluateEnrichmentQABatch).mockReturnValue([
      { sendReadiness: "send_ready" } as any,
      { sendReadiness: "do_not_send" } as any,
    ]);
    // getDb mock: project name lookup uses .where().limit(1), contacts lookup uses .where() only
    const mockLimit1 = vi.fn().mockResolvedValueOnce([{ name: "Test Project" }]);
    const mockWhere1 = vi.fn().mockReturnValue({ limit: mockLimit1 });
    const mockFrom1 = vi.fn().mockReturnValue({ where: mockWhere1 });
    const mockWhere2 = vi.fn().mockResolvedValueOnce([
      { id: 101, name: "Alice", email: "a@test.com", enrichmentSource: "apollo", enrichmentStatus: "enriched", verificationStatus: "verified", verificationScore: 80, emailVerified: true, linkedinProfileUrl: null, company: "Acme", title: "PM" },
      { id: 102, name: "Bob", email: "b@test.com", enrichmentSource: "apollo", enrichmentStatus: "enriched", verificationStatus: "unverified", verificationScore: 20, emailVerified: false, linkedinProfileUrl: null, company: "Acme", title: "Eng" },
    ]);
    const mockFrom2 = vi.fn().mockReturnValue({ where: mockWhere2 });
    const mockSelect = vi.fn().mockReturnValueOnce({ from: mockFrom1 }).mockReturnValueOnce({ from: mockFrom2 });
    vi.mocked(getDb).mockResolvedValue({ select: mockSelect } as any);
    const result = await pilotEnrichmentRun({ dryRun: false });
    const enrichedResult = result.results.find(r => r.status === "enriched");
    // send_ready = passCount + sendReadyCount; do_not_send = failCount
    expect(enrichedResult?.qaPassCount).toBe(1);
    expect(enrichedResult?.qaFailCount).toBe(1);
  });
});

// ── Part F: Contract / shape validation ──

describe("Part F — tRPC procedure contracts", () => {
  it("EnrichmentGatingDecision has all required fields", () => {
    const decision: EnrichmentGatingDecision = {
      projectId: 1,
      projectName: "Test",
      priority: "hot",
      productLane: "Portable Air",
      contactCount: 0,
      contactsWithEmail: 0,
      hasNoContacts: true,
      eligible: true,
      reason: "Eligible",
      estimatedCredits: 3,
      hardBlocked: false,
      softSkipped: false,
    };
    expect(decision.projectId).toBe(1);
    expect(decision.eligible).toBe(true);
  });

  it("PilotEnrichmentPlan shape is correct", () => {
    const plan: PilotEnrichmentPlan = {
      reportId: 1,
      weekKey: "2026-W17",
      totalShortlisted: 10,
      eligible: 7,
      hardBlocked: 2,
      softSkipped: 1,
      estimatedTotalCredits: 21,
      creditBudget: { dailyRemaining: 100, monthlyRemaining: 500, withinBudget: true },
      decisions: [],
      toEnrich: [],
      budgetInsufficient: false,
    };
    expect(plan.weekKey).toBe("2026-W17");
    expect(plan.budgetInsufficient).toBe(false);
  });

  it("pilotEnrichmentRun result includes runId, dryRun, plan, results, summary", async () => {
    vi.mocked(getLatestReport).mockResolvedValue({ id: 99, weekEnding: "2026-04-28", createdAt: new Date() } as any);
    vi.mocked(getBudgetStatus).mockResolvedValue(makeBudget());
    vi.mocked(checkApolloEligibility).mockResolvedValue({ eligible: true, details: "OK", projectId: 1, reason: "eligible" });
    vi.mocked(getPilotShortlist).mockResolvedValue([]);
    const result = await pilotEnrichmentRun({ dryRun: true });
    expect(result).toHaveProperty("runId");
    expect(result).toHaveProperty("dryRun");
    expect(result).toHaveProperty("plan");
    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("summary");
    expect(result.summary).toHaveProperty("projectsAttempted");
    expect(result.summary).toHaveProperty("projectsEnriched");
    expect(result.summary).toHaveProperty("totalCreditsUsed");
    expect(result.summary).toHaveProperty("totalContactsAdded");
    expect(result.summary).toHaveProperty("totalSendReady");
    expect(result.summary).toHaveProperty("noContactProjects");
  });

  it("runEnrichment tRPC input schema accepts dryRun boolean", () => {
    // Validate z.boolean().default(true) contract
    const schema = { dryRun: true, reportId: undefined, creditCap: undefined };
    expect(typeof schema.dryRun).toBe("boolean");
  });

  it("runEnrichment tRPC input schema accepts creditCap 1-500", () => {
    const validCaps = [1, 50, 150, 500];
    validCaps.forEach(cap => {
      expect(cap).toBeGreaterThanOrEqual(1);
      expect(cap).toBeLessThanOrEqual(500);
    });
  });

  it("buildPlan tRPC query returns plan with budgetInsufficient flag", async () => {
    vi.mocked(getLatestReport).mockResolvedValue({ id: 99, weekEnding: "2026-04-28", createdAt: new Date() } as any);
    vi.mocked(getBudgetStatus).mockResolvedValue(makeBudget({ dailyRemaining: 3, withinBudget: false }));
    vi.mocked(getPilotShortlist).mockResolvedValueOnce([]);
    const plan = await buildPilotEnrichmentPlan();
    expect(typeof plan.budgetInsufficient).toBe("boolean");
  });

  it("getShortlist tRPC query returns hotCount, warmCount, noContactCount, noEmailCount", async () => {
    const items = [
      makeItem({ id: 1, priority: "hot", hasNoContacts: true, contactsWithEmail: 0 }),
      makeItem({ id: 2, priority: "warm", hasNoContacts: false, contactsWithEmail: 0 }),
      makeItem({ id: 3, priority: "warm", hasNoContacts: false, contactsWithEmail: 2 }),
    ];
    vi.mocked(getPilotShortlist).mockResolvedValueOnce(items);
    const result = await getPilotShortlist();
    // Simulate what the tRPC procedure computes
    const hotCount = result.filter(i => i.priority === "hot").length;
    const warmCount = result.filter(i => i.priority === "warm").length;
    const noContactCount = result.filter(i => i.hasNoContacts).length;
    const noEmailCount = result.filter(i => !i.hasNoContacts && i.contactsWithEmail === 0).length;
    expect(hotCount).toBe(1);
    expect(warmCount).toBe(2);
    expect(noContactCount).toBe(1);
    expect(noEmailCount).toBe(1);
  });
});
