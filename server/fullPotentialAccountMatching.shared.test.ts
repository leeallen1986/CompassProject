import { describe, expect, it } from "vitest";
import {
  buildFullPotentialMatchIndex,
  companyNameVariants,
  extractProjectAccountCandidates,
  normalizeCompanyName,
  resolveFullPotentialCandidate,
  resolveProjectFullPotentialContext,
  significantCompanyTokens,
  type FullPotentialAccountForMatching,
  type FullPotentialAliasForMatching,
  type FullPotentialAccountRuntimeState,
} from "./fullPotentialAccountMatching.shared";

function account(
  id: number,
  canonicalName: string,
  overrides: Partial<FullPotentialAccountForMatching> = {},
): FullPotentialAccountForMatching {
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
    segment: "Rental Hire",
    routeToMarket: "direct_ape",
    ownerName: "Validation Owner",
    channelOwner: null,
    fpStatus: "develop",
    priorityTier: "tier_b",
    platformPushDecision: "qualify_first",
    fullPotentialAud: null,
    target2026Aud: null,
    remainingPotentialAud: null,
    confidenceLevel: "unknown",
    currentSupplier: null,
    installedBaseStatus: "unknown",
    c4cStatus: "unknown",
    nextAction: null,
    nextActionDate: null,
    ...overrides,
  };
}

function index(
  accounts: FullPotentialAccountForMatching[],
  aliases: FullPotentialAliasForMatching[] = [],
  runtime: Map<number, FullPotentialAccountRuntimeState> = new Map(),
) {
  return buildFullPotentialMatchIndex(accounts, aliases, runtime);
}

describe("Full Potential company-name normalisation", () => {
  it("normalises punctuation and ampersands without losing identity", () => {
    expect(normalizeCompanyName("Tutt Bryant & Co. Pty Ltd")).toBe("tutt bryant and company pty ltd");
    expect(companyNameVariants("Tutt Bryant & Co. Pty Ltd")).toContain("tutt bryant and company");
  });

  it("keeps only distinctive tokens for fuzzy matching", () => {
    expect(significantCompanyTokens("National Equipment Hire Australia")).toEqual([]);
    expect(significantCompanyTokens("Blue Diamond Machinery Australia")).toEqual(["blue", "diamond", "machinery"]);
  });
});

describe("Full Potential canonical account resolution", () => {
  it("resolves an exact canonical name as confirmed", () => {
    const result = resolveFullPotentialCandidate(
      {
        name: "Coates Hire",
        source: "project_contractor",
        role: "contractor",
        relationshipEvidence: "confirmed",
        confidence: 95,
        state: "National",
      },
      index([account(269, "Coates Hire")]),
    );

    expect(result.unresolved).toBeNull();
    expect(result.match?.accountId).toBe(269);
    expect(result.match?.certainty).toBe("confirmed");
    expect(result.match?.matchMethod).toBe("canonical_name");
  });

  it("resolves an exact Full Potential alias", () => {
    const result = resolveFullPotentialCandidate(
      {
        name: "NPE",
        source: "project_contractor",
        role: "contractor",
        relationshipEvidence: "confirmed",
        confidence: 92,
      },
      index(
        [account(313, "National Pump & Energy")],
        [{ accountId: 313, aliasName: "NPE", aliasType: "abbreviation", confidenceLevel: "high" }],
      ),
    );

    expect(result.match?.accountId).toBe(313);
    expect(result.match?.matchMethod).toBe("alias");
  });

  it("maps a merged duplicate name to its retained canonical account", () => {
    const result = resolveFullPotentialCandidate(
      {
        name: "Hirecorp National Operations",
        source: "project_contractor",
        role: "contractor",
        relationshipEvidence: "confirmed",
        confidence: 90,
      },
      index([
        account(60032, "Hirecorp"),
        account(348, "Hirecorp National Operations", {
          mergedIntoAccountId: 60032,
          relationshipType: "duplicate",
          recordStatus: "merged",
          countsTowardPotential: false,
        }),
      ]),
    );

    expect(result.match?.accountId).toBe(60032);
    expect(result.match?.matchedSourceAccountId).toBe(348);
  });

  it("maps a non-counting branch or site row to its counting parent", () => {
    const result = resolveFullPotentialCandidate(
      {
        name: "Coates Pilbara Branch",
        source: "project_contractor",
        role: "rental",
        relationshipEvidence: "confirmed",
      },
      index([
        account(269, "Coates Hire", { relationshipType: "parent" }),
        account(1269, "Coates Pilbara Branch", {
          rowClass: "site_context",
          parentAccountId: 269,
          relationshipType: "branch",
          countsTowardPotential: false,
        }),
      ]),
    );

    expect(result.match?.accountId).toBe(269);
    expect(result.match?.matchedSourceAccountId).toBe(1269);
  });

  it("does not auto-match an excluded standalone record", () => {
    const result = resolveFullPotentialCandidate(
      {
        name: "Parked Placeholder Account",
        source: "project_owner",
        role: "project_owner",
        relationshipEvidence: "confirmed",
      },
      index([
        account(999, "Parked Placeholder Account", {
          recordStatus: "excluded",
          countsTowardPotential: false,
          fpStatus: "exclude",
          routeToMarket: "exclude",
        }),
      ]),
    );

    expect(result.match).toBeNull();
    expect(result.unresolved?.reason).toBe("no_match");
  });

  it("refuses to fuzzy-match a generic company phrase", () => {
    const result = resolveFullPotentialCandidate(
      {
        name: "National Equipment Hire WA Operations",
        source: "project_contractor",
        role: "contractor",
        relationshipEvidence: "predicted",
      },
      index([account(1, "National Equipment Hire Australia")]),
    );

    expect(result.match).toBeNull();
  });

  it("permits a distinctive contained-name match but labels it likely", () => {
    const result = resolveFullPotentialCandidate(
      {
        name: "Blue Diamond Machinery WA Operations",
        source: "project_contractor",
        role: "contractor",
        relationshipEvidence: "predicted",
        confidence: 78,
        state: "WA",
      },
      index([account(288, "Blue Diamond Machinery", { state: "National" })]),
    );

    expect(result.match?.accountId).toBe(288);
    expect(result.match?.matchMethod).toBe("contained_name");
    expect(result.match?.certainty).not.toBe("confirmed");
  });

  it("returns ambiguity rather than silently choosing duplicate canonical names", () => {
    const result = resolveFullPotentialCandidate(
      {
        name: "Joy Hire",
        source: "project_contractor",
        role: "contractor",
        relationshipEvidence: "confirmed",
      },
      index([
        account(271, "Joy Hire", { state: "WA/QLD/NSW" }),
        account(331, "Joy Hire", { state: "National" }),
      ]),
    );

    expect(result.match).toBeNull();
    expect(result.unresolved?.reason).toBe("ambiguous_match");
    expect(result.unresolved?.possibleAccountIds.sort()).toEqual([271, 331]);
  });

  it("includes approved-model, action and pursuit state in the match", () => {
    const runtime = new Map<number, FullPotentialAccountRuntimeState>([
      [269, {
        approvedModelId: 7,
        approvedModelKey: "fp-model:269:v1",
        approvedModelVersion: 1,
        approvedModelPotentialAud: "500000.00",
        approvedModelConfidence: "medium",
        openActionCount: 1,
        nextOpenActionType: "customer_call",
        nextOpenActionDueDate: "2026-08-01",
        activePursuitCount: 1,
        activePursuitStatuses: ["identified"],
      }],
    ]);
    const result = resolveFullPotentialCandidate(
      {
        name: "Coates Hire",
        source: "awarded_project",
        role: "winning_contractor",
        relationshipEvidence: "confirmed",
      },
      index([account(269, "Coates Hire")], [], runtime),
    );

    expect(result.match?.account.approvedModelId).toBe(7);
    expect(result.match?.account.openActionCount).toBe(1);
    expect(result.match?.account.activePursuitCount).toBe(1);
  });
});

describe("Project buying-route resolution", () => {
  const matchIndex = index(
    [
      account(269, "Coates Hire", { priorityTier: "tier_a", platformPushDecision: "push_now" }),
      account(272, "United Rentals", { priorityTier: "tier_a" }),
      account(700, "Mining Owner Limited", { segment: "Mining" }),
    ],
    [
      { accountId: 269, aliasName: "Coates", aliasType: "trading_name" },
      { accountId: 272, aliasName: "United Rental", aliasType: "misspelling" },
    ],
  );

  it("prioritises a confirmed winning contractor over the project owner", () => {
    const context = resolveProjectFullPotentialContext(
      {
        id: 1,
        name: "Awarded Mine Expansion",
        owner: "Mining Owner Limited",
        projectState: "WA",
        contractors: [],
      },
      matchIndex,
      { awardedContractor: "Coates Hire" },
    );

    expect(context.primaryMatch?.accountId).toBe(269);
    expect(context.primaryMatch?.candidateRole).toBe("winning_contractor");
    expect(context.matches.map(match => match.accountId)).toContain(700);
  });

  it("labels a predicted contractor as likely rather than confirmed", () => {
    const context = resolveProjectFullPotentialContext(
      {
        id: 2,
        name: "Early Contractor Package",
        owner: "Mining Owner Limited",
        projectState: "WA",
        contractors: [{ name: "United Rental", status: "predicted", confidence: 76 }],
      },
      matchIndex,
    );

    const united = context.matches.find(match => match.accountId === 272);
    expect(united?.certainty).not.toBe("confirmed");
    expect(united?.candidateRole).toBe("contractor");
  });

  it("uses the project owner as a fallback when no contractor account matches", () => {
    const context = resolveProjectFullPotentialContext(
      {
        id: 3,
        name: "Owner-led Procurement",
        owner: "Mining Owner Limited",
        contractors: [{ name: "Unlisted Civil Contractor", status: "confirmed" }],
      },
      matchIndex,
    );

    expect(context.primaryMatch?.accountId).toBe(700);
    expect(context.primaryMatch?.candidateRole).toBe("project_owner");
    expect(context.unresolvedCandidates.some(candidate => candidate.candidateName === "Unlisted Civil Contractor")).toBe(true);
  });

  it("extracts contractor-registry aliases and contact companies as separate evidence", () => {
    const candidates = extractProjectAccountCandidates(
      { id: 4, name: "Project", owner: null, contractors: [] },
      {
        linkedContractors: [{
          name: "Coates Hire",
          aliases: ["Coates"],
          role: "contractor",
          status: "confirmed",
          confidence: 95,
        }],
        contactCompanies: ["United Rentals"],
      },
    );

    expect(candidates.some(candidate => candidate.name === "Coates" && candidate.source === "contractor_registry")).toBe(true);
    expect(candidates.some(candidate => candidate.name === "United Rentals" && candidate.role === "contact_company")).toBe(true);
  });

  it("keeps a confirmed contractor ahead of a contact-company match", () => {
    const context = resolveProjectFullPotentialContext(
      { id: 5, name: "Project", owner: null, contractors: [] },
      matchIndex,
      {
        linkedContractors: [{ name: "Coates Hire", role: "contractor", status: "confirmed", confidence: 95 }],
        contactCompanies: ["United Rentals"],
      },
    );

    expect(context.primaryMatch?.accountId).toBe(269);
    expect(context.matches[1]?.accountId).toBe(272);
  });
});
