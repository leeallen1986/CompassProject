import { describe, expect, it } from "vitest";
import {
  accountContextNextGap,
  candidateRoleLabel,
  chunkProjectIds,
  certaintyLabel,
  routeToMarketLabel,
  summarizeProjectAccountContexts,
  uniquePositiveProjectIds,
  type ProjectFullPotentialContext,
} from "./fullPotentialProjectContext";

function context(
  accountId: number,
  certainty: "confirmed" | "likely_high" | "likely_medium",
  overrides: Record<string, unknown> = {},
): ProjectFullPotentialContext {
  return {
    primaryMatch: {
      candidateName: "Buying entity",
      candidateSource: "project_contractor",
      candidateRole: "contractor",
      relationshipEvidence: certainty === "confirmed" ? "confirmed" : "predicted",
      relationshipConfidence: certainty === "confirmed" ? 95 : 75,
      accountId,
      canonicalName: `Account ${accountId}`,
      displayName: null,
      matchedSourceAccountId: accountId,
      matchMethod: "canonical_name",
      matchScore: 98,
      certainty,
      matchReason: "Matched canonical account",
      matchedTerm: `Account ${accountId}`,
      account: {
        id: accountId,
        canonicalName: `Account ${accountId}`,
        routeToMarket: "direct_ape",
        priorityTier: "tier_a",
        ownerName: "Validation Owner",
        installedBaseStatus: "known",
        currentSupplier: "Atlas Copco",
        approvedModelId: 7,
        openActionCount: 1,
        ...overrides,
      },
    },
    matches: [],
    unresolvedCandidates: [],
    candidateCount: 1,
    confirmedCount: certainty === "confirmed" ? 1 : 0,
    likelyCount: certainty === "confirmed" ? 0 : 1,
  };
}

describe("Full Potential project account context helpers", () => {
  it("deduplicates and orders positive project IDs", () => {
    expect(uniquePositiveProjectIds([4, 2, 4, 0, -1, 3.5, 1])).toEqual([1, 2, 4]);
  });

  it("chunks project IDs below the 250-ID API limit", () => {
    const ids = Array.from({ length: 251 }, (_, index) => index + 1);
    const chunks = chunkProjectIds(ids, 100);
    expect(chunks.map(chunk => chunk.length)).toEqual([100, 100, 51]);
    expect(chunks.flat()).toEqual(ids);
  });

  it("summarises unique matched accounts and route certainty", () => {
    const unresolved: ProjectFullPotentialContext = {
      primaryMatch: null,
      matches: [],
      unresolvedCandidates: [{
        candidateName: "Ambiguous Hire",
        candidateSource: "project_contractor",
        candidateRole: "contractor",
        relationshipEvidence: "predicted",
        reason: "ambiguous_match",
        possibleAccountIds: [10, 11],
        bestScore: 92,
      }],
      candidateCount: 1,
      confirmedCount: 0,
      likelyCount: 0,
    };

    expect(summarizeProjectAccountContexts([
      context(1, "confirmed"),
      context(1, "likely_high"),
      context(2, "likely_medium"),
      unresolved,
      null,
    ])).toEqual({
      matchedAccounts: 2,
      confirmedRoutes: 1,
      likelyRoutes: 2,
      unresolvedRoutes: 1,
    });
  });

  it("prioritises an active attributed pursuit as the next account state", () => {
    expect(accountContextNextGap(context(1, "confirmed", { activePursuitCount: 1 })))
      .toBe("Attributed pursuit active");
  });

  it("requests an approved model before supplier and installed-base work", () => {
    expect(accountContextNextGap(context(1, "confirmed", { approvedModelId: null })))
      .toBe("Build and approve the evidence-backed model");
  });

  it("describes unresolved buying routes without inventing an account", () => {
    expect(accountContextNextGap({
      primaryMatch: null,
      matches: [],
      unresolvedCandidates: [],
      candidateCount: 2,
      confirmedCount: 0,
      likelyCount: 0,
    })).toBe("Confirm the buying account and route");
  });

  it("uses sales-facing labels for certainty, roles and route to market", () => {
    expect(certaintyLabel("likely_medium")).toBe("Likely account · validate");
    expect(candidateRoleLabel("winning_contractor")).toBe("Winning contractor");
    expect(routeToMarketLabel("direct_ape")).toBe("Direct APE");
  });
});
