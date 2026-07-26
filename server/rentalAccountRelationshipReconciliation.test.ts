import { describe, expect, it } from "vitest";
import { buildRentalHireWorkspace } from "./fullPotentialRentalHire";
import {
  RENTAL_RELATIONSHIP_CANARY_SPECS,
  classifyRentalRelationshipRow,
  expectedPostApplyWorkspaceFailures,
  expectedPreApplyWorkspaceFailures,
  immutableAccountRecordHash,
  sealRentalRelationshipManifest,
  sha256,
  verifySealedRentalRelationshipManifest,
  type RentalRelationshipAccountSnapshot,
  type RentalRelationshipManifestDraft,
  type RentalRelationshipWorkspaceSummary,
} from "./rentalAccountRelationshipReconciliation.shared";

function snapshot(
  id: number,
  overrides: Partial<RentalRelationshipAccountSnapshot> = {},
): RentalRelationshipAccountSnapshot {
  const value = {
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
    platformPushDecision: "push_context",
    currentRevenueAud: "0.00",
    fullPotentialAud: "0.00",
    target2026Aud: "0.00",
    remainingPotentialAud: "0.00",
    updatedAt: "2026-07-26T00:00:00.000Z",
    ...overrides,
  } as RentalRelationshipAccountSnapshot;
  value.fullImmutableStateHash = overrides.fullImmutableStateHash
    || immutableAccountRecordHash(value as unknown as Record<string, unknown>);
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
    region: "Australia",
    segment: "Rental Hire",
    subsegment: "Equipment Rental",
    applicationPlays: ["Portable Air"],
    routeToMarket: "direct_ape",
    ownerName: "Ryan Pemberton / Paul Lueth / Dan Day by site; BLM oversight",
    channelOwner: null,
    fpStatus: "active_target",
    priorityTier: "tier_a",
    platformPushDecision: "push_context",
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

function exactPreSummary(): RentalRelationshipWorkspaceSummary {
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
    topLevelAccountIds: [269, 328, 334, 415],
    parentContextAccountIds: {},
  };
}

function exactPostSummary(): RentalRelationshipWorkspaceSummary {
  return {
    totalRentalRows: 76,
    totalRentalAccounts: 74,
    tierA: 15,
    pushNow: 12,
    directAccounts: 65,
    channelAccounts: 1,
    nonCountingContextRecords: 2,
    attachedContextRecords: 2,
    unattachedContextRecords: 0,
    routeDistribution: { direct_ape: 65, manual_review: 8, cea: 1 },
    topLevelAccountIds: [269, 415],
    parentContextAccountIds: { "269": [328], "415": [334] },
  };
}

describe("Rental relationship manifest classification", () => {
  it("classifies the two exact reviewed pre-states as safe_attach_context", () => {
    const rows = [
      classifyRentalRelationshipRow(
        RENTAL_RELATIONSHIP_CANARY_SPECS[0],
        snapshot(328, { canonicalName: "Coates Hire National Fleet" }),
        snapshot(269, { canonicalName: "Coates Hire", priorityTier: "tier_a" }),
      ),
      classifyRentalRelationshipRow(
        RENTAL_RELATIONSHIP_CANARY_SPECS[1],
        snapshot(334, {
          canonicalName: "Onsite Rental Strategic Channel",
          routeToMarket: "cea",
        }),
        snapshot(415, { canonicalName: "Onsite Rental Group", routeToMarket: "cea" }),
      ),
    ];

    expect(rows.map(row => row.disposition)).toEqual([
      "safe_attach_context",
      "safe_attach_context",
    ]);
    expect(rows.every(row => row.approved === false)).toBe(true);
    expect(rows.every(row => row.reviewFlags.length === 0)).toBe(true);
  });

  it("recognises the exact post-state as idempotently already attached", () => {
    const row = classifyRentalRelationshipRow(
      RENTAL_RELATIONSHIP_CANARY_SPECS[0],
      snapshot(328, {
        canonicalName: "Coates Hire National Fleet",
        parentAccountId: 269,
        relationshipType: "strategic_context",
        countsTowardPotential: false,
      }),
      snapshot(269, { canonicalName: "Coates Hire" }),
    );
    expect(row.disposition).toBe("already_attached");
  });

  it("refuses identity, lifecycle and relationship drift", () => {
    const row = classifyRentalRelationshipRow(
      RENTAL_RELATIONSHIP_CANARY_SPECS[1],
      snapshot(334, {
        canonicalName: "Different Account",
        parentAccountId: 999,
        recordStatus: "parked",
      }),
      snapshot(415, { canonicalName: "Different Parent" }),
    );
    expect(row.disposition).toBe("manual_review");
    expect(row.reviewFlags).toContain("target_identity_mismatch");
    expect(row.reviewFlags).toContain("target_not_active");
    expect(row.reviewFlags).toContain("parent_identity_mismatch");
  });

  it("allows only the three relationship fields and updatedAt to change", () => {
    const before = account(328, {
      canonicalName: "Coates Hire National Fleet",
      updatedAt: new Date("2026-07-26T00:00:00.000Z"),
    });
    const allowedAfter = {
      ...before,
      parentAccountId: 269,
      relationshipType: "strategic_context",
      countsTowardPotential: false,
      updatedAt: new Date("2026-07-26T00:01:00.000Z"),
    };
    const forbiddenAfter = { ...allowedAfter, ownerName: "Different Owner" };

    expect(immutableAccountRecordHash(before)).toBe(immutableAccountRecordHash(allowedAfter));
    expect(immutableAccountRecordHash(forbiddenAfter)).not.toBe(immutableAccountRecordHash(before));
  });
});

describe("Rental relationship workspace gates", () => {
  it("accepts only the exact production pre- and post-apply summaries", () => {
    expect(expectedPreApplyWorkspaceFailures(exactPreSummary())).toEqual([]);
    expect(expectedPostApplyWorkspaceFailures(exactPostSummary())).toEqual([]);

    const brokenPre = exactPreSummary();
    brokenPre.routeDistribution.direct_ape = 65;
    expect(expectedPreApplyWorkspaceFailures(brokenPre)).toContain(
      "route direct_ape=65; expected 66",
    );

    const brokenPost = exactPostSummary();
    brokenPost.attachedContextRecords = 0;
    expect(expectedPostApplyWorkspaceFailures(brokenPost)).toContain(
      "attachedContextRecords=0; expected 2",
    );
  });

  it("rolls both context records beneath their parents without counting them twice", () => {
    const before = [
      account(269, { canonicalName: "Coates Hire", ownerName: "Ryan Pemberton" }),
      account(328, { canonicalName: "Coates Hire National Fleet", ownerName: "Ryan Pemberton" }),
      account(415, {
        canonicalName: "Onsite Rental Group",
        routeToMarket: "cea",
        ownerName: "Ryan Pemberton / Paul Lueth / Dan Day by site; BLM oversight",
      }),
      account(334, {
        canonicalName: "Onsite Rental Strategic Channel",
        routeToMarket: "cea",
        ownerName: "Ryan Pemberton / Paul Lueth / Dan Day by site; BLM oversight",
      }),
    ];
    const after = before.map(row => {
      if (row.id === 328) return { ...row, parentAccountId: 269, relationshipType: "strategic_context", countsTowardPotential: false };
      if (row.id === 334) return { ...row, parentAccountId: 415, relationshipType: "strategic_context", countsTowardPotential: false };
      return row;
    });

    const beforeReport = buildRentalHireWorkspace(before, [], [], { limit: 200 });
    const afterReport = buildRentalHireWorkspace(after, [], [], { limit: 200 });

    expect(beforeReport.summary.totalRentalAccounts).toBe(4);
    expect(afterReport.summary).toMatchObject({
      totalRentalRows: 4,
      totalRentalAccounts: 2,
      nonCountingContextRecords: 2,
      attachedContextRecords: 2,
      unattachedContextRecords: 0,
    });
    expect(afterReport.accounts.map(row => row.id).sort((left, right) => left - right)).toEqual([269, 415]);
    expect(afterReport.accounts.find(row => row.id === 269)?.contextRecords.map(row => row.id)).toEqual([328]);
    expect(afterReport.accounts.find(row => row.id === 415)?.contextRecords.map(row => row.id)).toEqual([334]);
  });
});

describe("Rental relationship manifest sealing", () => {
  function draft(): RentalRelationshipManifestDraft {
    const rows = [
      classifyRentalRelationshipRow(
        RENTAL_RELATIONSHIP_CANARY_SPECS[0],
        snapshot(328, { canonicalName: "Coates Hire National Fleet" }),
        snapshot(269, { canonicalName: "Coates Hire" }),
      ),
      classifyRentalRelationshipRow(
        RENTAL_RELATIONSHIP_CANARY_SPECS[1],
        snapshot(334, { canonicalName: "Onsite Rental Strategic Channel", routeToMarket: "cea" }),
        snapshot(415, { canonicalName: "Onsite Rental Group", routeToMarket: "cea" }),
      ),
    ];
    return {
      schemaVersion: 1,
      generatedAt: "2026-07-26T00:00:00.000Z",
      databaseIdentity: sha256("database"),
      databaseFingerprint: sha256("accounts"),
      sealed: false,
      summary: {
        targetRows: 2,
        safeAttachContext: 2,
        alreadyAttached: 0,
        manualReview: 0,
        approvedRows: 0,
        preApplyWorkspaceChecksPassed: true,
        preApplyWorkspaceFailures: [],
        workspaceBefore: exactPreSummary(),
      },
      rows,
    };
  }

  it("allows only the exact two approved safe rows", () => {
    const reviewed = draft();
    reviewed.rows = reviewed.rows.map(row => ({ ...row, approved: true }));
    const sealed = sealRentalRelationshipManifest(reviewed, "2026-07-26T01:00:00.000Z");
    expect(sealed.summary.approvedRows).toBe(2);
    expect(verifySealedRentalRelationshipManifest(sealed)).toBe(true);
  });

  it("rejects row edits outside approved", () => {
    const reviewed = draft();
    reviewed.rows[0] = { ...reviewed.rows[0], reason: "tampered", approved: true };
    reviewed.rows[1] = { ...reviewed.rows[1], approved: true };
    expect(() => sealRentalRelationshipManifest(reviewed)).toThrow(
      "manifest row changed outside the approved flag",
    );
  });

  it("rejects a partial one-account approval", () => {
    const reviewed = draft();
    reviewed.rows[0] = { ...reviewed.rows[0], approved: true };
    expect(() => sealRentalRelationshipManifest(reviewed)).toThrow(
      "Approved account IDs must be exactly 328,334",
    );
  });
});
