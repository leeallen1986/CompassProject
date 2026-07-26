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
    currentRevenueAud: "100000.00",
    fullPotentialAud: "500000.00",
    target2026Aud: "250000.00",
    remainingPotentialAud: "400000.00",
    currentSupplier: null,
    installedBaseStatus: "unknown",
    c4cStatus: "prospect",
    nextAction: null,
    nextActionDate: null,
    ...overrides,
  };
}

describe("canonical Rental Hire workspace", () => {
  const accounts = [
    account(269, { canonicalName: "Coates Hire", displayName: "Coates Hire" }),
    account(328, {
      canonicalName: "Coates Hire National Fleet",
      displayName: "Coates Hire National Fleet",
      rowClass: "channel_managed",
      parentAccountId: 269,
      relationshipType: "strategic_context",
      countsTowardPotential: false,
      fullPotentialAud: "900000.00",
      remainingPotentialAud: "800000.00",
    }),
    account(999, {
      canonicalName: "Free Floating Rental Context",
      countsTowardPotential: false,
      relationshipType: "strategic_context",
    }),
  ];
  const actions = [{
    id: 1,
    accountId: 328,
    status: "in_progress",
    actionType: "account_review",
    createdAt: new Date("2026-07-25T00:00:00Z"),
  }];
  const signals = [{
    id: 1,
    accountId: 328,
    status: "new",
    urgency: "hot",
    signalTitle: "National fleet review",
    signalDate: new Date("2026-07-25T00:00:00Z"),
    createdAt: new Date("2026-07-25T00:00:00Z"),
  }];

  it("counts only the commercial parent while preserving attached context", () => {
    const result = buildRentalHireWorkspace(accounts, actions, signals, { limit: 100 });

    expect(result.summary).toMatchObject({
      totalRentalRows: 3,
      totalRentalAccounts: 1,
      nonCountingContextRecords: 2,
      attachedContextRecords: 1,
      unattachedContextRecords: 1,
      totalFullPotentialAud: 500000,
      totalRemainingPotentialAud: 400000,
    });
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({
      id: 269,
      contextRecordCount: 1,
      canonicalGroupMemberIds: [269, 328],
      openActionCount: 1,
      liveSignalCount: 1,
      latestSignalTitle: "National fleet review",
    });
    expect(result.accounts[0].contextRecords.map(record => record.id)).toEqual([328]);
  });

  it("finds the parent when searching by an attached context identity", () => {
    const result = buildRentalHireWorkspace(accounts, actions, signals, {
      search: "National Fleet",
      limit: 100,
    });
    expect(result.total).toBe(1);
    expect(result.accounts[0].id).toBe(269);
  });

  it("prevents standalone remediation actions on non-counting context records", () => {
    const result = buildRentalRemediationPlan(accounts, [], {
      accountIds: [328],
      remediationType: "installed_base",
    });
    expect(result.items[0]).toMatchObject({
      accountId: 328,
      status: "not_eligible",
      reason: "Non-counting context records cannot receive standalone remediation actions",
    });
  });
});
