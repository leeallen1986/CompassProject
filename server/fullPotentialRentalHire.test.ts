import { describe, expect, it } from "vitest";
import {
  buildRentalHireWorkspace,
  expectedRentalOwner,
  isRentalHireAccount,
  RENTAL_HIRE_VIEW_KEYS,
} from "./fullPotentialRentalHire";

function account(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    stableKey: `rental-${id}`,
    canonicalName: `Rental Account ${id}`,
    displayName: null,
    parentGroup: null,
    rowClass: "account",
    country: "AU",
    state: "WA",
    region: "Perth",
    segment: "Rental Hire",
    subsegment: "Regional Rental",
    applicationPlays: ["Fleet replacement"],
    routeToMarket: "direct_ape",
    ownerName: "Ryan Pemberton",
    channelOwner: null,
    fpStatus: "active_target",
    priorityTier: "tier_b",
    platformPushDecision: "push_context",
    currentRevenueAud: "100000.00",
    fullPotentialAud: "500000.00",
    target2026Aud: "250000.00",
    remainingPotentialAud: "400000.00",
    evidenceSources: ["Workbook"],
    confidenceLevel: "medium",
    currentSupplier: "Competitor",
    installedBaseStatus: "known",
    installedBaseNotes: "Fleet known",
    c4cStatus: "prospect",
    nextAction: "Book fleet review",
    nextActionDate: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

const ACCOUNTS = [
  account(1, {
    canonicalName: "Coates Hire WA",
    parentGroup: "Coates",
    state: "WA",
    priorityTier: "tier_a",
    platformPushDecision: "push_now",
    remainingPotentialAud: "900000.00",
  }),
  account(2, {
    canonicalName: "Queensland Regional Hire",
    state: "QLD",
    ownerName: "Paul Lueth",
    routeToMarket: "cea",
    channelOwner: "CEA QLD",
    subsegment: "Regional Hire",
  }),
  account(3, {
    canonicalName: "NSW Rental Gap",
    state: "NSW",
    ownerName: null,
    priorityTier: "tier_a",
    platformPushDecision: "push_now",
    currentSupplier: null,
    installedBaseStatus: "unknown",
    fullPotentialAud: "0.00",
    target2026Aud: null,
    remainingPotentialAud: "0.00",
    nextAction: null,
    nextActionDate: null,
  }),
  account(4, {
    canonicalName: "Victorian Hire Mismatch",
    state: "VIC",
    ownerName: "Paul Lueth",
    subsegment: "Specialist Rental",
  }),
  account(5, {
    canonicalName: "South Australia Channel Rental",
    state: "SA",
    ownerName: "Dan Day",
    routeToMarket: "cp_aps",
    channelOwner: null,
    rowClass: "channel_managed",
  }),
  account(6, {
    canonicalName: "Unknown State Hire",
    state: null,
    ownerName: null,
  }),
  account(7, {
    canonicalName: "Hirepool New Zealand",
    country: "NZ",
    state: "NZ",
    ownerName: "Dan Day",
    segment: "Equipment Services",
    subsegment: "Hire Network",
    routeToMarket: "nz_distributor",
    channelOwner: "ECS",
  }),
  account(8, {
    canonicalName: "Industrial Contractor",
    segment: "Industrial Services",
    subsegment: "Shutdown Contractor",
  }),
];

const ACTIONS = [
  {
    id: 1,
    accountId: 3,
    status: "completed",
    actionType: "account_review",
    dueDate: new Date("2026-07-20T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  },
  {
    id: 2,
    accountId: 4,
    status: "in_progress",
    actionType: "customer_call",
    dueDate: new Date("2026-07-25T00:00:00.000Z"),
    createdAt: new Date("2026-07-10T00:00:00.000Z"),
  },
];

const SIGNALS = [
  {
    id: 1,
    accountId: 3,
    signalTitle: "Fleet tender released",
    status: "new",
    urgency: "hot",
    signalDate: new Date("2026-07-11T00:00:00.000Z"),
    createdAt: new Date("2026-07-11T00:00:00.000Z"),
  },
  {
    id: 2,
    accountId: 4,
    signalTitle: "Old dismissed lead",
    status: "dismissed",
    urgency: "hot",
    signalDate: new Date("2026-07-12T00:00:00.000Z"),
    createdAt: new Date("2026-07-12T00:00:00.000Z"),
  },
  {
    id: 3,
    accountId: 2,
    signalTitle: "Regional branch expansion",
    status: "reviewed",
    urgency: "warm",
    signalDate: new Date("2026-07-10T00:00:00.000Z"),
    createdAt: new Date("2026-07-10T00:00:00.000Z"),
  },
];

function row(report: ReturnType<typeof buildRentalHireWorkspace>, id: number) {
  return report.accounts.find(item => item.id === id);
}

describe("Rental Hire account selection", () => {
  it("selects rental/hire segment records and Coates while excluding unrelated accounts", () => {
    expect(isRentalHireAccount(ACCOUNTS[0])).toBe(true);
    expect(isRentalHireAccount(ACCOUNTS[6])).toBe(true);
    expect(isRentalHireAccount(ACCOUNTS[7])).toBe(false);

    const report = buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS);
    expect(report.summary.totalRentalAccounts).toBe(7);
    expect(report.accounts.some(item => item.canonicalName === "Industrial Contractor")).toBe(false);
  });

  it("uses the explicit territory and Coates ownership rules", () => {
    expect(expectedRentalOwner(ACCOUNTS[0])).toEqual({ expectedOwnerName: "Ryan Pemberton", rule: "Coates national strategic account" });
    expect(expectedRentalOwner(account(20, { state: "WA", canonicalName: "WA Hire" })).expectedOwnerName).toBe("Ryan Pemberton");
    expect(expectedRentalOwner(account(21, { state: "QLD", canonicalName: "QLD Hire" })).expectedOwnerName).toBe("Paul Lueth");
    expect(expectedRentalOwner(account(22, { state: "NSW", canonicalName: "NSW Hire" })).expectedOwnerName).toBe("Paul Lueth");
    expect(expectedRentalOwner(account(23, { state: "VIC", canonicalName: "VIC Hire" })).expectedOwnerName).toBe("Dan Day");
    expect(expectedRentalOwner(account(24, { state: null, canonicalName: "Unknown Hire" })).expectedOwnerName).toBeNull();
  });
});

describe("Rental Hire workspace calculations", () => {
  it("reports aligned, mismatched, unassigned and manual-review ownership separately", () => {
    const report = buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS, { limit: 100 });

    expect(row(report, 1)?.ownerAlignment).toBe("aligned");
    expect(row(report, 3)?.ownerAlignment).toBe("unassigned");
    expect(row(report, 4)?.ownerAlignment).toBe("mismatch");
    expect(row(report, 6)?.ownerAlignment).toBe("manual_review");
    expect(report.summary.ownerAligned).toBe(4);
    expect(report.summary.ownerMismatch).toBe(1);
    expect(report.summary.ownerUnassigned).toBe(1);
  });

  it("checks internal territory owner independently from channel owner", () => {
    const report = buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS, { view: "channel_owner_gap", limit: 100 });

    expect(report.total).toBe(1);
    expect(report.accounts[0].id).toBe(5);
    expect(report.accounts[0].ownerAlignment).toBe("aligned");
    expect(report.accounts[0].channelOwner).toBeNull();
  });

  it("counts only open actions as current workflow activity", () => {
    const report = buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS, { view: "no_open_activity", limit: 100 });

    expect(report.accounts.some(item => item.id === 3)).toBe(true);
    expect(report.accounts.some(item => item.id === 4)).toBe(false);
    expect(row(buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS, { limit: 100 }), 4)?.openActionCount).toBe(1);
  });

  it("counts live signals but excludes dismissed signals from live urgency", () => {
    const report = buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS, { view: "live_signal", limit: 100 });

    expect(report.total).toBe(2);
    expect(report.accounts.map(item => item.id)).toEqual([3, 2]);
    const all = buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS, { limit: 100 });
    expect(row(all, 4)?.signalCount).toBe(1);
    expect(row(all, 4)?.liveSignalCount).toBe(0);
    expect(row(all, 4)?.highestLiveUrgency).toBe("unknown");
  });

  it("calculates commercial gap queues and financial totals", () => {
    const report = buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS, { limit: 100 });

    expect(report.viewCounts.owner_gap).toBe(1);
    expect(report.viewCounts.owner_mismatch).toBe(1);
    expect(report.viewCounts.channel_owner_gap).toBe(1);
    expect(report.viewCounts.unknown_installed_base).toBe(1);
    expect(report.viewCounts.supplier_gap).toBe(1);
    expect(report.viewCounts.financial_gap).toBe(1);
    expect(report.summary.totalFullPotentialAud).toBe(3_000_000);
    expect(report.summary.totalRemainingPotentialAud).toBe(3_300_000);
  });

  it("supports all defined quick views", () => {
    const report = buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS, { limit: 100 });
    expect(Object.keys(report.viewCounts)).toEqual(RENTAL_HIRE_VIEW_KEYS);
    expect(report.viewCounts.all).toBe(7);
    expect(report.viewCounts.tier_a).toBe(2);
    expect(report.viewCounts.push_now).toBe(2);
  });

  it("applies search and combined exact-match filters", () => {
    const report = buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS, {
      search: "regional",
      state: "QLD",
      routeToMarket: "cea",
      ownerName: "Paul Lueth",
      subsegment: "Regional Hire",
      priorityTier: "tier_b",
      rowClass: "account",
      limit: 100,
    });

    expect(report.summary.totalRentalAccounts).toBe(1);
    expect(report.accounts[0].id).toBe(2);
    expect(report.filterOptions.states).toContain("WA");
    expect(report.filterOptions.subsegments).toContain("Specialist Rental");
  });

  it("builds territory, owner, route and subsegment distributions", () => {
    const report = buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS, { limit: 100 });
    const wa = report.territorySummary.find(item => item.state === "WA");
    const sa = report.territorySummary.find(item => item.state === "SA");

    expect(wa).toMatchObject({ count: 1, expectedOwner: "Ryan Pemberton", aligned: 1 });
    expect(sa).toMatchObject({ count: 1, expectedOwner: "Dan Day", channel: 1 });
    expect(report.ownerDistribution.some(item => item.value === "Unassigned")).toBe(true);
    expect(report.routeDistribution.some(item => item.value === "cea")).toBe(true);
    expect(report.subsegmentDistribution.some(item => item.value === "Specialist Rental")).toBe(true);
  });

  it("prioritises Coates, Tier A, Push Now, live signals and remaining potential", () => {
    const report = buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS, { limit: 100 });

    expect(report.accounts[0].id).toBe(1);
    expect(report.accounts[1].id).toBe(3);
    expect(report.accounts[0].specialRule).toBe("Coates national strategic account");
  });

  it("paginates the focus queue without changing summary totals", () => {
    const report = buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS, { limit: 2, offset: 2 });

    expect(report.accounts).toHaveLength(2);
    expect(report.total).toBe(7);
    expect(report.summary.totalRentalAccounts).toBe(7);
    expect(report.limit).toBe(2);
    expect(report.offset).toBe(2);
  });

  it("does not mutate source fixtures", () => {
    const accountSnapshot = structuredClone(ACCOUNTS);
    const actionSnapshot = structuredClone(ACTIONS);
    const signalSnapshot = structuredClone(SIGNALS);

    buildRentalHireWorkspace(ACCOUNTS, ACTIONS, SIGNALS, { view: "push_now" });

    expect(ACCOUNTS).toEqual(accountSnapshot);
    expect(ACTIONS).toEqual(actionSnapshot);
    expect(SIGNALS).toEqual(signalSnapshot);
  });
});
