import { describe, expect, it } from "vitest";
import {
  RENTAL_RELATIONSHIP_PERSISTED_TYPE,
  buildDraftManifest,
  projectRelationshipCanary,
  sealManifest,
  validateSourceTopology,
  verifySealedManifest,
  type RentalWorkspaceProjection,
} from "./fullPotentialRentalRelationshipReconciliation";

function account(id: number, overrides: Record<string, unknown> = {}) {
  const names: Record<number, string> = {
    269: "Coates Hire",
    328: "Coates Hire National Fleet",
    415: "Onsite Rental Group",
    334: "Onsite Rental Strategic Channel",
  };
  return {
    id,
    stableKey: `account-${id}`,
    canonicalName: names[id],
    displayName: names[id],
    rowClass: id === 328 || id === 334 ? "channel_managed" : "account",
    parentAccountId: null,
    mergedIntoAccountId: null,
    relationshipType: "standalone",
    recordStatus: "active",
    countsTowardPotential: true,
    country: "AU",
    state: "National",
    region: "National",
    routeToMarket: id === 334 ? "cea" : "direct_ape",
    ownerName: "Ryan Pemberton",
    priorityTier: "tier_a",
    platformPushDecision: id === 328 || id === 334 ? "push_context" : "push_now",
    ...overrides,
  };
}

function beforeProjection(): RentalWorkspaceProjection {
  return {
    totalRentalRows: 76,
    totalRentalAccounts: 76,
    nonCountingContextRecords: 0,
    attachedContextRecords: 0,
    unattachedContextRecords: 0,
    tierA: 17,
    pushNow: 12,
    routeDistribution: { direct_ape: 66, manual_review: 8, cea: 2 },
    accountIds: [...Array.from({ length: 72 }, (_, index) => index + 1), 269, 328, 415, 334].sort((a, b) => a - b),
  };
}

function afterProjection(): RentalWorkspaceProjection {
  return {
    ...beforeProjection(),
    totalRentalAccounts: 74,
    nonCountingContextRecords: 2,
    attachedContextRecords: 2,
    tierA: 15,
    routeDistribution: { direct_ape: 65, manual_review: 8, cea: 1 },
    accountIds: beforeProjection().accountIds.filter(id => id !== 328 && id !== 334),
  };
}

function draft() {
  return buildDraftManifest({
    accounts: [account(269), account(328), account(415), account(334)],
    sourceAccountCount: 1170,
    databaseIdentity: "identity",
    databaseFingerprint: "fingerprint",
    sourceGitHubSha: "sha",
    workspaceBefore: beforeProjection(),
    workspaceExpectedAfter: afterProjection(),
    generatedAt: new Date("2026-07-26T00:00:00Z"),
  });
}

describe("Rental relationship reconciliation", () => {
  it("validates the exact source topology", () => {
    expect(() => validateSourceTopology([account(269), account(328), account(415), account(334)])).not.toThrow();
    expect(() => validateSourceTopology([account(269), account(328, { canonicalName: "Wrong" }), account(415), account(334)])).toThrow(/canonicalName mismatch/);
    expect(() => validateSourceTopology([account(269), account(328, { parentAccountId: 999 }), account(415), account(334)])).toThrow(/parentAccountId mismatch/);
    expect(() => validateSourceTopology([account(269), account(328), account(415, { countsTowardPotential: false }), account(334)])).toThrow(/countsTowardPotential mismatch/);
  });

  it("projects exactly the two non-counting context relationships", () => {
    const rows = projectRelationshipCanary([account(269), account(328), account(415), account(334)]);
    expect(rows.find(row => row.id === 328)).toMatchObject({ parentAccountId: 269, relationshipType: RENTAL_RELATIONSHIP_PERSISTED_TYPE, countsTowardPotential: false });
    expect(rows.find(row => row.id === 334)).toMatchObject({ parentAccountId: 415, relationshipType: RENTAL_RELATIONSHIP_PERSISTED_TYPE, countsTowardPotential: false });
    expect(rows.find(row => row.id === 269)).toMatchObject({ parentAccountId: null, countsTowardPotential: true });
    expect(rows.find(row => row.id === 415)).toMatchObject({ parentAccountId: null, countsTowardPotential: true });
  });

  it("builds an unapproved draft with the expected workspace delta", () => {
    const manifest = draft();
    expect(manifest).toMatchObject({ mode: "draft", rowCount: 2, approvedRows: 0, automaticWriteAllowed: false, manifestHash: null });
    expect(manifest.rows.map(row => row.accountId)).toEqual([328, 334]);
    expect(manifest.workspaceExpectedAfter).toEqual(afterProjection());
  });

  it("refuses an unexpected workspace delta", () => {
    expect(() => buildDraftManifest({
      accounts: [account(269), account(328), account(415), account(334)],
      sourceAccountCount: 1170,
      databaseIdentity: "identity",
      databaseFingerprint: "fingerprint",
      workspaceBefore: beforeProjection(),
      workspaceExpectedAfter: { ...afterProjection(), totalRentalAccounts: 73 },
    })).toThrow(/totalRentalAccounts mismatch/);
  });

  it("seals only an exact explicitly approved two-row manifest", () => {
    expect(() => sealManifest(draft())).toThrow(/explicitly approved/);
    const reviewed = { ...draft(), rows: draft().rows.map(row => ({ ...row, approved: true })) };
    const sealed = sealManifest(reviewed, new Date("2026-07-26T01:00:00Z"));
    expect(sealed.approvedRows).toBe(2);
    expect(sealed.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifySealedManifest(sealed)).toBe(true);
    expect(verifySealedManifest({ ...sealed, rows: sealed.rows.map((row, index) => index === 0 ? { ...row, parentAccountId: 415 } : row) })).toBe(false);
  });
});
