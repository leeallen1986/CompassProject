import { describe, expect, it } from "vitest";
import {
  assessRentalOwnership,
  buildRentalHireWorkspace,
  buildRentalRemediationPlan,
  detectRentalOwners,
  expectedRentalOwnership,
  RENTAL_REMEDIATION_TYPES,
} from "./fullPotentialRentalHire";

function account(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    stableKey: `remediation-${id}`,
    canonicalName: `Rental Test Account ${id}`,
    displayName: null,
    parentGroup: null,
    rowClass: "account",
    country: "AU",
    state: "WA",
    region: "Metro",
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
    currentSupplier: "Incumbent A",
    installedBaseStatus: "known",
    c4cStatus: "prospect",
    nextAction: "Review fleet",
    nextActionDate: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

const OPEN_ACTION = {
  id: 10,
  accountId: 1,
  status: "not_started",
  actionType: "installed_base_validation",
  recommendedAction: "Validate Rental Hire installed base, fleet profile and replacement timing",
  notes: "[rental_remediation:installed_base]",
  dueDate: new Date("2026-08-10T00:00:00.000Z"),
  createdAt: new Date("2026-07-11T00:00:00.000Z"),
};

describe("Rental ownership exceptions", () => {
  it("classifies a national shared-owner string as shared aligned", () => {
    const result = assessRentalOwnership(account(1, {
      state: "National",
      ownerName: "Ryan / Paul / Dan by site; BLM oversight",
    }));

    expect(result.ownershipModel).toBe("shared_territory");
    expect(result.expectedOwnerNames).toEqual(["Ryan Pemberton", "Paul Lueth", "Dan Day"]);
    expect(result.actualOwnerNames).toEqual(["Ryan Pemberton", "Paul Lueth", "Dan Day"]);
    expect(result.ownerAlignment).toBe("shared_aligned");
    expect(result.reviewReason).toBeNull();
  });

  it("deduplicates QLD/NSW into one expected owner", () => {
    const result = expectedRentalOwnership(account(2, {
      state: "QLD / NSW",
      ownerName: "Paul Lueth",
    }));

    expect(result.ownershipModel).toBe("single_territory");
    expect(result.expectedOwnerNames).toEqual(["Paul Lueth"]);
    expect(result.expectedOwnerName).toBe("Paul Lueth");
  });

  it("requires both Ryan and Paul for WA/QLD/NSW shared coverage", () => {
    const aligned = assessRentalOwnership(account(3, {
      state: "WA/QLD/NSW",
      ownerName: "Ryan / Paul by site",
    }));
    const mismatch = assessRentalOwnership(account(4, {
      state: "WA/QLD/NSW",
      ownerName: "Ryan Pemberton",
    }));

    expect(aligned.expectedOwnerNames).toEqual(["Ryan Pemberton", "Paul Lueth"]);
    expect(aligned.ownerAlignment).toBe("shared_aligned");
    expect(mismatch.ownerAlignment).toBe("mismatch");
    expect(mismatch.reviewReason).toContain("Shared coverage expects");
  });

  it("keeps Coates as Ryan-owned even when the state is National", () => {
    const result = assessRentalOwnership(account(5, {
      canonicalName: "Coates Strategic Test",
      state: "National",
      ownerName: "Ryan / Paul / Dan by site",
    }));

    expect(result.ownershipModel).toBe("coates_national");
    expect(result.expectedOwnerNames).toEqual(["Ryan Pemberton"]);
    expect(result.ownerAlignment).toBe("mismatch");
  });

  it("does not mistake Paul Edmonds for Paul Lueth", () => {
    expect(detectRentalOwners("Paul Edmonds - Product Support")).toEqual([]);
    expect(assessRentalOwnership(account(6, {
      state: "QLD",
      ownerName: "Paul Edmonds - Product Support",
    })).ownerAlignment).toBe("mismatch");
  });

  it("places a missing state into manual review", () => {
    const result = assessRentalOwnership(account(7, { state: null, ownerName: null }));
    expect(result.ownershipModel).toBe("manual_review");
    expect(result.ownerAlignment).toBe("manual_review");
  });
});

describe("Rental remediation planning", () => {
  const gapAccount = account(1, {
    state: "National",
    ownerName: "Dan Day",
    routeToMarket: "cea",
    channelOwner: null,
    currentSupplier: null,
    installedBaseStatus: "unknown",
    fullPotentialAud: "0.00",
    target2026Aud: null,
    remainingPotentialAud: "0.00",
  });

  it("exposes all four remediation types", () => {
    expect(RENTAL_REMEDIATION_TYPES).toEqual([
      "ownership_review",
      "financial_potential",
      "installed_base",
      "supplier_validation",
    ]);
  });

  it("plans each present commercial gap as eligible", () => {
    for (const remediationType of RENTAL_REMEDIATION_TYPES) {
      const plan = buildRentalRemediationPlan([gapAccount], [], {
        accountIds: [1],
        remediationType,
      });
      expect(plan.eligible).toBe(1);
      expect(plan.items[0].status).toBe("eligible");
    }
  });

  it("does not create an ownership remediation for a valid shared exception", () => {
    const shared = account(2, {
      state: "National",
      ownerName: "Ryan / Paul / Dan by site; BLM oversight",
    });
    const plan = buildRentalRemediationPlan([shared], [], {
      accountIds: [2],
      remediationType: "ownership_review",
    });

    expect(plan.eligible).toBe(0);
    expect(plan.items[0].status).toBe("not_eligible");
  });

  it("deduplicates an existing open remediation action", () => {
    const plan = buildRentalRemediationPlan([gapAccount], [OPEN_ACTION], {
      accountIds: [1],
      remediationType: "installed_base",
    });

    expect(plan.eligible).toBe(0);
    expect(plan.alreadyManaged).toBe(1);
    expect(plan.items[0]).toMatchObject({ status: "already_managed", existingActionId: 10 });
  });

  it("does not treat a closed matching action as managed", () => {
    const plan = buildRentalRemediationPlan([gapAccount], [{ ...OPEN_ACTION, status: "completed" }], {
      accountIds: [1],
      remediationType: "installed_base",
    });

    expect(plan.eligible).toBe(1);
    expect(plan.alreadyManaged).toBe(0);
  });

  it("reports not-rental, not-found and not-eligible selections safely", () => {
    const healthyRental = account(2);
    const nonRental = account(3, {
      canonicalName: "Industrial Contractor",
      segment: "Industrial Services",
      subsegment: "Shutdown Contractor",
    });
    const plan = buildRentalRemediationPlan([healthyRental, nonRental], [], {
      accountIds: [2, 3, 999],
      remediationType: "financial_potential",
    });

    expect(plan.notEligible).toBe(1);
    expect(plan.notRental).toBe(1);
    expect(plan.notFound).toBe(1);
  });

  it("surfaces managed and unmanaged remediation coverage in the workspace", () => {
    const report = buildRentalHireWorkspace([gapAccount], [OPEN_ACTION], [], { limit: 100 });
    const row = report.accounts[0];

    expect(row.remediation.installed_base.managed).toBe(true);
    expect(row.remediation.installed_base.actionId).toBe(10);
    expect(row.remediation.financial_potential.managed).toBe(false);
    expect(row.gapKeys).toContain("unmanaged_remediation");
    expect(report.summary.managedInstalledBase).toBe(1);
    expect(report.summary.unmanagedRemediationAccounts).toBe(1);
  });

  it("moves valid national ownership out of true mismatch and into shared ownership", () => {
    const shared = account(4, {
      state: "National",
      ownerName: "Ryan / Paul / Dan by site; BLM oversight",
    });
    const trueMismatch = account(5, {
      state: "National",
      ownerName: "Dan Day",
    });
    const report = buildRentalHireWorkspace([shared, trueMismatch], [], [], { limit: 100 });

    expect(report.summary.ownerSharedAligned).toBe(1);
    expect(report.summary.ownerMismatch).toBe(1);
    expect(report.viewCounts.shared_ownership).toBe(1);
    expect(report.viewCounts.owner_mismatch).toBe(1);
    expect(report.viewCounts.ownership_review).toBe(1);
  });
});
