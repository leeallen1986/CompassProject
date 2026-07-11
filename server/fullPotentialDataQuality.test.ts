import { describe, expect, it } from "vitest";
import {
  buildFullPotentialDataQuality,
  FULL_POTENTIAL_QUALITY_ISSUE_KEYS,
} from "./fullPotentialDataQuality";

function completeAccount(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    stableKey: `quality-${id}`,
    canonicalName: `Quality Account ${id}`,
    displayName: null,
    parentGroup: null,
    rowClass: "account",
    country: "AU",
    state: "WA",
    region: "Perth",
    segment: "Rental Hire",
    subsegment: "National Rental",
    applicationPlays: ["Fleet replacement"],
    routeToMarket: "direct_ape",
    ownerName: "Ryan Pemberton",
    channelOwner: null,
    fpStatus: "active_target",
    priorityTier: "tier_a",
    platformPushDecision: "push_now",
    currentRevenueAud: "250000.00",
    fullPotentialAud: "1000000.00",
    target2026Aud: "500000.00",
    remainingPotentialAud: "750000.00",
    evidenceSources: ["Workbook", "Customer visit"],
    confidenceLevel: "high",
    currentSupplier: "Competitor A",
    installedBaseStatus: "known",
    installedBaseNotes: "Validated fleet",
    c4cStatus: "opportunity",
    nextAction: "Arrange fleet review",
    nextActionDate: new Date("2026-07-20T00:00:00.000Z"),
    ...overrides,
  };
}

const ACCOUNTS = [
  completeAccount(1),
  completeAccount(2, {
    canonicalName: "Channel Gap",
    rowClass: "channel_managed",
    state: "QLD",
    segment: "Rental Hire",
    subsegment: "Regional Rental",
    routeToMarket: "cea",
    ownerName: null,
    channelOwner: null,
    priorityTier: "tier_b",
    platformPushDecision: "channel_view",
    currentSupplier: null,
    installedBaseStatus: "unknown",
    evidenceSources: [],
    confidenceLevel: "unknown",
    c4cStatus: "unknown",
  }),
  completeAccount(3, {
    canonicalName: "Tier A Gap",
    state: "NSW",
    segment: "Mining Contractor",
    ownerName: "Paul Lueth",
    nextAction: null,
    nextActionDate: null,
  }),
  completeAccount(4, {
    canonicalName: "Open Action Covers Activity",
    state: "VIC",
    segment: "Mining Contractor",
    ownerName: "Dan Day",
    nextAction: null,
    nextActionDate: null,
  }),
  completeAccount(5, {
    canonicalName: "Unassigned Low Quality",
    state: null,
    segment: null,
    subsegment: null,
    routeToMarket: "manual_review",
    ownerName: null,
    priorityTier: "unassigned",
    platformPushDecision: "qualify_first",
    applicationPlays: [],
    currentRevenueAud: null,
    fullPotentialAud: "0.00",
    target2026Aud: null,
    remainingPotentialAud: "0.00",
    currentSupplier: null,
    installedBaseStatus: "unknown",
    evidenceSources: [],
    confidenceLevel: "unknown",
    c4cStatus: "unknown",
    nextAction: null,
    nextActionDate: null,
  }),
  completeAccount(6, {
    canonicalName: "Target Only Potential",
    state: "SA",
    segment: "Industrial Services",
    priorityTier: "tier_c",
    platformPushDecision: "push_context",
    fullPotentialAud: "0.00",
    target2026Aud: "125000.00",
    remainingPotentialAud: "0.00",
  }),
];

const ACTIONS = [
  {
    accountId: 4,
    status: "in_progress",
    dueDate: new Date("2026-07-18T00:00:00.000Z"),
  },
  {
    accountId: 3,
    status: "completed",
    dueDate: new Date("2026-07-15T00:00:00.000Z"),
  },
];

function issueCount(report: ReturnType<typeof buildFullPotentialDataQuality>, key: string) {
  return report.issues.find(issue => issue.key === key)?.count ?? -1;
}

describe("Full Potential data-quality dashboard", () => {
  it("scores a fully populated direct account at 100%", () => {
    const report = buildFullPotentialDataQuality([ACCOUNTS[0]], [], { issue: "missing_owner" });

    expect(report.summary.totalAccounts).toBe(1);
    expect(report.summary.averageCompletenessPct).toBe(100);
    expect(report.summary.accountsAtLeast90Pct).toBe(1);
    expect(report.fieldCoverage.every(field => field.completenessPct === 100)).toBe(true);
    expect(report.issues.every(issue => issue.count === 0)).toBe(true);
  });

  it("treats channel owner as applicable only for channel-managed accounts", () => {
    const report = buildFullPotentialDataQuality(ACCOUNTS.slice(0, 2), [], { issue: "channel_owner_missing" });
    const channelCoverage = report.fieldCoverage.find(field => field.key === "channelOwner");

    expect(channelCoverage).toMatchObject({ applicable: 1, complete: 0, incomplete: 1, completenessPct: 0 });
    expect(issueCount(report, "channel_owner_missing")).toBe(1);
    expect(report.issueAccounts[0].canonicalName).toBe("Channel Gap");
  });

  it("counts an open dated workflow action as next activity and next activity date", () => {
    const report = buildFullPotentialDataQuality([ACCOUNTS[3]], ACTIONS, { issue: "tier_a_no_next_action" });
    const nextActivity = report.fieldCoverage.find(field => field.key === "nextActivity");
    const nextActivityDate = report.fieldCoverage.find(field => field.key === "nextActivityDate");

    expect(nextActivity?.completenessPct).toBe(100);
    expect(nextActivityDate?.completenessPct).toBe(100);
    expect(issueCount(report, "tier_a_no_next_action")).toBe(0);
    expect(issueCount(report, "push_now_no_activity")).toBe(0);
    expect(report.summary.accountsWithOpenActions).toBe(1);
  });

  it("does not let a closed action satisfy the Tier A or Push Now activity guardrail", () => {
    const report = buildFullPotentialDataQuality([ACCOUNTS[2]], ACTIONS, { issue: "tier_a_no_next_action" });

    expect(issueCount(report, "tier_a_no_next_action")).toBe(1);
    expect(issueCount(report, "push_now_no_activity")).toBe(1);
    expect(report.issueAccountTotal).toBe(1);
  });

  it("treats any positive FP, target or remaining value as recorded financial potential", () => {
    const report = buildFullPotentialDataQuality([ACCOUNTS[4], ACCOUNTS[5]], [], { issue: "financial_potential_missing" });

    expect(issueCount(report, "financial_potential_missing")).toBe(1);
    expect(report.issueAccounts.map(account => account.canonicalName)).toEqual(["Unassigned Low Quality"]);
  });

  it("recalculates quality metrics for filters while keeping universe filter options", () => {
    const report = buildFullPotentialDataQuality(ACCOUNTS, ACTIONS, {
      segment: "Mining Contractor",
      state: "VIC",
      issue: "missing_owner",
    });

    expect(report.summary.totalAccounts).toBe(1);
    expect(report.filterOptions.segments).toEqual([
      "Industrial Services",
      "Mining Contractor",
      "Rental Hire",
    ]);
    expect(report.filterOptions.states).toEqual(["NSW", "QLD", "SA", "VIC", "WA"]);
    expect(report.appliedFilters).toMatchObject({ segment: "Mining Contractor", state: "VIC" });
  });

  it("builds coverage dimensions for segment, state, route, owner and priority", () => {
    const report = buildFullPotentialDataQuality(ACCOUNTS, ACTIONS, { issue: "missing_owner" });
    const rental = report.dimensions.segment.find(row => row.value === "Rental Hire");
    const unassignedOwner = report.dimensions.owner.find(row => row.value === "Unassigned");
    const tierA = report.dimensions.priorityTier.find(row => row.value === "tier_a");

    expect(rental?.count).toBe(2);
    expect(unassignedOwner?.count).toBe(2);
    expect(tierA?.count).toBe(3);
    expect(report.dimensions.routeToMarket.some(row => row.value === "cea")).toBe(true);
    expect(report.dimensions.state.some(row => row.value === "Unassigned")).toBe(true);
  });

  it("returns all issue definitions with counts and bounded samples", () => {
    const report = buildFullPotentialDataQuality(ACCOUNTS, ACTIONS, { issue: "supplier_missing" });

    expect(report.issues.map(issue => issue.key)).toEqual(FULL_POTENTIAL_QUALITY_ISSUE_KEYS);
    expect(report.issues.every(issue => issue.sampleAccounts.length <= 6)).toBe(true);
    expect(issueCount(report, "supplier_missing")).toBe(2);
    expect(issueCount(report, "state_missing")).toBe(1);
  });

  it("sorts issue accounts by Push Now, priority, lower quality and account name", () => {
    const extraPushNow = completeAccount(7, {
      canonicalName: "A Push Now Missing Owner",
      ownerName: null,
      priorityTier: "tier_b",
      platformPushDecision: "push_now",
    });
    const report = buildFullPotentialDataQuality([ACCOUNTS[1], ACCOUNTS[4], extraPushNow], [], {
      issue: "missing_owner",
      limit: 2,
      offset: 0,
    });

    expect(report.issueAccountTotal).toBe(3);
    expect(report.issueAccounts).toHaveLength(2);
    expect(report.issueAccounts[0].canonicalName).toBe("A Push Now Missing Owner");
    expect(report.issueAccounts[0].reviewUrl).toContain("/full-potential?search=");
  });

  it("does not mutate source account or action fixtures", () => {
    const accountsSnapshot = structuredClone(ACCOUNTS);
    const actionsSnapshot = structuredClone(ACTIONS);

    buildFullPotentialDataQuality(ACCOUNTS, ACTIONS, { issue: "evidence_missing" });

    expect(ACCOUNTS).toEqual(accountsSnapshot);
    expect(ACTIONS).toEqual(actionsSnapshot);
  });
});
