import { describe, expect, it } from "vitest";
import { buildRentalHireWorkspace } from "./fullPotentialRentalHire";
import {
  RENTAL_RETAINED_CHILD_BATCH2_SPECS,
  buildRentalRetainedChildBatch2ManifestSummary,
  classifyRentalRetainedChildBatch2Row,
  expectedPr78ContinuityFailures,
  expectedRetainedChildBatch2PostApplyFailures,
  expectedRetainedChildBatch2PreApplyFailures,
  immutableRetainedChildAccountHash,
  sealRentalRetainedChildBatch2Manifest,
  sha256RetainedChild,
  verifySealedRentalRetainedChildBatch2Manifest,
  type RentalRetainedChildBatch2ManifestDraft,
  type RentalRetainedChildBatch2WorkspaceSummary,
} from "./rentalRetainedChildBatch2Reconciliation.shared";
import type { RentalRetainedChildAccountSnapshot } from "./rentalRetainedChildReconciliation.shared";

function snapshot(
  id: number,
  overrides: Partial<RentalRetainedChildAccountSnapshot> = {},
): RentalRetainedChildAccountSnapshot {
  const value = {
    id,
    stableKey: `rental-${id}`,
    canonicalName: `Rental Account ${id}`,
    displayName: null,
    country: "AU",
    state: "National",
    region: "National",
    rowClass: "account",
    parentAccountId: null,
    mergedIntoAccountId: null,
    relationshipType: "standalone",
    recordStatus: "active",
    countsTowardPotential: true,
    routeToMarket: "direct_ape",
    ownerName: "Ryan Pemberton / Paul Lueth / Dan Day by site; BLM oversight",
    priorityTier: "tier_a",
    platformPushDecision: "push_now",
    currentRevenueAud: "0.00",
    fullPotentialAud: "0.00",
    target2026Aud: "0.00",
    remainingPotentialAud: "0.00",
    updatedAt: "2026-07-29T00:00:00.000Z",
    fullImmutableStateHash: "",
    ...overrides,
  } as RentalRetainedChildAccountSnapshot;
  value.fullImmutableStateHash = overrides.fullImmutableStateHash
    || immutableRetainedChildAccountHash(value as unknown as Record<string, unknown>);
  return value;
}

function account(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> & { id: number } {
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
    state: "National",
    region: "National",
    segment: "Rental Hire",
    subsegment: "Equipment Rental",
    applicationPlays: ["Portable Air"],
    routeToMarket: "direct_ape",
    ownerName: "Ryan Pemberton / Paul Lueth / Dan Day by site; BLM oversight",
    channelOwner: null,
    fpStatus: "active_target",
    priorityTier: "tier_a",
    platformPushDecision: "push_now",
    currentRevenueAud: "0.00",
    fullPotentialAud: "0.00",
    target2026Aud: "0.00",
    remainingPotentialAud: "0.00",
    currentSupplier: null,
    installedBaseStatus: "unknown",
    c4cStatus: "prospect",
    nextAction: null,
    nextActionDate: null,
    ...overrides,
  };
}

function targetAndParent(index: number) {
  const spec = RENTAL_RETAINED_CHILD_BATCH2_SPECS[index];
  const target = snapshot(spec.accountId, {
    canonicalName: spec.expectedAccountName,
    displayName: spec.expectedAccountName,
    rowClass: spec.expectedAccountRowClass,
    state: spec.expectedState,
    routeToMarket: spec.expectedRouteToMarket,
    priorityTier: spec.expectedPriorityTier,
    platformPushDecision: spec.expectedPlatformPushDecision,
  });
  const parentName = index === 0
    ? "Coates Hire"
    : index === 1
      ? "Kennards Hire"
      : "Tutt Bryant Hire";
  const parent = snapshot(spec.parentAccountId, {
    canonicalName: parentName,
    displayName: parentName,
    rowClass: spec.expectedParentRowClass,
  });
  return { spec, target, parent };
}

function exactWorkspace(): RentalRetainedChildBatch2WorkspaceSummary {
  return {
    totalRentalRows: 76,
    totalRentalAccounts: 76,
    tierA: 17,
    pushNow: 12,
    directAccounts: 66,
    channelAccounts: 2,
    nonCountingContextRecords: 0,
    attachedContextRecords: 0,
    unattachedContextRecords: 0,
    routeDistribution: { direct_ape: 66, manual_review: 8, cea: 2 },
    topLevelAccountIds: [269, 272, 275, 278, 332, 352],
  };
}

function continuityMap() {
  return new Map([
    [269, snapshot(269, { canonicalName: "Coates Hire" })],
    [328, snapshot(328, {
      canonicalName: "Coates Hire National Fleet",
      parentAccountId: 269,
      relationshipType: "strategic_context",
    })],
    [415, snapshot(415, { canonicalName: "Onsite Rental Group" })],
    [334, snapshot(334, {
      canonicalName: "Onsite Rental Strategic Channel",
      parentAccountId: 415,
      relationshipType: "strategic_context",
    })],
  ]);
}

describe("retained-child batch 2 classification", () => {
  it("classifies all three exact reviewed source states as safe", () => {
    const rows = RENTAL_RETAINED_CHILD_BATCH2_SPECS.map((_, index) => {
      const { spec, target, parent } = targetAndParent(index);
      return classifyRentalRetainedChildBatch2Row(spec, target, parent);
    });

    expect(rows.map(row => row.accountId)).toEqual([278, 332, 352]);
    expect(rows.every(row => row.disposition === "safe_link_retained_child_batch2")).toBe(true);
    expect(rows.every(row => row.approved === false)).toBe(true);
    expect(rows.every(row => row.reviewFlags.length === 0)).toBe(true);
    expect(rows.every(row => row.expectedAfter.countsTowardPotential === true)).toBe(true);
  });

  it("recognises the exact linked state idempotently", () => {
    const { spec, target, parent } = targetAndParent(0);
    const row = classifyRentalRetainedChildBatch2Row(spec, {
      ...target,
      parentAccountId: spec.parentAccountId,
      relationshipType: "strategic_context",
    }, parent);
    expect(row.disposition).toBe("already_linked_retained_child_batch2");
  });

  it("retains the Tutt Bryant route review rather than silently normalising it", () => {
    const { spec, target, parent } = targetAndParent(2);
    const safe = classifyRentalRetainedChildBatch2Row(spec, target, parent);
    expect(safe.disposition).toBe("safe_link_retained_child_batch2");
    expect(safe.before?.routeToMarket).toBe("manual_review");
    expect(safe.before?.priorityTier).toBe("tier_c");

    const drifted = classifyRentalRetainedChildBatch2Row(spec, {
      ...target,
      routeToMarket: "direct_ape",
    }, parent);
    expect(drifted.disposition).toBe("manual_review");
    expect(drifted.reviewFlags).toContain("target_route_mismatch");
  });

  it("distinguishes the Kennards channel track from its account parent", () => {
    const { spec, target, parent } = targetAndParent(1);
    expect(classifyRentalRetainedChildBatch2Row(spec, target, parent).disposition)
      .toBe("safe_link_retained_child_batch2");

    const wrongClass = classifyRentalRetainedChildBatch2Row(spec, {
      ...target,
      rowClass: "account",
    }, parent);
    expect(wrongClass.disposition).toBe("manual_review");
    expect(wrongClass.reviewFlags).toContain("target_row_class_mismatch");
  });
});

describe("PR78 continuity and workspace invariants", () => {
  it("requires both previously linked retained children to remain intact", () => {
    expect(expectedPr78ContinuityFailures(continuityMap())).toEqual([]);
    const broken = continuityMap();
    broken.set(328, snapshot(328, {
      canonicalName: "Coates Hire National Fleet",
      parentAccountId: null,
      relationshipType: "standalone",
    }));
    expect(expectedPr78ContinuityFailures(broken)).toContain(
      "PR78 retained child 328 parent=null; expected 269",
    );
  });

  it("accepts only the unchanged 76-account Australian workspace", () => {
    expect(expectedRetainedChildBatch2PreApplyFailures(exactWorkspace())).toEqual([]);
    expect(expectedRetainedChildBatch2PostApplyFailures(exactWorkspace())).toEqual([]);

    const broken = exactWorkspace();
    broken.routeDistribution.manual_review = 7;
    expect(expectedRetainedChildBatch2PostApplyFailures(broken)).toContain(
      "route manual_review=7; expected 8",
    );
  });

  it("keeps all three children top-level and counting after parent links", () => {
    const before = [
      account(269, { canonicalName: "Coates Hire" }),
      account(278, { canonicalName: "Coates Industrial Solutions" }),
      account(272, { canonicalName: "Kennards Hire" }),
      account(332, {
        canonicalName: "Kennards Hire",
        rowClass: "channel_managed",
        platformPushDecision: "channel_view",
      }),
      account(275, {
        canonicalName: "Tutt Bryant Hire",
        priorityTier: "tier_b",
      }),
      account(352, {
        canonicalName: "Tutt Bryant Equipment",
        routeToMarket: "manual_review",
        priorityTier: "tier_c",
        platformPushDecision: "channel_view",
      }),
    ];
    const after = before.map(row => {
      if (row.id === 278) return { ...row, parentAccountId: 269, relationshipType: "strategic_context" };
      if (row.id === 332) return { ...row, parentAccountId: 272, relationshipType: "strategic_context" };
      if (row.id === 352) return { ...row, parentAccountId: 275, relationshipType: "strategic_context" };
      return row;
    });

    const beforeReport = buildRentalHireWorkspace(before, [], [], { limit: 200 });
    const afterReport = buildRentalHireWorkspace(after, [], [], { limit: 200 });
    expect(afterReport.summary.totalRentalRows).toBe(beforeReport.summary.totalRentalRows);
    expect(afterReport.summary.totalRentalAccounts).toBe(beforeReport.summary.totalRentalAccounts);
    expect(afterReport.summary.tierA).toBe(beforeReport.summary.tierA);
    expect(afterReport.summary.directAccounts).toBe(beforeReport.summary.directAccounts);
    expect(afterReport.accounts.map(row => row.id).sort((a, b) => a - b))
      .toEqual(beforeReport.accounts.map(row => row.id).sort((a, b) => a - b));
  });
});

describe("retained-child batch 2 sealing", () => {
  function draft(): RentalRetainedChildBatch2ManifestDraft {
    const rows = RENTAL_RETAINED_CHILD_BATCH2_SPECS.map((_, index) => {
      const { spec, target, parent } = targetAndParent(index);
      return classifyRentalRetainedChildBatch2Row(spec, target, parent);
    });
    return {
      schemaVersion: 3,
      batchId: "retained-child-batch-2",
      generatedAt: "2026-07-29T00:00:00.000Z",
      databaseIdentity: sha256RetainedChild("database"),
      databaseFingerprint: sha256RetainedChild("accounts-actions-signals"),
      sealed: false,
      summary: buildRentalRetainedChildBatch2ManifestSummary(rows, exactWorkspace(), []),
      rows,
    };
  }

  it("seals only the exact three approved safe rows", () => {
    const reviewed = draft();
    reviewed.rows = reviewed.rows.map(row => ({ ...row, approved: true }));
    const sealed = sealRentalRetainedChildBatch2Manifest(
      reviewed,
      "2026-07-29T01:00:00.000Z",
    );
    expect(sealed.summary.approvedRows).toBe(3);
    expect(sealed.rows.filter(row => row.approved).map(row => row.accountId))
      .toEqual([278, 332, 352]);
    expect(verifySealedRentalRetainedChildBatch2Manifest(sealed)).toBe(true);
  });

  it("rejects partial approval", () => {
    const reviewed = draft();
    reviewed.rows[0] = { ...reviewed.rows[0], approved: true };
    reviewed.rows[1] = { ...reviewed.rows[1], approved: true };
    expect(() => sealRentalRetainedChildBatch2Manifest(reviewed)).toThrow(
      "Approved account IDs must be exactly 278,332,352",
    );
  });

  it("rejects changes outside approved", () => {
    const reviewed = draft();
    reviewed.rows = reviewed.rows.map(row => ({ ...row, approved: true }));
    reviewed.rows[2] = { ...reviewed.rows[2], relationshipBasis: "tampered" };
    expect(() => sealRentalRetainedChildBatch2Manifest(reviewed)).toThrow(
      "manifest row changed outside the approved flag",
    );
  });

  it("rejects approval when PR78 continuity is not proven", () => {
    const reviewed = draft();
    reviewed.rows = reviewed.rows.map(row => ({ ...row, approved: true }));
    reviewed.summary = {
      ...reviewed.summary,
      pr78ContinuityChecksPassed: false,
      pr78ContinuityFailures: ["PR78 retained child 328 is missing"],
    };
    expect(() => sealRentalRetainedChildBatch2Manifest(reviewed)).toThrow(
      "PR78 continuity failed",
    );
  });
});
