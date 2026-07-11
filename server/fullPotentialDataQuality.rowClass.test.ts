import { describe, expect, it } from "vitest";
import { buildFullPotentialDataQuality } from "./fullPotentialDataQuality";

function issueCount(report: ReturnType<typeof buildFullPotentialDataQuality>, key: string) {
  return report.issues.find(issue => issue.key === key)?.count ?? -1;
}

const CONTEXT_BASE = {
  id: 101,
  stableKey: "context-101",
  canonicalName: "Pilbara Site Context",
  displayName: null,
  parentGroup: "Example Group",
  rowClass: "site_context",
  country: "AU",
  state: "WA",
  region: "Pilbara",
  segment: "Mining",
  subsegment: "Iron Ore",
  applicationPlays: ["Shutdown support"],
  routeToMarket: "direct_ape",
  ownerName: null,
  channelOwner: null,
  fpStatus: "watch",
  priorityTier: "unassigned",
  platformPushDecision: "push_context",
  currentRevenueAud: null,
  fullPotentialAud: null,
  target2026Aud: null,
  remainingPotentialAud: null,
  evidenceSources: ["Public project source"],
  confidenceLevel: "medium",
  currentSupplier: null,
  installedBaseStatus: "unknown",
  installedBaseNotes: null,
  c4cStatus: "unknown",
  nextAction: null,
  nextActionDate: null,
};

describe("Full Potential data-quality row-class applicability", () => {
  it("does not penalise site-context rows for execution-only fields", () => {
    const report = buildFullPotentialDataQuality([CONTEXT_BASE], [], { issue: "missing_owner" });

    expect(report.summary.averageCompletenessPct).toBe(100);
    expect(issueCount(report, "missing_owner")).toBe(0);
    expect(issueCount(report, "priority_unassigned")).toBe(0);
    expect(issueCount(report, "financial_potential_missing")).toBe(0);
    expect(issueCount(report, "c4c_unknown")).toBe(0);
    expect(issueCount(report, "supplier_missing")).toBe(0);
    expect(issueCount(report, "installed_base_unknown")).toBe(0);
    expect(issueCount(report, "push_now_no_activity")).toBe(0);
  });

  it("expects supplier and installed-base evidence for competitor-watch rows but not sales execution fields", () => {
    const competitor = {
      ...CONTEXT_BASE,
      id: 102,
      canonicalName: "Competitor Watch",
      rowClass: "competitor_watch",
      routeToMarket: "manual_review",
      currentSupplier: null,
      installedBaseStatus: "unknown",
    };
    const report = buildFullPotentialDataQuality([competitor], [], { issue: "supplier_missing" });

    expect(issueCount(report, "supplier_missing")).toBe(1);
    expect(issueCount(report, "installed_base_unknown")).toBe(1);
    expect(issueCount(report, "missing_owner")).toBe(0);
    expect(issueCount(report, "financial_potential_missing")).toBe(0);
    expect(issueCount(report, "priority_unassigned")).toBe(0);
  });

  it("requires a channel owner when a normal account is routed through a channel", () => {
    const channelAccount = {
      ...CONTEXT_BASE,
      id: 103,
      canonicalName: "CEA Routed Account",
      rowClass: "account",
      routeToMarket: "cea",
      ownerName: "Internal Rep",
      channelOwner: null,
      priorityTier: "tier_b",
      currentRevenueAud: "0.00",
      fullPotentialAud: "100000.00",
      currentSupplier: "Supplier",
      installedBaseStatus: "partial",
      c4cStatus: "prospect",
      nextAction: "Dealer review",
      nextActionDate: new Date("2026-08-01T00:00:00.000Z"),
    };
    const report = buildFullPotentialDataQuality([channelAccount], [], { issue: "channel_owner_missing" });

    expect(issueCount(report, "channel_owner_missing")).toBe(1);
    expect(report.issueAccountTotal).toBe(1);
  });
});
