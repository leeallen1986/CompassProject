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

function match(accountId: number, certainty: "confirmed" | "likely_high" | "likely_medium", account: Record<string, unknown> = {}) {
  return {
    primaryMatch: {
      accountId,
      canonicalName: `Account ${accountId}`,
      displayName: null,
      candidateName: `Candidate ${accountId}`,
      certainty,
      account: {
        id: accountId,
        canonicalName: `Account ${accountId}`,
        ownerName: "Validation Owner",
        routeToMarket: "direct_ape",
        ...account,
      },
    },
    candidateCount: 1,
    unresolvedCandidates: [],
  } as any;
}

function unresolved() {
  return {
    primaryMatch: null,
    candidateCount: 1,
    unresolvedCandidates: [{ reason: "no_match", possibleAccountIds: [] }],
  } as any;
}

function project(
  id: number,
  relevanceScore: number,
  fullPotentialContext: any = null,
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
  it("maps old dashboard links to focused or research views", () => {
    expect(parseExploreProjectsLocation("?tab=projects&filter=action_ready"))
      .toEqual({ view: "for-you", redirectToLegacy: false });
    expect(parseExploreProjectsLocation("?tab=awarded").view).toBe("awarded");
    expect(parseExploreProjectsLocation("?tab=live-tenders").view).toBe("tenders");
    expect(parseExploreProjectsLocation("?tab=contacts"))
      .toEqual({ view: "all-intelligence", redirectToLegacy: true });
    expect(parseExploreProjectsLocation("?collateralId=42").redirectToLegacy).toBe(true);
    expect(legacyIntelligenceHref("?tab=contacts&project=9"))
      .toBe("/dashboard/intelligence?tab=contacts&project=9");
    expect(exploreViewSearch("for-you")).toBe("");
    expect(exploreViewSearch("confirmed")).toBe("?view=confirmed");
  });

  it("separates confirmed and likely account routes", () => {
    const projects = [
      project(1, 80, match(269, "confirmed")),
      project(2, 78, match(270, "likely_high")),
      project(3, 75, match(271, "likely_medium")),
      project(4, 70, unresolved()),
    ];
    expect(filterExploreProjects(projects, "confirmed").map(item => item.id)).toEqual([1]);
    expect(filterExploreProjects(projects, "likely").map(item => item.id)).toEqual([2, 3]);
  });

  it("counts unique accounts and route certainty", () => {
    expect(buildExploreRouteMetrics([
      project(1, 90, match(269, "confirmed")),
      project(2, 85, match(269, "confirmed")),
      project(3, 80, match(270, "likely_high")),
      project(4, 75, unresolved()),
    ])).toEqual({
      actionableProjects: 4,
      matchedAccounts: 2,
      confirmedRoutes: 2,
      likelyRoutes: 1,
      unresolvedRoutes: 1,
    });
  });

  it("keeps server visibility and relevance as the ordering truth", () => {
    expect(sortExploreProjects([
      project(1, 99, null, { visibilityTier: "monitor_only", priority: "hot" }),
      project(2, 70, null, { visibilityTier: "must_act_candidate", priority: "warm" }),
      project(3, 80, null, { visibilityTier: "must_act_candidate", priority: "cold" }),
    ]).map(item => item.id)).toEqual([3, 2, 1]);
  });

  it("searches account, owner and route context", () => {
    const projects = [
      project(1, 90, match(269, "confirmed", { ownerName: "Ryan Pemberton" })),
      project(2, 80, match(270, "likely_high", { routeToMarket: "cea" })),
    ];
    expect(searchExploreProjects(projects, "ryan").map(item => item.id)).toEqual([1]);
    expect(searchExploreProjects(projects, "cea").map(item => item.id)).toEqual([2]);
    expect(searchExploreProjects(projects, "account 269").map(item => item.id)).toEqual([1]);
  });

  it("uses calendar-day tender timing labels", () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    expect(closingWindowLabel("2026-07-20T12:00:00.000Z", now)).toBe("Closes today");
    expect(closingWindowLabel("2026-07-21T12:00:00.000Z", now)).toBe("Closes tomorrow");
    expect(closingWindowLabel("2026-07-22T00:00:00.000Z", now)).toBe("Closes in 2 days");
    expect(closingWindowLabel(null, now)).toBe("Close date not confirmed");
  });

  it("matches territories without substring false positives", () => {
    expect(locationMatchesExploreTerritories("Pilbara, Western Australia", ["WA"])).toBe(true);
    expect(locationMatchesExploreTerritories("Orara Way, NSW", ["WA"])).toBe(false);
    expect(locationMatchesExploreTerritories("Offshore Australia", ["OFFSHORE_AU"])).toBe(true);
    expect(locationMatchesExploreTerritories("Queensland", ["NATIONAL"])).toBe(true);
  });
});
