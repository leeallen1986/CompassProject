import { describe, expect, it } from "vitest";
import { buildRentalHireWorkspace } from "./fullPotentialRentalHire";
import {
  RENTAL_RETAINED_CHILD_SPECS,
  classifyRentalRetainedChildRow,
  expectedRetainedChildPostApplyFailures,
  expectedRetainedChildPreApplyFailures,
  immutableRetainedChildAccountHash,
  sealRentalRetainedChildManifest,
  sha256RetainedChild,
  verifySealedRentalRetainedChildManifest,
  type RentalRetainedChildAccountSnapshot,
  type RentalRetainedChildManifestDraft,
  type RentalRetainedChildWorkspaceSummary,
} from "./rentalRetainedChildReconciliation.shared";

function persistedAccount(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    stableKey: `rental-${id}`,
    canonicalName: `Rental Account ${id}`,
    displayName: null,
    parentGroup: null,
    rowClass: "channel_managed",
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
    ownerName: "Ryan Pemberton",
    channelOwner: null,
    fpStatus: "active_target",
    priorityTier: "tier_a",
    platformPushDecision: "channel_view",
    currentRevenueAud: "0.00",
    fullPotentialAud: "0.00",
    target2026Aud: "0.00",
    remainingPotentialAud: "0.00",
    evidenceSources: [],
    confidenceLevel: "high",
    currentSupplier: null,
    installedBaseStatus: "unknown",
    installedBaseNotes: null,
    c4cStatus: "prospect",
    nextAction: null,
    nextActionDate: null,
    activeInMyWeek: false,
    sourceWorkbookVersion: "test",
    sourceSheet: "Rental Hire",
    sourceRowNumber: id,
    rawSourceJson: {},
    createdAt: new Date("2026-07-26T00:00:00.000Z"),
    updatedAt: new Date("2026-07-26T00:00:00.000Z"),
    ...overrides,
  };
}

function snapshot(
  id: number,
  overrides: Record<string, unknown> = {},
): RentalRetainedChildAccountSnapshot {
  const row = persistedAccount(id, overrides);
  return {
    id,
    stableKey: String(row.stableKey),
    canonicalName: String(row.canonicalName),
    displayName: row.displayName ? String(row.displayName) : null,
    country: String(row.country),
    state: row.state ? String(row.state) : null,
    region: row.region ? String(row.region) : null,
    rowClass: row.rowClass ? String(row.rowClass) : null,
    parentAccountId: row.parentAccountId === null ? null : Number(row.parentAccountId),
    mergedIntoAccountId: row.mergedIntoAccountId === null ? null : Number(row.mergedIntoAccountId),
    relationshipType: String(row.relationshipType),
    recordStatus: String(row.recordStatus),
    countsTowardPotential: Boolean(row.countsTowardPotential),
    routeToMarket: String(row.routeToMarket),
    ownerName: row.ownerName ? String(row.ownerName) : null,
    priorityTier: String(row.priorityTier),
    platformPushDecision: String(row.platformPushDecision),
    currentRevenueAud: row.currentRevenueAud === null ? null : String(row.currentRevenueAud),
    fullPotentialAud: row.fullPotentialAud === null ? null : String(row.fullPotentialAud),
    target2026Aud: row.target2026Aud === null ? null : String(row.target2026Aud),
    remainingPotentialAud: row.remainingPotentialAud === null ? null : String(row.remainingPotentialAud),
    updatedAt: (row.updatedAt as Date).toISOString(),
    fullImmutableStateHash: immutableRetainedChildAccountHash(row),
  };
}

function exactWorkspace(): RentalRetainedChildWorkspaceSummary {
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
  };
}

describe("retained-child row classification", () => {
  it("links both reviewed children without changing counting status", () => {
    const rows = [
      classifyRentalRetainedChildRow(
        RENTAL_RETAINED_CHILD_SPECS[0],
        snapshot(328, { canonicalName: "Coates Hire National Fleet" }),
        snapshot(269, { canonicalName: "Coates Hire", rowClass: "account", platformPushDecision: "push_now" }),
      ),
      classifyRentalRetainedChildRow(
        RENTAL_RETAINED_CHILD_SPECS[1],
        snapshot(334, { canonicalName: "Onsite Rental Strategic Channel", routeToMarket: "cea" }),
        snapshot(415, { canonicalName: "Onsite Rental Group", rowClass: "account", routeToMarket: "cea" }),
      ),
    ];

    expect(rows.map(row => row.disposition)).toEqual([
      "safe_link_retained_child",
      "safe_link_retained_child",
    ]);
    expect(rows.every(row => row.approved === false)).toBe(true);
    expect(rows.every(row => row.expectedAfter.countsTowardPotential === true)).toBe(true);
    expect(rows.every(row => row.reviewFlags.length === 0)).toBe(true);
  });

  it("recognises the exact linked retained-child state", () => {
    const row = classifyRentalRetainedChildRow(
      RENTAL_RETAINED_CHILD_SPECS[0],
      snapshot(328, {
        canonicalName: "Coates Hire National Fleet",
        parentAccountId: 269,
        relationshipType: "strategic_context",
      }),
      snapshot(269, { canonicalName: "Coates Hire", rowClass: "account" }),
    );
    expect(row.disposition).toBe("already_linked_retained_child");
  });

  it("refuses any attempt to turn a retained child into a non-counting row", () => {
    const row = classifyRentalRetainedChildRow(
      RENTAL_RETAINED_CHILD_SPECS[1],
      snapshot(334, {
        canonicalName: "Onsite Rental Strategic Channel",
        countsTowardPotential: false,
      }),
      snapshot(415, { canonicalName: "Onsite Rental Group", rowClass: "account", routeToMarket: "cea" }),
    );
    expect(row.disposition).toBe("manual_review");
    expect(row.reviewFlags).toContain("target_not_counting");
  });

  it("permits only parent, relationship type and updatedAt to change", () => {
    const before = persistedAccount(328, { canonicalName: "Coates Hire National Fleet" });
    const permittedAfter = {
      ...before,
      parentAccountId: 269,
      relationshipType: "strategic_context",
      updatedAt: new Date("2026-07-26T00:01:00.000Z"),
    };
    const forbiddenAfter = { ...permittedAfter, countsTowardPotential: false };

    expect(immutableRetainedChildAccountHash(permittedAfter))
      .toBe(immutableRetainedChildAccountHash(before));
    expect(immutableRetainedChildAccountHash(forbiddenAfter))
      .not.toBe(immutableRetainedChildAccountHash(before));
  });
});

describe("retained-child workspace behaviour", () => {
  it("requires unchanged Australian Rental counts before and after linking", () => {
    expect(expectedRetainedChildPreApplyFailures(exactWorkspace())).toEqual([]);
    expect(expectedRetainedChildPostApplyFailures(exactWorkspace())).toEqual([]);

    const broken = exactWorkspace();
    broken.totalRentalAccounts = 74;
    expect(expectedRetainedChildPostApplyFailures(broken)).toContain(
      "totalRentalAccounts=74; expected 76",
    );
  });

  it("keeps both retained children visible and counted after parent links", () => {
    const before = [
      persistedAccount(269, { canonicalName: "Coates Hire", rowClass: "account", platformPushDecision: "push_now" }),
      persistedAccount(328, { canonicalName: "Coates Hire National Fleet" }),
      persistedAccount(415, { canonicalName: "Onsite Rental Group", rowClass: "account", routeToMarket: "cea" }),
      persistedAccount(334, { canonicalName: "Onsite Rental Strategic Channel", routeToMarket: "cea" }),
    ];
    const after = before.map(row => {
      if (row.id === 328) return { ...row, parentAccountId: 269, relationshipType: "strategic_context" };
      if (row.id === 334) return { ...row, parentAccountId: 415, relationshipType: "strategic_context" };
      return row;
    });

    const beforeReport = buildRentalHireWorkspace(before, [], [], { limit: 200 });
    const afterReport = buildRentalHireWorkspace(after, [], [], { limit: 200 });

    expect(beforeReport.summary.totalRentalAccounts).toBe(4);
    expect(afterReport.summary).toMatchObject({
      totalRentalRows: 4,
      totalRentalAccounts: 4,
      tierA: 4,
      nonCountingContextRecords: 0,
      attachedContextRecords: 0,
      unattachedContextRecords: 0,
    });
    expect(afterReport.accounts.map(row => row.id).sort((left, right) => left - right))
      .toEqual([269, 328, 334, 415]);
  });
});

describe("retained-child manifest v2 sealing", () => {
  function draft(): RentalRetainedChildManifestDraft {
    const rows = [
      classifyRentalRetainedChildRow(
        RENTAL_RETAINED_CHILD_SPECS[0],
        snapshot(328, { canonicalName: "Coates Hire National Fleet" }),
        snapshot(269, { canonicalName: "Coates Hire", rowClass: "account" }),
      ),
      classifyRentalRetainedChildRow(
        RENTAL_RETAINED_CHILD_SPECS[1],
        snapshot(334, { canonicalName: "Onsite Rental Strategic Channel", routeToMarket: "cea" }),
        snapshot(415, { canonicalName: "Onsite Rental Group", rowClass: "account", routeToMarket: "cea" }),
      ),
    ];
    return {
      schemaVersion: 2,
      generatedAt: "2026-07-28T00:00:00.000Z",
      databaseIdentity: sha256RetainedChild("database"),
      databaseFingerprint: sha256RetainedChild("state"),
      sealed: false,
      summary: {
        targetRows: 2,
        safeLinkRetainedChild: 2,
        alreadyLinkedRetainedChild: 0,
        manualReview: 0,
        approvedRows: 0,
        preApplyWorkspaceChecksPassed: true,
        preApplyWorkspaceFailures: [],
        workspaceBefore: exactWorkspace(),
      },
      rows,
    };
  }

  it("allows only the exact two approved v2 rows", () => {
    const reviewed = draft();
    reviewed.rows = reviewed.rows.map(row => ({ ...row, approved: true }));
    const sealed = sealRentalRetainedChildManifest(reviewed, "2026-07-28T01:00:00.000Z");
    expect(sealed.summary.approvedRows).toBe(2);
    expect(verifySealedRentalRetainedChildManifest(sealed)).toBe(true);
  });

  it("rejects the retired v1 manifest", () => {
    const retired = { ...draft(), schemaVersion: 1 } as unknown as RentalRetainedChildManifestDraft;
    expect(() => sealRentalRetainedChildManifest(retired)).toThrow(
      "Only an unsealed Rental retained-child manifest v2 draft can be sealed",
    );
  });

  it("rejects partial approval and row tampering", () => {
    const partial = draft();
    partial.rows[0] = { ...partial.rows[0], approved: true };
    expect(() => sealRentalRetainedChildManifest(partial)).toThrow(
      "Approved account IDs must be exactly 328,334",
    );

    const tampered = draft();
    tampered.rows = tampered.rows.map(row => ({ ...row, approved: true }));
    tampered.rows[0] = { ...tampered.rows[0], reason: "tampered" };
    expect(() => sealRentalRetainedChildManifest(tampered)).toThrow(
      "manifest row changed outside the approved flag",
    );
  });
});
