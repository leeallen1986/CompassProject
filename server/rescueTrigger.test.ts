/**
 * Rescue Trigger Wiring Tests
 * Validates that identifyRescueCandidates is correctly integrated into the
 * Monday digest pipeline and respects all guardrails.
 */
import { describe, it, expect } from "vitest";
import { identifyRescueCandidates } from "./digestHardeningGates";

describe("Rescue Trigger Integration", () => {
  const makeCandidateData = (overrides: Partial<{
    id: number;
    name: string;
    relevanceScore: number;
    laneFitLabel: string;
    bestContactTrustTier: string | null;
    lastEnrichedAt: Date | null;
    contactCount: number;
  }> = {}) => ({
    id: overrides.id ?? 100,
    name: overrides.name ?? "Test Project",
    relevanceScore: overrides.relevanceScore ?? 80,
    laneFitLabel: overrides.laneFitLabel ?? "High",
    bestContactTrustTier: overrides.bestContactTrustTier ?? null,
    lastEnrichedAt: overrides.lastEnrichedAt ?? null,
    contactCount: overrides.contactCount ?? 0,
  });

  it("triggers rescue when projects have no send_ready contacts and budget is available", () => {
    const candidates = [
      makeCandidateData({ id: 1, name: "Project A", relevanceScore: 90, contactCount: 0 }),
      makeCandidateData({ id: 2, name: "Project B", relevanceScore: 85, contactCount: 1, bestContactTrustTier: "named_unverified" }),
    ];
    const result = identifyRescueCandidates(candidates, 10, 200); // 10 used of 200 cap
    expect(result.triggered).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.budgetRemaining).toBeGreaterThan(0);
  });

  it("does not trigger rescue when budget is exhausted", () => {
    const candidates = [
      makeCandidateData({ id: 1, name: "Project A", relevanceScore: 90, contactCount: 0 }),
    ];
    const result = identifyRescueCandidates(candidates, 198, 200); // Only 2 remaining, less than reserve of 5
    expect(result.triggered).toBe(false);
    expect(result.candidates.length).toBe(0);
  });

  it("respects cooldown: skips projects enriched within 7 days", () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 3); // 3 days ago
    const candidates = [
      makeCandidateData({ id: 1, name: "Recently Enriched", relevanceScore: 90, lastEnrichedAt: recentDate, contactCount: 0 }),
    ];
    const result = identifyRescueCandidates(candidates, 10, 200);
    expect(result.triggered).toBe(false);
    expect(result.cooldownBlocked).toBe(1);
  });

  it("limits rescue to MAX_RESCUE_PER_RUN (3) projects", () => {
    const candidates = [
      makeCandidateData({ id: 1, name: "Project A", relevanceScore: 95, contactCount: 0 }),
      makeCandidateData({ id: 2, name: "Project B", relevanceScore: 90, contactCount: 0 }),
      makeCandidateData({ id: 3, name: "Project C", relevanceScore: 85, contactCount: 0 }),
      makeCandidateData({ id: 4, name: "Project D", relevanceScore: 80, contactCount: 0 }),
      makeCandidateData({ id: 5, name: "Project E", relevanceScore: 75, contactCount: 0 }),
    ];
    const result = identifyRescueCandidates(candidates, 10, 200);
    expect(result.triggered).toBe(true);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it("skips projects below MIN_RELEVANCE (40)", () => {
    const candidates = [
      makeCandidateData({ id: 1, name: "Weak Project", relevanceScore: 30, contactCount: 0 }),
    ];
    const result = identifyRescueCandidates(candidates, 10, 200);
    expect(result.triggered).toBe(false);
    expect(result.candidates.length).toBe(0);
  });

  it("skips projects that already have send_ready contacts", () => {
    const candidates = [
      makeCandidateData({ id: 1, name: "Already Good", relevanceScore: 90, bestContactTrustTier: "send_ready", contactCount: 2 }),
    ];
    const result = identifyRescueCandidates(candidates, 10, 200);
    // Should not trigger since the project already has a good contact
    expect(result.candidates.length).toBe(0);
  });

  it("returns correct budget remaining calculation", () => {
    const candidates = [
      makeCandidateData({ id: 1, name: "Project A", relevanceScore: 90, contactCount: 0 }),
    ];
    const result = identifyRescueCandidates(candidates, 50, 200);
    // budgetRemaining = 200 - 50 - 5 (reserve) = 145
    expect(result.budgetRemaining).toBe(145);
  });
});
