import { describe, expect, it } from "vitest";
import {
  buildReadOnlyNextBest5,
  explicitAirEvidence,
  exclusionReason,
  type NextBest5Input,
  type NextBest5PersistedProject,
  type NextBest5User,
} from "./fullPotentialNextBest5.shared";
import type { ThisWeekProject } from "./thisWeekService";
import type {
  FullPotentialAccountMatch,
  ProjectFullPotentialContext,
} from "./fullPotentialAccountMatching.shared";

const USER: NextBest5User = {
  id: 42,
  name: "Paul Lueth",
  email: "paul@example.com",
  role: "user",
};
const NOW = new Date("2026-07-21T00:00:00.000Z");

function project(
  id: number,
  overrides: Partial<ThisWeekProject> = {},
): ThisWeekProject {
  return {
    id,
    name: `Project ${id}`,
    location: "Queensland",
    value: "$100M",
    owner: "Project Owner",
    priority: "hot",
    sector: "mining",
    stage: "construction",
    overview: "Confirmed drilling program requiring a 900 CFM portable compressor package.",
    actionTier: "tier1_actionable",
    tierLabel: "Tier 1",
    isNew: true,
    opportunityRoute: "Fleet CAPEX",
    contractors: [{
      name: "Validation Contractor",
      status: "confirmed",
      confidence: 95,
    }],
    equipmentSignals: ["portable air compressors"],
    detectedActivities: ["drilling"],
    relevanceScore: 95,
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    whyItMatters: "Active project",
    topBusinessLines: [{ name: "Portable Air", score: 95 }],
    bestStakeholder: null,
    suggestedAction: "Validate the fleet requirement",
    contactDepth: 0,
    suggestedStakeholders: [],
    scopeReason: "QLD + Portable Air match",
    laneMatch: true,
    laneFitLabel: "High",
    channel: "direct",
    whyNow: "Construction and drilling are active now.",
    routeToBuy: "Direct sale via contractor — Fleet CAPEX",
    bestNextMove: "Confirm compressor quantity and mobilisation date.",
    reasonCodes: ["territory_match", "high_lane_fit"],
    visibilityTier: "must_act_candidate",
    laneScore: 95,
    airFit: "High",
    opportunityType: "drilling_blasting",
    bestProductAngle: "Compressor",
    matchedAccountPrior: null,
    contactCTA: {
      action: "find_contacts",
      label: "Find Contacts",
      reason: "No contacts",
    },
    ...overrides,
  };
}

function persisted(
  id: number,
  overrides: Partial<NextBest5PersistedProject> = {},
): NextBest5PersistedProject {
  return {
    id,
    name: `Project ${id}`,
    projectState: "QLD",
    location: "Queensland",
    lifecycleStatus: "active",
    stageCode: "construction",
    sourcePurpose: "contractor_path",
    overview: "Confirmed drilling program requiring a 900 CFM portable compressor package.",
    opportunityNote: "Contractor fleet procurement expected during mobilisation.",
    opportunityRoute: "Fleet CAPEX",
    equipmentSignals: ["portable air compressors"],
    contractors: [{
      name: "Validation Contractor",
      status: "confirmed",
      confidence: 95,
    }],
    sources: [{
      label: "Confirmed project source",
      url: `https://example.com/project-${id}`,
      date: "2026-07-20",
    }],
    sourceLastSeenAt: "2026-07-20T00:00:00.000Z",
    createdAt: "2026-07-20T00:00:00.000Z",
    staleReason: null,
    suppressed: false,
    mergedIntoId: null,
    ...overrides,
  };
}

function match(
  accountId: number,
  overrides: Partial<FullPotentialAccountMatch> = {},
): FullPotentialAccountMatch {
  return {
    candidateName: `Contractor ${accountId}`,
    candidateSource: "project_contractor",
    candidateRole: "contractor",
    relationshipEvidence: "confirmed",
    relationshipConfidence: 95,
    accountId,
    canonicalName: `Account ${accountId}`,
    displayName: null,
    matchedSourceAccountId: accountId,
    matchMethod: "canonical_name",
    matchScore: 100,
    certainty: "confirmed",
    matchReason: "Confirmed contractor matched canonical account",
    matchedTerm: `Account ${accountId}`,
    account: {
      id: accountId,
      canonicalName: `Account ${accountId}`,
      displayName: null,
      rowClass: "account",
      relationshipType: "standalone",
      recordStatus: "active",
      countsTowardPotential: true,
      state: "QLD",
      segment: "Contractor",
      routeToMarket: "direct_ape",
      ownerName: "Paul Lueth",
      channelOwner: null,
      fpStatus: "develop",
      priorityTier: "tier_a",
      platformPushDecision: "push_now",
      confidenceLevel: "medium",
      currentSupplier: null,
      installedBaseStatus: "unknown",
      c4cStatus: "unknown",
      approvedModelId: null,
      openActionCount: 0,
      activePursuitCount: 0,
    },
    ...overrides,
  };
}

function context(
  accountId: number,
  overrides: Partial<ProjectFullPotentialContext> = {},
  matchOverrides: Partial<FullPotentialAccountMatch> = {},
): ProjectFullPotentialContext {
  const primaryMatch = match(accountId, matchOverrides);
  return {
    primaryMatch,
    matches: [primaryMatch],
    unresolvedCandidates: [],
    candidateCount: 1,
    confirmedCount: primaryMatch.certainty === "confirmed" ? 1 : 0,
    likelyCount: primaryMatch.certainty === "confirmed" ? 0 : 1,
    ...overrides,
  };
}

function input(
  id: number,
  overrides: {
    project?: Partial<ThisWeekProject>;
    persisted?: Partial<NextBest5PersistedProject>;
    context?: ProjectFullPotentialContext;
    match?: Partial<FullPotentialAccountMatch>;
    serverPosition?: number;
  } = {},
): NextBest5Input {
  return {
    project: project(id, overrides.project),
    persistedProject: persisted(id, overrides.persisted),
    context: overrides.context ?? context(id, {}, overrides.match),
    serverPosition: overrides.serverPosition ?? id,
  };
}

describe("read-only Next Best 5 eligibility", () => {
  it("uses explicit persisted project text rather than inferred equipment signals", () => {
    expect(explicitAirEvidence(persisted(1))).toContain("drilling and blasting air demand");

    expect(explicitAirEvidence(persisted(2, {
      overview: "Generic civil construction project.",
      opportunityNote: null,
      opportunityRoute: "Fleet CAPEX",
      equipmentSignals: ["portable air compressors"],
    }))).toEqual([]);
  });

  it("preserves the server order and never fills beyond five", () => {
    const result = buildReadOnlyNextBest5(
      [input(8), input(2), input(9), input(1), input(7), input(4)],
      USER,
      { now: NOW },
    );

    expect(result.eligibleCount).toBe(6);
    expect(result.recommendations.map(item => item.projectId))
      .toEqual([8, 2, 9, 1, 7]);
    expect(result.recommendations.map(item => item.rank))
      .toEqual([1, 2, 3, 4, 5]);
  });

  it("returns fewer than five rather than filling with lower-quality projects", () => {
    const result = buildReadOnlyNextBest5([
      input(1),
      input(2, { project: { actionTier: "tier2_warm" } }),
      input(3, { persisted: { sources: [] } }),
      input(4, {
        persisted: {
          overview: "Generic civil construction.",
          opportunityNote: null,
          opportunityRoute: "Fleet CAPEX",
        },
      }),
    ], USER, { now: NOW });

    expect(result.recommendations.map(item => item.projectId)).toEqual([1]);
    expect(result.exclusions.not_tier1).toBe(1);
    expect(result.exclusions.no_source).toBe(1);
    expect(result.exclusions.no_explicit_air_evidence).toBe(1);
  });

  it("excludes already-managed accounts and ownership conflicts", () => {
    expect(exclusionReason(input(1, {
      match: {
        account: {
          ...match(1).account,
          openActionCount: 1,
        },
      },
    }), USER, NOW)).toBe("already_managed");

    expect(exclusionReason(input(2, {
      match: {
        account: {
          ...match(2).account,
          ownerName: "Ryan Pemberton",
        },
      },
    }), USER, NOW)).toBe("owner_mismatch");
  });

  it("requires a confirmed or likely-high canonical buying route", () => {
    const noRoute: ProjectFullPotentialContext = {
      primaryMatch: null,
      matches: [],
      unresolvedCandidates: [],
      candidateCount: 1,
      confirmedCount: 0,
      likelyCount: 0,
    };
    expect(exclusionReason(input(1, { context: noRoute }), USER, NOW))
      .toBe("no_account_route");

    expect(exclusionReason(input(2, {
      match: {
        certainty: "likely_medium",
        relationshipEvidence: "predicted",
      },
    }), USER, NOW)).toBe("weak_account_route");
  });
});

describe("read-only Next Best 5 recommendation content", () => {
  it("makes likely routes explicit validation work", () => {
    const result = buildReadOnlyNextBest5([
      input(1, {
        match: {
          certainty: "likely_high",
          relationshipEvidence: "predicted",
          candidateName: "Likely Contractor",
          candidateRole: "contractor",
        },
      }),
    ], USER, { now: NOW });

    const recommendation = result.recommendations[0];
    expect(recommendation.uncertainties.join(" ")).toContain("Validate that Likely Contractor");
    expect(recommendation.recommendedAction).toContain("Validate that Likely Contractor");
  });

  it("directs an unmodelled account to evidence capture rather than CRM creation", () => {
    const result = buildReadOnlyNextBest5([input(1)], USER, { now: NOW });
    const recommendation = result.recommendations[0];

    expect(recommendation.recommendedAction).toContain("record the evidence in Full Potential");
    expect(recommendation.expectedOutcome).toContain("commercial model");
    expect(recommendation.sources).toEqual([{
      label: "Confirmed project source",
      url: "https://example.com/project-1",
      date: "2026-07-20",
    }]);
  });

  it("uses an approved model only to support a pursue/defer/reject decision", () => {
    const approved = match(1);
    approved.account.approvedModelId = 77;
    approved.account.approvedModelVersion = 2;

    const result = buildReadOnlyNextBest5([
      input(1, { match: approved }),
    ], USER, { now: NOW });
    const recommendation = result.recommendations[0];

    expect(recommendation.recommendedAction).toContain("start an attributed pursuit only if");
    expect(recommendation.expectedOutcome).toContain("C4C");
  });

  it("maps explicit specialty-air evidence without inventing a financial value", () => {
    const result = buildReadOnlyNextBest5([
      input(1, {
        project: {
          bestProductAngle: "N2 Membrane",
          opportunityType: "purging_inerting",
        },
        persisted: {
          overview: "Pipeline purging requires nitrogen membrane equipment and dry-out support.",
        },
      }),
    ], USER, { now: NOW });

    const recommendation = result.recommendations[0];
    expect(recommendation.productHypothesis.label).toBe("Specialty Air — Nitrogen");
    expect(JSON.stringify(recommendation)).not.toMatch(/\$|aud|estimated value/i);
  });
});
