import { describe, expect, it } from "vitest";
import {
  REJECTED_KENNARDS_CHILD_ID,
  RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS,
  RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_BATCH_ID,
  RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_MANIFEST_VERSION,
  RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_SPECS,
  UNITED_RENTALS_ACCOUNT_ID,
  classifyRentalRetainedChildBatch2CorrectionRow,
  expectedKennardsUnitedRentalsSeparationFailures,
  expectedRetainedChildBatch2CorrectionPostApplyFailures,
  expectedRetainedChildBatch2CorrectionPreApplyFailures,
  immutableRetainedChildAccountHash,
  sealRentalRetainedChildBatch2CorrectionManifest,
  sha256RetainedChild,
  verifySealedRentalRetainedChildBatch2CorrectionManifest,
  type RentalRetainedChildBatch2CorrectionManifestDraft,
  type RentalRetainedChildBatch2CorrectionWorkspaceSummary,
} from "./rentalRetainedChildBatch2Correction.shared";
import type { RentalRetainedChildAccountSnapshot } from "./rentalRetainedChildReconciliation.shared";

function snapshot(
  id: number,
  overrides: Partial<RentalRetainedChildAccountSnapshot> = {},
): RentalRetainedChildAccountSnapshot {
  const raw = {
    id,
    stableKey: `rental-${id}`,
    canonicalName: `Rental Account ${id}`,
    displayName: null,
    country: "AU",
    state: "National",
    region: "Australia",
    rowClass: "account",
    parentAccountId: null,
    mergedIntoAccountId: null,
    relationshipType: "standalone",
    recordStatus: "active",
    countsTowardPotential: true,
    routeToMarket: "direct_ape",
    ownerName: "Ryan Pemberton",
    priorityTier: "tier_a",
    platformPushDecision: "push_now",
    currentRevenueAud: "0.00",
    fullPotentialAud: "0.00",
    target2026Aud: "0.00",
    remainingPotentialAud: "0.00",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
  return {
    ...raw,
    fullImmutableStateHash: overrides.fullImmutableStateHash
      || immutableRetainedChildAccountHash(raw as unknown as Record<string, unknown>),
  };
}

function exactWorkspace(): RentalRetainedChildBatch2CorrectionWorkspaceSummary {
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

function safeRows() {
  return [
    classifyRentalRetainedChildBatch2CorrectionRow(
      RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_SPECS[0],
      snapshot(278, {
        canonicalName: "Coates Industrial Solutions",
        rowClass: "account",
        routeToMarket: "direct_ape",
        priorityTier: "tier_a",
        platformPushDecision: "push_now",
      }),
      snapshot(269, {
        canonicalName: "Coates Hire",
        displayName: "Coates Hire",
        rowClass: "account",
      }),
    ),
    classifyRentalRetainedChildBatch2CorrectionRow(
      RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_SPECS[1],
      snapshot(352, {
        canonicalName: "Tutt Bryant Equipment",
        rowClass: "account",
        routeToMarket: "manual_review",
        priorityTier: "tier_c",
        platformPushDecision: "channel_view",
      }),
      snapshot(275, {
        canonicalName: "Tutt Bryant Hire",
        displayName: "Tutt Bryant Hire",
        rowClass: "account",
      }),
    ),
  ];
}

function draft(): RentalRetainedChildBatch2CorrectionManifestDraft {
  const rows = safeRows();
  return {
    schemaVersion: RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_MANIFEST_VERSION,
    batchId: RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_BATCH_ID,
    generatedAt: "2026-08-02T00:00:00.000Z",
    databaseIdentity: sha256RetainedChild("database"),
    databaseFingerprint: sha256RetainedChild("fingerprint"),
    sealed: false,
    summary: {
      targetRows: 2,
      safeLinkRetainedChildBatch2Corrected: 2,
      alreadyLinkedRetainedChildBatch2Corrected: 0,
      manualReview: 0,
      approvedRows: 0,
      pr78ContinuityChecksPassed: true,
      pr78ContinuityFailures: [],
      kennardsUnitedRentalsSeparationChecksPassed: true,
      kennardsUnitedRentalsSeparationFailures: [],
      preApplyWorkspaceChecksPassed: true,
      preApplyWorkspaceFailures: [],
      workspaceBefore: exactWorkspace(),
    },
    rows,
  };
}

describe("corrected retained-child batch 2 scope", () => {
  it("contains only the two valid reviewed relationships", () => {
    expect(RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS).toEqual([278, 352]);
    expect(RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_SPECS.map(spec => [
      spec.accountId,
      spec.parentAccountId,
    ])).toEqual([
      [278, 269],
      [352, 275],
    ]);
    expect(RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_SPECS.some(
      spec => spec.accountId === REJECTED_KENNARDS_CHILD_ID,
    )).toBe(false);
  });

  it("classifies both exact source states as safe and preserves commercial state", () => {
    const rows = safeRows();
    expect(rows.map(row => row.disposition)).toEqual([
      "safe_link_retained_child_batch2_corrected",
      "safe_link_retained_child_batch2_corrected",
    ]);
    expect(rows.every(row => row.approved === false)).toBe(true);
    expect(rows.every(row => row.reviewFlags.length === 0)).toBe(true);
    expect(rows.every(row => row.expectedAfter.countsTowardPotential === true)).toBe(true);
    const tuttBryant = rows.find(row => row.accountId === 352)!;
    expect(tuttBryant.before?.routeToMarket).toBe("manual_review");
    expect(tuttBryant.before?.priorityTier).toBe("tier_c");
    expect(tuttBryant.before?.platformPushDecision).toBe("channel_view");
  });

  it("recognises exact linked states idempotently", () => {
    const spec = RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_SPECS[0];
    const row = classifyRentalRetainedChildBatch2CorrectionRow(
      spec,
      snapshot(278, {
        canonicalName: "Coates Industrial Solutions",
        parentAccountId: 269,
        relationshipType: "strategic_context",
      }),
      snapshot(269, {
        canonicalName: "Coates Hire",
        displayName: "Coates Hire",
      }),
    );
    expect(row.disposition).toBe("already_linked_retained_child_batch2_corrected");
  });
});

describe("Kennards and United Rentals separation gate", () => {
  function correctMap() {
    return new Map([
      [UNITED_RENTALS_ACCOUNT_ID, snapshot(272, {
        canonicalName: "United Rentals",
        displayName: "United Rentals Australia",
      })],
      [REJECTED_KENNARDS_CHILD_ID, snapshot(332, {
        canonicalName: "Kennards Hire",
        displayName: "Kennards Hire",
        rowClass: "channel_managed",
        routeToMarket: "direct_ape",
        priorityTier: "tier_a",
        platformPushDecision: "channel_view",
      })],
    ]);
  }

  it("accepts United Rentals 272 and standalone Kennards Hire 332", () => {
    expect(expectedKennardsUnitedRentalsSeparationFailures(correctMap())).toEqual([]);
  });

  it("permanently rejects linking Kennards Hire 332 to United Rentals 272", () => {
    const accounts = correctMap();
    accounts.set(REJECTED_KENNARDS_CHILD_ID, snapshot(332, {
      canonicalName: "Kennards Hire",
      displayName: "Kennards Hire",
      rowClass: "channel_managed",
      routeToMarket: "direct_ape",
      priorityTier: "tier_a",
      platformPushDecision: "channel_view",
      parentAccountId: 272,
      relationshipType: "strategic_context",
    }));
    const failures = expectedKennardsUnitedRentalsSeparationFailures(accounts);
    expect(failures).toContain("Kennards Hire account 332 parent=272; expected null");
    expect(failures).toContain("Kennards Hire account 332 relationshipType=strategic_context; expected standalone");
  });

  it("rejects the stale identity-review assumption that account 272 is Kennards", () => {
    const accounts = correctMap();
    accounts.set(UNITED_RENTALS_ACCOUNT_ID, snapshot(272, {
      canonicalName: "Kennards Hire",
      displayName: "Kennards Hire",
    }));
    expect(expectedKennardsUnitedRentalsSeparationFailures(accounts)).toContain(
      "account 272 identity is not United Rentals",
    );
  });
});

describe("corrected batch-2 workspace and sealing gates", () => {
  it("accepts only the unchanged 76-account workspace", () => {
    expect(expectedRetainedChildBatch2CorrectionPreApplyFailures(exactWorkspace())).toEqual([]);
    expect(expectedRetainedChildBatch2CorrectionPostApplyFailures(exactWorkspace())).toEqual([]);

    const broken = exactWorkspace();
    broken.topLevelAccountIds = broken.topLevelAccountIds.filter(id => id !== 332);
    expect(expectedRetainedChildBatch2CorrectionPreApplyFailures(broken)).toContain(
      "protected standalone account 332 is not top-level",
    );
  });

  it("seals only the exact two approved safe rows", () => {
    const reviewed = draft();
    reviewed.rows = reviewed.rows.map(row => ({ ...row, approved: true }));
    const sealed = sealRentalRetainedChildBatch2CorrectionManifest(
      reviewed,
      "2026-08-02T01:00:00.000Z",
    );
    expect(sealed.summary.approvedRows).toBe(2);
    expect(sealed.rows.filter(row => row.approved).map(row => row.accountId)).toEqual([278, 352]);
    expect(verifySealedRentalRetainedChildBatch2CorrectionManifest(sealed)).toBe(true);
  });

  it("rejects partial approval", () => {
    const reviewed = draft();
    reviewed.rows[0] = { ...reviewed.rows[0], approved: true };
    expect(() => sealRentalRetainedChildBatch2CorrectionManifest(reviewed)).toThrow(
      "Approved account IDs must be exactly 278,352",
    );
  });

  it("rejects changes outside approved flags", () => {
    const reviewed = draft();
    reviewed.rows = reviewed.rows.map(row => ({ ...row, approved: true }));
    reviewed.rows[0] = { ...reviewed.rows[0], relationshipBasis: "tampered" };
    expect(() => sealRentalRetainedChildBatch2CorrectionManifest(reviewed)).toThrow(
      "manifest row changed outside the approved flag",
    );
  });

  it("rejects a seal when the Kennards/United Rentals separation gate failed", () => {
    const reviewed = draft();
    reviewed.rows = reviewed.rows.map(row => ({ ...row, approved: true }));
    reviewed.summary.kennardsUnitedRentalsSeparationChecksPassed = false;
    reviewed.summary.kennardsUnitedRentalsSeparationFailures = [
      "Kennards Hire account 332 parent=272; expected null",
    ];
    expect(() => sealRentalRetainedChildBatch2CorrectionManifest(reviewed)).toThrow(
      "Kennards/United Rentals separation failed",
    );
  });

  it("does not verify a rejected v3 manifest as corrected v4", () => {
    const fakeV3 = {
      ...draft(),
      schemaVersion: 3,
      batchId: "retained-child-batch-2",
      sealed: true,
      sealedAt: "2026-08-02T01:00:00.000Z",
      manifestHash: "0".repeat(64),
    } as any;
    expect(verifySealedRentalRetainedChildBatch2CorrectionManifest(fakeV3)).toBe(false);
  });
});
