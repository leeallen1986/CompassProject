import { describe, expect, it } from "vitest";
import {
  buildRentalHireWorkspace,
  buildRentalRemediationPlan,
} from "./fullPotentialRentalHire";

function account(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    stableKey: `rental-${id}`,
    canonicalName: `Rental Account ${id}`,
    displayName: null,
    parentGroup: null,
    rowClass: "account",
    parentAccountId: null,
    mergedIntoAccountId: null,
    relationshipType: "standalone",
    recordStatus: "active",
    countsTowardPotential: true,
    country: "AU",
    state: "WA",
    region: "Perth",
    segment: "Rental Hire",
    subsegment: "Regional Rental",
    applicationPlays: ["Portable Air"],
    routeToMarket: "direct_ape",
    ownerName: "Ryan Pemberton",
    channelOwner: null,
    fpStatus: "active_target",
    priorityTier: "tier_a",
    platformPushDecision: "push_now",
    currentRevenueAud: "0.00",
    fullPotentialAud: "500000.00",
    target2026Aud: "250000.00",
    remainingPotentialAud: "500000.00",
    currentSupplier: null,
    installedBaseStatus: "unknown",
    c4cStatus: "prospect",
    nextAction: null,
    nextActionDate: null,
    ...overrides,
  };
}

describe("Australian Rental Hire workspace scope", () => {
  const accounts = [
    account(1, {
      canonicalName: "WA Compressor Hire",
      routeToMarket: "direct_ape",
      ownerName: "Ryan Pemberton",
      fullPotentialAud: "500000.00",
    }),
    account(2, {
      canonicalName: "Queensland Regional Hire",
      state: "QLD",
      region: "Brisbane",
      routeToMarket: "cea",
      ownerName: "Paul Lueth",
      channelOwner: "CEA",
      priorityTier: "tier_b",
      platformPushDecision: "push_context",
      fullPotentialAud: "300000.00",
    }),
    account(303, {
      canonicalName: "Hirepool",
      displayName: "Hirepool New Zealand",
      country: "NZ",
      state: "NZ",
      region: "New Zealand",
      routeToMarket: "nz_distributor",
      ownerName: "Dan Day",
      channelOwner: "ECS",
      fullPotentialAud: "700000.00",
    }),
  ];

  it("excludes NZ rows from Australian queue, filters, summaries and financial totals", () => {
    const result = buildRentalHireWorkspace(accounts, [], [], { limit: 100 });

    expect(result.summary).toMatchObject({
      totalRentalRows: 2,
      totalRentalAccounts: 2,
      totalFullPotentialAud: 800000,
      directAccounts: 1,
      channelAccounts: 1,
    });
    expect(result.accounts.map(row => row.id).sort((left, right) => left - right)).toEqual([1, 2]);
    expect(result.accounts.some(row => row.id === 303)).toBe(false);
    expect(result.filterOptions.states).toEqual(["QLD", "WA"]);
    expect(result.filterOptions.routeToMarkets).toEqual(["cea", "direct_ape"]);
    expect(result.territorySummary.some(row => row.state === "NZ")).toBe(false);
  });

  it("preserves actual route and owner distribution values", () => {
    const result = buildRentalHireWorkspace(accounts, [], [], { limit: 100 });

    expect(result.routeDistribution).toEqual([
      { value: "cea", count: 1 },
      { value: "direct_ape", count: 1 },
    ]);
    expect(result.ownerDistribution).toEqual([
      { value: "Paul Lueth", count: 1 },
      { value: "Ryan Pemberton", count: 1 },
    ]);
    expect(result.routeDistribution.some(row => row.value === "unknown")).toBe(false);
    expect(result.ownerDistribution.some(row => row.value === "unknown")).toBe(false);
  });

  it("does not surface an NZ account through search", () => {
    const result = buildRentalHireWorkspace(accounts, [], [], {
      search: "Hirepool",
      limit: 100,
    });

    expect(result.total).toBe(0);
    expect(result.accounts).toEqual([]);
  });

  it("blocks Australian-workspace remediation for an NZ account", () => {
    const result = buildRentalRemediationPlan(accounts, [], {
      accountIds: [303],
      remediationType: "installed_base",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      accountId: 303,
      status: "not_eligible",
      existingActionId: null,
    });
  });
});
