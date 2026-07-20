import { describe, expect, it } from "vitest";
import {
  buildExploreRouteMetrics,
  closingWindowLabel,
  exploreViewSearch,
  filterExploreProjects,
  legacyIntelligenceHref,
  locationMatchesExploreTerritories,
  parseExploreProjectsLocation,
  searchExploreProjects,
  sortExploreProjects,
  type ExploreProjectLike,
} from "./exploreProjects";
import type { ProjectFullPotentialContext } from "./fullPotentialProjectContext";

function context(
  accountId: number,
  certainty: "confirmed" | "likely_high" | "likely_medium",
  overrides: Record<string, unknown> = {},
): ProjectFullPotentialContext {
  return {
    primaryMatch: {
      candidateName: `Candidate ${accountId}`,
      candidateSource: "project_contractor",
      candidateRole: "contractor",
      relationshipEvidence: certainty === "confirmed" ? "confirmed" : "predicted",
      relationshipConfidence: certainty === "confirmed" ? 95 : 72,
      accountId,
      canonicalName: `Account ${accountId}`,
      displayName: null,
      matchedSourceAccountId: accountId,
      matchMethod: "canonical_name",
      matchScore: 98,
      certainty,
      matchReason: "Matched account",
      matchedTerm: `Account ${accountId}`,
      account: {
        id: accountId,
        canonicalName: `Account ${accountId}`,
        rowClass: "account",
        routeToMarket: "direct_ape",
        ownerName: "Validation Owner",
        countsTowardPotential: true,
        recordStatus: "active",
        ...overrides,
      },
    },
    matches: [],
    unresolvedCandidates: [],
    candidateCount: 1,
    confirmedCount: certainty === "confirmed" ? 1 : 0,
    likelyCount: certainty === "confirmed" ? 0 : 1,
  } as ProjectFullPotentialContext;
}

function unresolvedContext(): ProjectFullPotentialContext {
  return {
    primaryMatch: null,
    matches: [],
    unresolvedCandidates: [{
      candidateName: "Unresolved Contractor",
      candidateSource: "project_contractor",
      candidateRole: "contractor",
      relationshipEvidence: "predicted",
      reason: "no_match",
      possibleAccountIds: [],
      bestScore: 0,
    }],
    candidateCount: 1,
    confirmedCount: 0,
    likelyCount: 0,
  };
}

function project(
  id: number,
  relevanceScore: number,
  fullPotentialContext?: ProjectFullPotentialContext | null,
  overrides: Partial<ExploreProjectLike> = {},
): ExploreProjectLike {
  return {
    id,
    name: `Project ${id}`,
    location: "WA",
    priority: "warm",
    relevanceScore,
    visibilityTier: "watchlist_candidate",
    fullPotentialContext,
    ...overrides,
  };
}

describe("Explore Projects sales board", () => {
  it("maps existing dashboard links into the focused sales views", () => {
    expect(parseExploreProjectsLocation("?tab=projects&filter=action_ready")).toEqual({
      view: "for-you",
      redirectToLegacy: false,
    });
    expect(parseExploreProjectsLocation("?tab=awarded").view).toBe("awarded");
    expect(parseExploreProjectsLocation("?tab=live-tenders").view).toBe("tenders");
    expect(parseExploreProjectsLocation("?tab=contacts")).toEqual({
      view: "all-intelligence",
      redirectToLegacy: true,
    });
    expect(parseExploreProjectsLocation("?collateralId=42").redirectToLegacy).toBe(true);
  });

  it("preserves legacy research query parameters when handing off", () => {
    expect(legacyIntelligenceHref("?tab=contacts&project=9"))
      .toBe("/dashboard/intelligence?tab=contacts&project=9");
    expect(exploreViewSearch("for-you")).toBe("");
    expect(exploreViewSearch("confirmed")).toBe("?view=confirmed");
  });

  it("separates confirmed and likely buying-account routes", () => {
    const projects = [
      project(1, 80, context(269, "confirmed")),
      project(2, 78, context(270, "likely_high")),
      project(3, 75, context(271, "likely_medium")),
      project(4, 70, unresolvedContext()),
    ];

    expect(filterExploreProjects(projects, "confirmed").map(item => item.id)).toEqual([1]);
    expect(filterExploreProjects(projects, "likely").map(item => item.id)).toEqual([2, 3]);
  });

  it("counts unique matched accounts without double-counting multiple projects", () => {
    const metrics = buildExploreRouteMetrics([
      project(1, 90, context(269, "confirmed")),
      project(2, 85, context(269, "confirmed")),
      project(3, 80, context(270, "likely_high")),
      project(4, 75, unresolvedContext()),
    ]);

    expect(metrics).toEqual({
      actionableProjects: 4,
      matchedAccounts: 2,
      confirmedRoutes: 2,
      likelyRoutes: 1,
      unresolvedRoutes: 1,
    });
  });

  it("keeps the server relevance score and visibility tier as the ordering truth", () => {
    const sorted = sortExploreProjects([
      project(1, 99, null, { visibilityTier: "monitor_only", priority: "hot" }),
      project(2, 70, null, { visibilityTier: "must_act_candidate", priority: "warm" }),
      project(3, 80, null, { visibilityTier: "must_act_candidate", priority: "cold" }),
    ]);

    expect(sorted.map(item => item.id)).toEqual([3, 2, 1]);
  });

  it("searches project, account, owner and buying-route context", () => {
    const projects = [
      project(1, 90, context(269, "confirmed", { ownerName: "Ryan Pemberton" })),
      project(2, 80, context(270, "likely_high", { routeToMarket: "cea" })),
    ];

    expect(searchExploreProjects(projects, "ryan").map(item => item.id)).toEqual([1]);
    expect(searchExploreProjects(projects, "cea").map(item => item.id)).toEqual([2]);
    expect(searchExploreProjects(projects, "account 269").map(item => item.id)).toEqual([1]);
  });

  it("uses concise tender timing labels", () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    expect(closingWindowLabel("2026-07-20T12:00:00.000Z", now)).toBe("Closes today");
    expect(closingWindowLabel("2026-07-21T12:00:00.000Z", now)).toBe("Closes in 2 days");
    expect(closingWindowLabel(null, now)).toBe("Close date not confirmed");
  });

  it("filters awarded intelligence to the rep territory without substring false positives", () => {
    expect(locationMatchesExploreTerritories("Pilbara, Western Australia", ["WA"])).toBe(true);
    expect(locationMatchesExploreTerritories("Orara Way, NSW", ["WA"])).toBe(false);
    expect(locationMatchesExploreTerritories("Offshore Australia", ["OFFSHORE_AU"])).toBe(true);
    expect(locationMatchesExploreTerritories("Queensland", ["NATIONAL"])).toBe(true);
  });
});
