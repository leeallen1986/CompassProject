import { describe, expect, it } from "vitest";
import {
  buildFullPotentialMatchIndex,
  extractProjectAccountCandidates,
  parseContractorIdentity,
  resolveFullPotentialCandidate,
  resolveProjectFullPotentialContext,
  significantCompanyTokens,
  type FullPotentialAccountForMatching,
} from "./fullPotentialAccountMatching.shared";

function account(id: number, canonicalName: string): FullPotentialAccountForMatching {
  return {
    id,
    canonicalName,
    displayName: null,
    parentGroup: null,
    rowClass: "account",
    parentAccountId: null,
    mergedIntoAccountId: null,
    relationshipType: "standalone",
    recordStatus: "active",
    countsTowardPotential: true,
    state: "National",
    segment: "Contractor",
    routeToMarket: "direct_ape",
    ownerName: "Validation Owner",
    channelOwner: null,
    fpStatus: "develop",
    priorityTier: "tier_b",
    platformPushDecision: "qualify_first",
    confidenceLevel: "unknown",
    installedBaseStatus: "unknown",
    c4cStatus: "unknown",
  };
}

describe("contractor identity parsing", () => {
  it("splits a named joint venture into its operating participants", () => {
    const parsed = parseContractorIdentity("CPB Contractors and NACAP joint venture");
    expect(parsed.isComposite).toBe(true);
    expect(parsed.operatingNames).toEqual(["CPB Contractors", "NACAP"]);
    expect(parsed.parentNames).toEqual([]);
  });

  it("preserves the operating company and separates parent context", () => {
    expect(parseContractorIdentity("Decmil (Macmahon)")).toMatchObject({
      isComposite: true,
      operatingNames: ["Decmil"],
      parentNames: ["Macmahon"],
    });
    expect(parseContractorIdentity("Thiess (CIMIC Group)")).toMatchObject({
      isComposite: true,
      operatingNames: ["Thiess"],
      parentNames: ["CIMIC Group"],
    });
    expect(parseContractorIdentity("Action Drill & Blast (NRW)")).toMatchObject({
      isComposite: true,
      operatingNames: ["Action Drill & Blast"],
      parentNames: ["NRW"],
    });
  });

  it("treats an abbreviation or market annotation as metadata, not a parent company", () => {
    expect(parseContractorIdentity("DT Infrastructure (DTI)")).toMatchObject({
      isComposite: false,
      operatingNames: ["DT Infrastructure"],
      parentNames: [],
    });
    expect(parseContractorIdentity("Fleetwood Limited (ASX: FWD)")).toMatchObject({
      isComposite: false,
      operatingNames: ["Fleetwood Limited"],
      parentNames: [],
    });
  });

  it("removes alliance and joint-venture vocabulary from distinctive fuzzy tokens", () => {
    expect(significantCompanyTokens("Abergeldie Joint Venture Packages")).toEqual(["abergeldie"]);
    expect(significantCompanyTokens("CPB Contractors and NACAP joint venture")).toEqual(["cpb", "nacap"]);
  });
});

describe("composite contractor matching guardrails", () => {
  it("never fuzzy-matches a whole CPB/NACAP joint venture to Abergeldie", () => {
    const matchIndex = buildFullPotentialMatchIndex([
      account(30153, "Abergeldie Joint Venture Packages"),
      account(2, "CPB Contractors"),
      account(400, "NACAP"),
    ], []);

    const result = resolveFullPotentialCandidate({
      name: "CPB Contractors and NACAP joint venture",
      source: "awarded_project",
      role: "winning_contractor",
      relationshipEvidence: "confirmed",
      confidence: 100,
    }, matchIndex);

    expect(result.match).toBeNull();
    expect(result.unresolved?.reason).toBe("composite_name");
  });

  it("splits the project candidate before matching and keeps both JV participants", () => {
    const matchIndex = buildFullPotentialMatchIndex([
      account(2, "CPB Contractors"),
      account(400, "NACAP"),
      account(30153, "Abergeldie Joint Venture Packages"),
    ], []);

    const context = resolveProjectFullPotentialContext({
      id: 10,
      name: "Awarded Pipeline Package",
      owner: "Pipeline Owner",
      projectState: "WA",
      contractors: [],
    }, matchIndex, { awardedContractor: "CPB Contractors and NACAP joint venture" });

    expect(context.matches.map(match => match.accountId).sort((a, b) => a - b)).toEqual([2, 400]);
    expect(context.matches.some(match => match.accountId === 30153)).toBe(false);
  });

  it("uses the operating entity ahead of lower-confidence parent context", () => {
    const matchIndex = buildFullPotentialMatchIndex([
      account(261, "Action Drill & Blast"),
      account(221, "NRW"),
    ], []);

    const context = resolveProjectFullPotentialContext({
      id: 11,
      name: "Mine Drill and Blast Package",
      owner: null,
      projectState: "WA",
      contractors: [{
        name: "Action Drill & Blast (NRW)",
        status: "confirmed",
        confidence: 95,
        role: "subcontractor",
      }],
    }, matchIndex);

    expect(context.primaryMatch?.accountId).toBe(261);
    expect(context.primaryMatch?.candidateRole).toBe("subcontractor");
    const parent = context.matches.find(match => match.accountId === 221);
    expect(parent?.certainty).not.toBe("confirmed");
  });

  it("extracts alliance participants instead of retaining the whole alliance string", () => {
    const candidates = extractProjectAccountCandidates({
      id: 12,
      name: "Rail Alliance",
      owner: null,
      contractors: [{
        name: "Alliance comprising John Holland Group, Kellogg Brown & Root (KBR), Metro Trains Melbourne",
        status: "confirmed",
        confidence: 100,
      }],
    });

    expect(candidates.map(candidate => candidate.name)).toContain("John Holland Group");
    expect(candidates.map(candidate => candidate.name)).toContain("Kellogg Brown & Root");
    expect(candidates.map(candidate => candidate.name)).toContain("Metro Trains Melbourne");
    expect(candidates.some(candidate => candidate.name.startsWith("Alliance comprising"))).toBe(false);
  });
});
