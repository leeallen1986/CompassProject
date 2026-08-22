import { describe, expect, it } from "vitest";
import {
  FP_LOOKALIKE_METHOD_VERSION,
  assertFullPotentialLookalikeCandidate,
  assertFullPotentialLookalikeSeed,
  rankFullPotentialLookalikes,
  type FullPotentialLookalikeCandidate,
  type FullPotentialLookalikeSeed,
} from "../shared/fullPotentialLookalikeDiscovery";
import {
  FP_LOOKALIKE_PUBLIC_CANDIDATES_V1,
  FP_LOOKALIKE_PUBLIC_SEEDS_V1,
} from "./fullPotentialLookalikePublicPack";

function seed(overrides: Partial<FullPotentialLookalikeSeed> = {}): FullPotentialLookalikeSeed {
  return {
    seedKey: "example-seed",
    seedName: "Example Seed",
    clusterKey: "regional-hire",
    methodologyVersion: FP_LOOKALIKE_METHOD_VERSION,
    publicSources: [{
      sourceName: "Example public seed source",
      sourceUrl: "https://example.com/seed",
      observedAt: "2026-08-20",
      sourceKind: "first_party_company",
      publicObservation: "The public site lists a regional compressor hire range.",
    }],
    features: {
      buyerSegment: "rental_hire",
      subsegments: ["regional_general_hire"],
      applications: ["civil", "construction", "mining"],
      productCells: ["small_medium_portable_air", "medium_portable_air"],
      cfmBands: ["130_190", "250_275", "350_450"],
      pressureBands: ["standard", "medium"],
      geographies: ["qld"],
      oemExposure: ["sullair"],
      branchFootprint: "regional",
      recurringProgrammeEvidence: { reviewed: false, count: 0 },
      currentSignalEvidence: { reviewed: false, count: 0 },
    },
    ...overrides,
  };
}

function candidate(
  overrides: Partial<FullPotentialLookalikeCandidate> = {},
): FullPotentialLookalikeCandidate {
  return {
    candidateKey: "example-candidate",
    candidateName: "Example Candidate",
    marketRole: "buyer",
    identityStatus: "new_identity",
    reviewState: "pending_review",
    proposedRouteToMarket: "manual_review",
    proposedOwner: null,
    publicSimilarityRationale: "The public equipment range and regional operating footprint resemble the seed cluster.",
    methodologyVersion: FP_LOOKALIKE_METHOD_VERSION,
    publicSources: [{
      sourceName: "Example public candidate source",
      sourceUrl: "https://example.com/candidate",
      observedAt: "2026-08-21",
      sourceKind: "first_party_company",
      publicObservation: "The public site lists several portable compressors for civil and mining work.",
    }],
    features: {
      buyerSegment: "rental_hire",
      subsegments: ["regional_general_hire"],
      applications: ["civil", "construction", "mining"],
      productCells: ["small_medium_portable_air", "medium_portable_air"],
      cfmBands: ["130_190", "250_275", "350_450"],
      pressureBands: ["standard", "medium"],
      geographies: ["qld"],
      oemExposure: ["sullair"],
      branchFootprint: "regional",
      recurringProgrammeEvidence: { reviewed: false, count: 0 },
      currentSignalEvidence: { reviewed: false, count: 0 },
    },
    ...overrides,
  };
}

describe("Issue #133 governed Full Potential lookalikes", () => {
  it("validates the public seed and candidate packs", () => {
    expect(FP_LOOKALIKE_PUBLIC_SEEDS_V1).toHaveLength(4);
    expect(FP_LOOKALIKE_PUBLIC_CANDIDATES_V1).toHaveLength(8);
    for (const row of FP_LOOKALIKE_PUBLIC_SEEDS_V1) {
      expect(() => assertFullPotentialLookalikeSeed(row)).not.toThrow();
    }
    for (const row of FP_LOOKALIKE_PUBLIC_CANDIDATES_V1) {
      expect(() => assertFullPotentialLookalikeCandidate(row)).not.toThrow();
    }
  });

  it("ranks public buyers but filters dealer and reseller context before promotion", () => {
    const summary = rankFullPotentialLookalikes({
      seeds: FP_LOOKALIKE_PUBLIC_SEEDS_V1,
      candidates: FP_LOOKALIKE_PUBLIC_CANDIDATES_V1,
      asOfDate: "2026-08-22T00:00:00.000Z",
    });

    expect(summary).toMatchObject({
      seedCount: 4,
      candidateCount: 8,
      scoredCandidateCount: 6,
      rankedCandidateCount: 0,
      identityCheckRequiredCount: 6,
      excludedMarketParticipantCount: 2,
      weeklyRecommendationEligibleCount: 0,
      monetaryImpactAud: 0,
      crmC4cMutations: 0,
      contactEnrichmentMutations: 0,
      durableActionsCreated: 0,
    });
    const excluded = summary.results.filter(
      row => row.disposition === "excluded_market_participant",
    );
    expect(excluded.map(row => row.candidateName).sort()).toEqual([
      "Gaamben",
      "Lifting Gear Hire & Sales",
    ]);
    expect(summary.results.filter(row => row.scoreComponents !== null).every(
      row => row.matchedSeedKey !== null && row.similarityScore > 0,
    )).toBe(true);
    expect(summary.results.every(
      row => row.countsTowardPotential === false
        && row.monetaryImpactAud === 0
        && row.durableActionCreated === false,
    )).toBe(true);
  });

  it("keeps un-reconciled identities scoreable but blocked from candidate creation", () => {
    const summary = rankFullPotentialLookalikes({
      seeds: [seed()],
      candidates: [candidate({ identityStatus: "not_checked" })],
      asOfDate: "2026-08-22",
    });
    expect(summary.results[0]).toMatchObject({
      disposition: "identity_check_required",
      manualApprovalRequired: true,
      countsTowardPotential: false,
      crmC4cMutationAllowed: false,
      contactEnrichmentAllowed: false,
    });
    expect(summary.results[0].explanation.join(" ")).toContain(
      "Canonical account and alias reconciliation is required",
    );
  });

  it("distinguishes existing and ambiguous identities without creating duplicate candidates", () => {
    const existing = candidate({
      candidateKey: "existing",
      candidateName: "Existing Buyer",
      identityStatus: "existing_account",
    });
    const ambiguous = candidate({
      candidateKey: "ambiguous",
      candidateName: "Ambiguous Buyer",
      identityStatus: "ambiguous_identity",
    });
    const summary = rankFullPotentialLookalikes({
      seeds: [seed()],
      candidates: [existing, ambiguous],
      asOfDate: "2026-08-22",
    });
    expect(summary.existingAccountCount).toBe(1);
    expect(summary.ambiguousIdentityCount).toBe(1);
    expect(summary.results.find(row => row.candidateKey === "existing")?.disposition)
      .toBe("existing_account");
    expect(summary.results.find(row => row.candidateKey === "ambiguous")?.disposition)
      .toBe("ambiguous_identity");
  });

  it("requires approval, owner, governed route and a reviewed current signal before weekly eligibility", () => {
    const approved = candidate({
      reviewState: "approved_for_qualification",
      proposedOwner: "Territory Owner",
      proposedRouteToMarket: "direct_ape",
      features: {
        ...candidate().features,
        currentSignalEvidence: { reviewed: true, count: 1 },
      },
    });
    const summary = rankFullPotentialLookalikes({
      seeds: [seed()],
      candidates: [approved],
      asOfDate: "2026-08-22",
    });
    expect(summary.weeklyRecommendationEligibleCount).toBe(1);
    expect(summary.results[0]).toMatchObject({
      weeklyRecommendationEligible: true,
      durableActionCreated: false,
    });

    const noSignal = rankFullPotentialLookalikes({
      seeds: [seed()],
      candidates: [candidate({
        reviewState: "approved_for_qualification",
        proposedOwner: "Territory Owner",
        proposedRouteToMarket: "direct_ape",
      })],
      asOfDate: "2026-08-22",
    });
    expect(noSignal.weeklyRecommendationEligibleCount).toBe(0);
  });

  it("applies a deterministic candidate cap per buyer segment", () => {
    const candidates = Array.from({ length: 4 }, (_, index) => candidate({
      candidateKey: `candidate-${index}`,
      candidateName: `Candidate ${index}`,
    }));
    const summary = rankFullPotentialLookalikes({
      seeds: [seed()],
      candidates,
      asOfDate: "2026-08-22",
      segmentCap: 2,
    });
    expect(summary.rankedCandidateCount).toBe(2);
    expect(summary.segmentCapExceededCount).toBe(2);
  });

  it("rejects weak evidence, private language, contacts and duplicate identities", () => {
    const weak = candidate({
      features: {
        ...candidate().features,
        applications: [],
        productCells: [],
        cfmBands: [],
        pressureBands: [],
        geographies: [],
        oemExposure: [],
      },
    });
    const weakSummary = rankFullPotentialLookalikes({
      seeds: [seed()],
      candidates: [weak],
      asOfDate: "2026-08-22",
    });
    expect(weakSummary.insufficientEvidenceCount).toBe(1);

    expect(() => assertFullPotentialLookalikeCandidate(candidate({
      publicSimilarityRationale: "The customer told us they intend to buy next year.",
    }))).toThrow("confidential or CRM-style intelligence");

    expect(() => assertFullPotentialLookalikeCandidate(candidate({
      publicSimilarityRationale: "Contact the buyer on 0412 345 678.",
    }))).toThrow("phone number");

    expect(() => rankFullPotentialLookalikes({
      seeds: [seed()],
      candidates: [candidate(), candidate({ candidateKey: "other-key" })],
      asOfDate: "2026-08-22",
    })).toThrow("Duplicate candidateName");
  });

  it("does not count unreviewed recurring or signal evidence", () => {
    expect(() => assertFullPotentialLookalikeCandidate(candidate({
      features: {
        ...candidate().features,
        recurringProgrammeEvidence: { reviewed: false, count: 1 },
      },
    }))).toThrow("count must be zero until the evidence is reviewed");
  });
});
