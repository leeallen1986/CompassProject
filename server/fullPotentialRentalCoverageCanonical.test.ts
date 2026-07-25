import { describe, expect, it } from "vitest";
import {
  buildCanonicalRentalCoverageCensus,
  reconcileCanonicalRentalCandidates,
} from "./fullPotentialRentalCoverageCanonical";
import type { RentalCoverageAccountInput } from "./fullPotentialRentalCoverageCensus";

function account(overrides: Partial<RentalCoverageAccountInput> = {}): RentalCoverageAccountInput {
  return {
    id: 1,
    stableKey: "example-rental",
    canonicalName: "Example Rental Group",
    displayName: "Example Rental Group",
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
    subsegment: "Equipment Rental",
    applicationPlays: ["portable_air_large"],
    routeToMarket: "direct_ape",
    ownerName: "Ryan Pemberton",
    channelOwner: null,
    fpStatus: "active_target",
    priorityTier: "tier_a",
    platformPushDecision: "push_now",
    currentRevenueAud: "100000",
    fullPotentialAud: "500000",
    target2026Aud: "250000",
    remainingPotentialAud: "400000",
    evidenceSources: ["C4C"],
    confidenceLevel: "medium",
    currentSupplier: "Mixed",
    installedBaseStatus: "partial",
    installedBaseNotes: "Partial fleet known",
    c4cStatus: "prospect",
    nextAction: null,
    nextActionDate: null,
    activeInMyWeek: false,
    isRentalHire: true,
    expectedOwnerNames: ["Ryan Pemberton"],
    ownershipModel: "single_territory",
    ownerAlignment: "aligned",
    ownershipReviewReason: null,
    ...overrides,
  };
}

describe("canonical Rental Hire coverage census", () => {
  it("scopes the market to Australia and counts canonical groups rather than raw rows", () => {
    const parent = account({ id: 1 });
    const branch = account({
      id: 2,
      stableKey: "example-kalgoorlie",
      canonicalName: "Example Rental — Kalgoorlie",
      relationshipType: "branch",
      parentAccountId: 1,
      countsTowardPotential: false,
      priorityTier: "tier_c",
      platformPushDecision: "push_context",
    });
    const nz = account({
      id: 3,
      stableKey: "nz-rental",
      canonicalName: "NZ Rental",
      country: "NZ",
      state: "NZ",
      ownerName: "Dan Day",
      expectedOwnerNames: ["Dan Day"],
    });

    const result = buildCanonicalRentalCoverageCensus({
      allAccounts: [parent, branch, nz],
      aliases: [],
      actions: [],
      signals: [],
      evidence: [],
    }, new Date("2026-07-25T12:00:00Z"));

    expect(result.summary).toMatchObject({
      scopeCountry: "AU",
      totalAccountsRead: 3,
      allRentalRows: 3,
      nonScopeRentalRowsExcluded: 1,
      rentalRows: 2,
      canonicalGroups: 1,
      countingCanonicalGroups: 1,
      countingRentalAccounts: 1,
      countingRows: 1,
      childContextRows: 1,
      tierA: 1,
      pushNow: 1,
    });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].memberAccountIds).toEqual([1, 2]);
    expect(result.summary.states).toEqual({ WA: 1 });
  });

  it("rolls aliases, actions, next actions, signals and evidence across the canonical group", () => {
    const parent = account({ id: 1, nextAction: null, activeInMyWeek: false, evidenceSources: [] });
    const branch = account({
      id: 2,
      stableKey: "example-branch",
      canonicalName: "Example Rental Branch",
      relationshipType: "branch",
      parentAccountId: 1,
      countsTowardPotential: false,
      priorityTier: "tier_c",
      platformPushDecision: "push_context",
      nextAction: "Visit branch manager",
      activeInMyWeek: true,
      evidenceSources: [],
    });

    const result = buildCanonicalRentalCoverageCensus({
      allAccounts: [parent, branch],
      aliases: [{ id: 1, accountId: 2, aliasName: "Example Hire Kalgoorlie" }],
      actions: [{ id: 1, accountId: 2, status: "in_progress" }],
      signals: [{ id: 1, accountId: 2, status: "new" }],
      evidence: [{ id: 1, accountId: 2, status: "verified" }],
    });

    const group = result.groups[0];
    expect(group).toMatchObject({
      aliasCount: 1,
      openActionCount: 1,
      nextActionCount: 1,
      activeInMyWeekCount: 1,
      liveSignalCount: 1,
      evidenceCount: 1,
      verifiedEvidenceCount: 1,
    });
    expect(group.gapCodes).not.toContain("alias_coverage_missing");
    expect(group.gapCodes).not.toContain("priority_action_missing");
    expect(group.gapCodes).not.toContain("evidence_missing");
    expect(group.gapCodes).not.toContain("verified_evidence_missing");
  });

  it("flags multiple counting rows in one canonical group instead of inflating the universe", () => {
    const result = buildCanonicalRentalCoverageCensus({
      allAccounts: [
        account({ id: 1 }),
        account({
          id: 2,
          stableKey: "duplicate-counting-branch",
          canonicalName: "Example Rental NSW",
          relationshipType: "branch",
          parentAccountId: 1,
          countsTowardPotential: true,
          state: "NSW",
          ownerName: "Paul Lueth",
          expectedOwnerNames: ["Paul Lueth"],
          routeToMarket: "cea",
          channelOwner: "CEA",
        }),
      ],
      aliases: [],
      actions: [],
      signals: [],
      evidence: [],
    });

    expect(result.summary.canonicalGroups).toBe(1);
    expect(result.summary.countingCanonicalGroups).toBe(1);
    expect(result.summary.countingRows).toBe(2);
    expect(result.summary.groupsWithMultipleCountingRows).toBe(1);
    expect(result.groups[0].gapCodes).toContain("multiple_counting_records_in_group");
    expect(result.groups[0].gapCodes).toContain("route_conflict");
    expect(result.groups[0].criticalGapCount).toBeGreaterThan(0);
  });

  it("uses account nextAction or My Week presence as valid Tier A/B action coverage", () => {
    const result = buildCanonicalRentalCoverageCensus({
      allAccounts: [account({ nextAction: "Call fleet manager", activeInMyWeek: false })],
      aliases: [{ id: 1, accountId: 1, aliasName: "Example Hire" }],
      actions: [],
      signals: [],
      evidence: [{ id: 1, accountId: 1, status: "verified" }],
    });
    expect(result.groups[0].gapCodes).not.toContain("priority_action_missing");
  });
});

describe("canonical candidate reconciliation", () => {
  it("collapses parent, branch and alias matches to one root instead of a false ambiguity", () => {
    const parent = account({ id: 1, canonicalName: "Coates Hire", displayName: "Coates" });
    const branch = account({
      id: 2,
      stableKey: "coates-kalgoorlie",
      canonicalName: "Coates Kalgoorlie",
      displayName: "Coates Hire",
      parentGroup: "Coates Hire",
      relationshipType: "branch",
      parentAccountId: 1,
      countsTowardPotential: false,
    });
    const [result] = reconcileCanonicalRentalCandidates(
      [{
        candidateName: "Coates Hire",
        sourceName: "Company website",
        sourceUrl: "https://example.com",
        evidenceSummary: "National rental fleet",
        productFit: "portable_air_large",
        state: "WA",
      }],
      [parent, branch],
      [{ id: 1, accountId: 2, aliasName: "Coates Hire" }],
    );

    expect(result.disposition).toBe("existing_account");
    expect(result.matchedAccountIds).toEqual([1]);
    expect(result.matchedMemberAccountIds).toEqual([1, 2]);
    expect(result.researchComplete).toBe(true);
    expect(result.recommendedForImport).toBe(false);
  });

  it("keeps candidates without sourced commercial evidence visibly incomplete", () => {
    const [result] = reconcileCanonicalRentalCandidates(
      [{ candidateName: "New Regional Hire" }],
      [account()],
      [],
    );
    expect(result.disposition).toBe("new_account_candidate");
    expect(result.researchComplete).toBe(false);
    expect(result.researchFlags).toEqual(expect.arrayContaining([
      "source_missing",
      "source_url_missing",
      "evidence_summary_missing",
      "product_fit_missing",
      "state_missing",
    ]));
    expect(result.recommendedForImport).toBe(false);
  });

  it("recognises an existing account even when the current record is not yet Rental-classified", () => {
    const existing = account({
      id: 9,
      canonicalName: "General Compressor Hire",
      segment: "Industrial Service",
      isRentalHire: false,
    });
    const [result] = reconcileCanonicalRentalCandidates(
      [{ candidateName: "General Compressor Hire" }],
      [existing],
      [],
    );
    expect(result.disposition).toBe("existing_account");
    expect(result.matchedAccountIds).toEqual([9]);
    expect(result.matchedSegments).toEqual(["Industrial Service"]);
  });
});
