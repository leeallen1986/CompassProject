import { describe, expect, it } from "vitest";
import {
  buildRentalCoverageCensus,
  normalizeCoverageAccountName,
  normalizeCoverageAccountNameLoose,
  reconcileRentalCoverageCandidates,
  resolveCoverageRoot,
  type RentalCoverageAccountInput,
} from "./fullPotentialRentalCoverageCensus";

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
    nextAction: "Validate fleet",
    nextActionDate: "2026-08-01T00:00:00Z",
    activeInMyWeek: true,
    isRentalHire: true,
    expectedOwnerNames: ["Ryan Pemberton"],
    ownershipModel: "single_territory",
    ownerAlignment: "aligned",
    ownershipReviewReason: null,
    ...overrides,
  };
}

describe("Rental Hire coverage root resolution", () => {
  it("follows merge and parent relationships to one canonical root", () => {
    const rows = [
      account({ id: 1 }),
      account({ id: 2, canonicalName: "Example Rental WA Branch", relationshipType: "branch", parentAccountId: 1, countsTowardPotential: false }),
      account({ id: 3, canonicalName: "Example Rental Duplicate", relationshipType: "duplicate", recordStatus: "merged", mergedIntoAccountId: 2, countsTowardPotential: false }),
    ];
    const map = new Map(rows.map(row => [row.id, row]));
    expect(resolveCoverageRoot(3, map)).toEqual({ rootAccountId: 1, path: [3, 2, 1], issues: [] });
  });

  it("fails visibly on relationship cycles and missing targets", () => {
    const a = account({ id: 1, parentAccountId: 2 });
    const b = account({ id: 2, parentAccountId: 1 });
    const cycle = resolveCoverageRoot(1, new Map([[1, a], [2, b]]));
    expect(cycle.issues).toContain("relationship_cycle");

    const missing = resolveCoverageRoot(1, new Map([[1, account({ id: 1, parentAccountId: 99 })]]));
    expect(missing.issues).toContain("missing_relationship_target");
  });
});

describe("Rental Hire coverage census", () => {
  it("separates counting parents from branch context and exposes actionable gaps", () => {
    const parent = account();
    const branch = account({
      id: 2,
      stableKey: "example-branch",
      canonicalName: "Example Rental Group — Kalgoorlie",
      relationshipType: "branch",
      parentAccountId: 1,
      countsTowardPotential: false,
      state: "WA",
      priorityTier: "tier_c",
      platformPushDecision: "push_context",
    });
    const gapAccount = account({
      id: 3,
      stableKey: "gap-hire",
      canonicalName: "Gap Hire",
      state: null,
      applicationPlays: [],
      routeToMarket: "manual_review",
      ownerName: null,
      ownerAlignment: "unassigned",
      expectedOwnerNames: [],
      ownershipModel: "manual_review",
      installedBaseStatus: "unknown",
      currentSupplier: null,
      currentRevenueAud: null,
      fullPotentialAud: null,
      target2026Aud: null,
      remainingPotentialAud: null,
      evidenceSources: [],
      priorityTier: "tier_a",
    });

    const result = buildRentalCoverageCensus({
      allAccounts: [parent, branch, gapAccount],
      aliases: [{ id: 1, accountId: 1, aliasName: "Example Hire" }],
      actions: [{ id: 1, accountId: 1, status: "in_progress" }],
      signals: [{ id: 1, accountId: 1, status: "new" }],
      evidence: [{ id: 1, accountId: 1, status: "verified" }],
    }, new Date("2026-07-25T10:00:00Z"));

    expect(result.summary).toMatchObject({
      totalAccountsRead: 3,
      rentalRows: 3,
      canonicalGroups: 2,
      countingRentalAccounts: 2,
      childContextRows: 1,
    });
    const parentRow = result.rows.find(row => row.accountId === 1)!;
    expect(parentRow.childRecordCount).toBe(1);
    expect(parentRow.aliasCount).toBe(1);
    expect(parentRow.openActionCount).toBe(1);
    expect(parentRow.liveSignalCount).toBe(1);
    expect(parentRow.verifiedEvidenceCount).toBe(1);

    const gapRow = result.rows.find(row => row.accountId === 3)!;
    expect(gapRow.gapCodes).toEqual(expect.arrayContaining([
      "missing_state",
      "ownership_review",
      "route_manual_review",
      "product_fit_missing",
      "installed_base_unknown",
      "supplier_missing",
      "financial_potential_missing",
      "evidence_missing",
      "verified_evidence_missing",
      "priority_action_missing",
      "alias_coverage_missing",
    ]));
    expect(gapRow.criticalGapCount).toBeGreaterThan(0);
    expect(result.gapQueue[0].criticalGapCount).toBeGreaterThanOrEqual(result.gapQueue.at(-1)!.criticalGapCount);
  });

  it("does not count closed actions or archived signals as live coverage", () => {
    const result = buildRentalCoverageCensus({
      allAccounts: [account()],
      aliases: [],
      actions: [{ id: 1, accountId: 1, status: "completed" }],
      signals: [{ id: 1, accountId: 1, status: "archived" }],
      evidence: [],
    });
    expect(result.rows[0].openActionCount).toBe(0);
    expect(result.rows[0].liveSignalCount).toBe(0);
    expect(result.rows[0].gapCodes).toContain("priority_action_missing");
  });
});

describe("external candidate reconciliation", () => {
  const accounts = [
    account({ id: 1, canonicalName: "Coates Hire", displayName: "Coates" }),
    account({ id: 2, canonicalName: "ABC Equipment Rental Pty Ltd", displayName: "ABC Rental" }),
    account({ id: 3, canonicalName: "National Hire Group" }),
    account({ id: 4, canonicalName: "National Hire Services" }),
  ];
  const aliases = [
    { id: 1, accountId: 1, aliasName: "Coates" },
    { id: 2, accountId: 2, aliasName: "ABC Hire" },
  ];

  it("normalizes identity deterministically", () => {
    expect(normalizeCoverageAccountName("ABC Equipment & Rental Pty. Ltd.")).toBe("abc equipment and rental pty ltd");
    expect(normalizeCoverageAccountNameLoose("ABC Equipment Rental Pty Ltd Australia")).toBe("abc equipment rental");
  });

  it("classifies exact, loose, branch, new, ambiguous and excluded candidates without writing", () => {
    const results = reconcileRentalCoverageCandidates([
      { candidateName: "Coates" },
      { candidateName: "ABC Equipment Rental Limited" },
      { candidateName: "Coates Kalgoorlie", parentName: "Coates Hire", state: "WA" },
      { candidateName: "New Regional Compressor Hire" },
      { candidateName: "National Hire" },
      { candidateName: "Party Balloon Hire", excludeReason: "No portable-air fit" },
    ], accounts, aliases);

    const byName = new Map(results.map(result => [result.candidateName, result]));
    expect(byName.get("Coates")?.disposition).toBe("existing_account");
    expect(byName.get("ABC Equipment Rental Limited")?.disposition).toBe("possible_existing_account");
    expect(byName.get("Coates Kalgoorlie")?.disposition).toBe("branch_or_site_candidate");
    expect(byName.get("New Regional Compressor Hire")?.disposition).toBe("new_account_candidate");
    expect(byName.get("National Hire")?.disposition).toBe("new_account_candidate");
    expect(byName.get("Party Balloon Hire")?.disposition).toBe("excluded_by_source");
  });

  it("keeps ambiguous matches unresolved", () => {
    const ambiguousAccounts = [
      account({ id: 10, canonicalName: "Test Hire Pty Ltd" }),
      account({ id: 11, canonicalName: "Test Hire Limited" }),
    ];
    const [result] = reconcileRentalCoverageCandidates([{ candidateName: "Test Hire" }], ambiguousAccounts, []);
    expect(result.disposition).toBe("ambiguous_manual_review");
    expect(result.matchedAccountIds).toEqual([10, 11]);
  });
});
