import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FullPotentialLookalikeCandidate } from "../shared/fullPotentialLookalikeDiscovery";
import { FP_LOOKALIKE_PUBLIC_CANDIDATES_V1 } from "./fullPotentialLookalikePublicPack";
import {
  buildFullPotentialLookalikeIdentityReport,
  verifyFullPotentialLookalikeIdentityReport,
  type FullPotentialLookalikeAccountSnapshot,
  type FullPotentialLookalikeGovernanceDelta,
} from "./fullPotentialLookalikeIdentityReconciliation";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    stableKey: "example-hire|account|au|national|direct_ape",
    canonicalName: "Example Hire Pty Ltd",
    displayName: "Example Hire",
    parentGroup: null,
    rowClass: "account" as const,
    relationshipType: "standalone",
    recordStatus: "active" as const,
    countsTowardPotential: true,
    mergedIntoAccountId: null,
    country: "AU",
    routeToMarket: "direct_ape",
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<FullPotentialLookalikeAccountSnapshot> = {},
): FullPotentialLookalikeAccountSnapshot {
  return {
    snapshotRef: "lookalike-base-snapshot-v1",
    capturedAt: "2026-08-21T00:00:00.000Z",
    accounts: [account()],
    aliases: [],
    ...overrides,
  };
}

function delta(
  base: FullPotentialLookalikeAccountSnapshot,
  overrides: Partial<FullPotentialLookalikeGovernanceDelta> = {},
): FullPotentialLookalikeGovernanceDelta {
  return {
    version: 1,
    deltaRef: "lookalike-governance-delta-v1",
    appliedAt: "2026-08-22T00:00:00.000Z",
    baseSnapshotSha256: hash(base),
    accounts: [account({
      id: 202,
      stableKey: "another-hire|account|au|national|manual_review",
      canonicalName: "Another Hire",
      displayName: "Another Hire",
      routeToMarket: "manual_review",
      countsTowardPotential: false,
      recordStatus: "under_review",
    })],
    aliases: [],
    ...overrides,
  };
}

function publicCandidate(
  overrides: Partial<FullPotentialLookalikeCandidate> = {},
): FullPotentialLookalikeCandidate {
  return {
    candidateKey: "example-hire",
    candidateName: "Example Hire",
    marketRole: "buyer",
    identityStatus: "not_checked",
    reviewState: "pending_review",
    proposedRouteToMarket: "manual_review",
    proposedOwner: null,
    publicSimilarityRationale: "Public equipment and application evidence resembles the governed Rental seed.",
    features: {
      buyerSegment: "rental_hire",
      subsegments: ["regional_general_hire"],
      applications: ["civil"],
      productCells: ["medium_portable_air"],
      cfmBands: ["350_450"],
      pressureBands: ["standard"],
      geographies: ["wa"],
      oemExposure: ["sullair"],
      branchFootprint: "regional",
      recurringProgrammeEvidence: { reviewed: false, count: 0 },
      currentSignalEvidence: { reviewed: false, count: 0 },
    },
    publicSources: [{
      sourceName: "Example first-party fleet page",
      sourceUrl: "https://example.com/fleet",
      observedAt: "2026-08-22",
      sourceKind: "first_party_company",
      publicObservation: "The public page shows a relevant portable-compressor range.",
    }],
    methodologyVersion: "fp-lookalike-v1",
    ...overrides,
  };
}

describe("Issue #143 governed lookalike identity reconciliation", () => {
  it("matches one exact governed buyer account and keeps sales activation blocked", () => {
    const base = snapshot();
    const report = buildFullPotentialLookalikeIdentityReport({
      sourceSha: "a".repeat(40),
      candidates: [publicCandidate()],
      baseSnapshot: base,
      governanceDelta: delta(base),
    });

    expect(report.results[0]).toMatchObject({
      disposition: "existing_account",
      proposedIdentityStatus: "existing_account",
      proposedReviewState: "pending_review",
      proposedRouteToMarket: "direct_ape",
      matchedAccountId: 101,
      weeklyRecommendationEligible: false,
      durableActionCreated: false,
      countsTowardPotential: false,
      monetaryImpactAud: 0,
    });
    expect(report.reviewInput.overrides[0]).toMatchObject({
      identityStatus: "existing_account",
      reviewState: "pending_review",
      proposedOwner: null,
      currentSignalEvidence: { reviewed: false, count: 0 },
    });
    expect(() => verifyFullPotentialLookalikeIdentityReport(report)).not.toThrow();
  });

  it("recognises an exact governed alias", () => {
    const base = snapshot();
    const governance = delta(base, {
      accounts: [account({
        id: 202,
        stableKey: "another-hire|account|au|national|manual_review",
        canonicalName: "Another Hire",
        displayName: "Another Hire",
        routeToMarket: "manual_review",
        countsTowardPotential: false,
        recordStatus: "active",
      })],
      aliases: [{
        accountId: 202,
        aliasName: "Avenida Australia",
        aliasType: "trading_name",
        confidenceLevel: "high",
      }],
    });
    const report = buildFullPotentialLookalikeIdentityReport({
      sourceSha: "b".repeat(40),
      candidates: [publicCandidate({
        candidateKey: "avenida-australia",
        candidateName: "Avenida Australia",
      })],
      baseSnapshot: base,
      governanceDelta: governance,
    });
    expect(report.results[0]).toMatchObject({
      disposition: "existing_account",
      matchedAccountId: 202,
      proposedRouteToMarket: "manual_review",
    });
    expect(report.results[0].candidates[0].matchedOn).toContain(
      "alias:trading_name:exact-candidate-name",
    );
  });

  it("blocks promotion when an exact identity is governed market context", () => {
    const base = snapshot({
      accounts: [account({
        canonicalName: "Rawson Hire",
        displayName: "Rawson Hire",
        rowClass: "competitor_watch",
        relationshipType: "strategic_context",
        countsTowardPotential: false,
        routeToMarket: "exclude",
      })],
    });
    const report = buildFullPotentialLookalikeIdentityReport({
      sourceSha: "c".repeat(40),
      candidates: [publicCandidate({ candidateKey: "rawson-hire", candidateName: "Rawson Hire" })],
      baseSnapshot: base,
      governanceDelta: delta(base),
    });
    expect(report.results[0]).toMatchObject({
      disposition: "existing_market_context",
      proposedIdentityStatus: "existing_account",
      proposedReviewState: "rejected",
      proposedRouteToMarket: "exclude",
      weeklyRecommendationEligible: false,
    });
  });

  it("keeps weak containment ambiguous and no match as a new identity", () => {
    const base = snapshot({
      accounts: [account({
        canonicalName: "JC Hire Sunshine Coast Equipment Division",
        displayName: null,
      })],
    });
    const report = buildFullPotentialLookalikeIdentityReport({
      sourceSha: "d".repeat(40),
      candidates: [
        publicCandidate({ candidateKey: "jc-hire", candidateName: "JC Hire" }),
        publicCandidate({ candidateKey: "aztech-group", candidateName: "Aztech Group" }),
      ],
      baseSnapshot: base,
      governanceDelta: delta(base),
    });
    expect(report.results.find(row => row.candidateKey === "jc-hire")).toMatchObject({
      disposition: "ambiguous_identity",
      matchedAccountId: null,
    });
    expect(report.results.find(row => row.candidateKey === "aztech-group")).toMatchObject({
      disposition: "new_identity",
      proposedIdentityStatus: "new_identity",
      proposedReviewState: "pending_review",
      proposedRouteToMarket: "manual_review",
    });
  });

  it("reconciles the full public tranche without activating candidate creation", () => {
    const base = snapshot();
    const report = buildFullPotentialLookalikeIdentityReport({
      sourceSha: "e".repeat(40),
      candidates: FP_LOOKALIKE_PUBLIC_CANDIDATES_V1,
      baseSnapshot: base,
      governanceDelta: delta(base),
    });
    expect(report.counts).toMatchObject({
      candidateCount: 8,
      buyerCandidateCount: 6,
      marketParticipantControlCount: 2,
      newIdentityCount: 6,
      excludedMarketParticipantCount: 2,
      weeklyRecommendationEligibleCount: 0,
    });
    expect(report.completeForCandidateCreation).toBe(false);
    expect(report.manualReviewRequired).toBe(true);
    expect(report.reviewInput.overrides).toHaveLength(8);
    expect(report.reviewInput.overrides.every(row => (
      row.reviewState !== "approved_for_qualification"
      && row.proposedOwner === null
      && row.currentSignalEvidence.count === 0
      && row.recurringProgrammeEvidence.count === 0
    ))).toBe(true);
  });

  it("materialises approved delta replacements and additions deterministically", () => {
    const base = snapshot();
    const governance = delta(base, {
      accounts: [
        account({
          canonicalName: "Example Hire Updated",
          displayName: "Example Hire Updated",
        }),
        account({
          id: 202,
          stableKey: "another-hire|account|au|national|manual_review",
          canonicalName: "Another Hire",
          displayName: "Another Hire",
          routeToMarket: "manual_review",
          countsTowardPotential: false,
          recordStatus: "under_review",
        }),
      ],
      aliases: [{
        accountId: 101,
        aliasName: "Example Hire",
        aliasType: "trading_name",
        confidenceLevel: "high",
      }],
    });
    const first = buildFullPotentialLookalikeIdentityReport({
      sourceSha: "f".repeat(40),
      candidates: [publicCandidate()],
      baseSnapshot: base,
      governanceDelta: governance,
    });
    const second = buildFullPotentialLookalikeIdentityReport({
      sourceSha: "f".repeat(40),
      candidates: [publicCandidate()],
      baseSnapshot: base,
      governanceDelta: governance,
    });
    expect(first.reportSha256).toBe(second.reportSha256);
    expect(first.governedSnapshot).toMatchObject({
      beforeAccountCount: 1,
      afterAccountCount: 2,
      createdAccountCount: 1,
      replacedAccountCount: 1,
      beforeAliasCount: 0,
      afterAliasCount: 1,
      addedAliasCount: 1,
    });
    expect(first.results[0].matchedAccountId).toBe(101);
  });

  it("fails closed for mismatched hashes, stable-key collisions and missing alias targets", () => {
    const base = snapshot();
    expect(() => buildFullPotentialLookalikeIdentityReport({
      sourceSha: "1".repeat(40),
      candidates: [publicCandidate()],
      baseSnapshot: base,
      governanceDelta: delta(base, { baseSnapshotSha256: "0".repeat(64) }),
    })).toThrow("base snapshot SHA-256 mismatch");

    expect(() => buildFullPotentialLookalikeIdentityReport({
      sourceSha: "2".repeat(40),
      candidates: [publicCandidate()],
      baseSnapshot: base,
      governanceDelta: delta(base, {
        accounts: [account({
          id: 202,
          stableKey: base.accounts[0].stableKey,
        })],
      }),
    })).toThrow("stableKey collision");

    expect(() => buildFullPotentialLookalikeIdentityReport({
      sourceSha: "3".repeat(40),
      candidates: [publicCandidate()],
      baseSnapshot: base,
      governanceDelta: delta(base, {
        aliases: [{
          accountId: 999,
          aliasName: "Missing Identity",
          aliasType: "trading_name",
          confidenceLevel: "high",
        }],
      }),
    })).toThrow("missing governed account");
  });

  it("rejects forbidden identity fields in bounded snapshot and delta rows", () => {
    const base = snapshot({
      accounts: [{
        ...account(),
        currentRevenueAud: 1,
      } as never],
    });
    expect(() => buildFullPotentialLookalikeIdentityReport({
      sourceSha: "4".repeat(40),
      candidates: [publicCandidate()],
      baseSnapshot: base,
      governanceDelta: delta(base),
    })).toThrow("forbidden fields");
  });
});
