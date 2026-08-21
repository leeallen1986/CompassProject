import { describe, expect, it } from "vitest";
import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type {
  FullPotentialPublicObservationRecord,
  FullPotentialRestrictedScenarioRecord,
} from "../shared/fullPotentialPublicDraftPack";
import {
  buildFullPotentialDraftImportManifest,
  verifyFullPotentialDraftImportManifest,
  type FullPotentialImportAccountTarget,
} from "./fullPotentialPublicImportManifest";

const SYNTHETIC_ASP = 1_000;

function observation(
  overrides: Partial<FullPotentialPublicObservationRecord> = {},
): FullPotentialPublicObservationRecord {
  return {
    recordKey: "rental:example:public-core-v1",
    commercialPoolKey: "buyer:example:rental-portable-air",
    buyerAccountKey: "example-rental-au",
    buyerName: "Example Rental",
    buyerSegment: "rental_hire",
    application: "rental portable-air fleet replacement and refresh",
    productFamily: "other",
    productCell: "rental_portable_air_blended",
    countingTreatment: "buyer_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "fleet_replacement",
    evidenceGrade: "B",
    sourceName: "Example public catalogue",
    sourceUrl: "https://example.com/public-catalogue",
    observedAt: "2026-08-21",
    publicObservation: "The public catalogue shows multiple portable compressor bands.",
    inference: "A transparent P3 band is used without asserting an exact customer fleet count.",
    modelBand: "P3",
    addressabilityStatus: "addressable_now",
    qualificationGates: [],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
    ...overrides,
  };
}

function electricObservation(
  overrides: Partial<FullPotentialPublicObservationRecord> = {},
): FullPotentialPublicObservationRecord {
  return observation({
    recordKey: "rental:example:ts4-electric-adoption",
    commercialPoolKey: "buyer:example:ts4-electric-adoption",
    application: "incremental high-pressure electric rental-fleet adoption",
    productFamily: "e_air",
    productCell: "TS4_specialist_rental_electric",
    scenarioBasis: "adoption_positions",
    evidenceGrade: "C",
    modelBand: "TS4-NAMED-ADOPTION",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: ["Confirm local package compliance before approval."],
    ...overrides,
  });
}

function planning(
  overrides: Partial<FullPotentialRestrictedScenarioRecord> = {},
): FullPotentialRestrictedScenarioRecord {
  return {
    recordKey: "rental:example:public-core-v1",
    planningValueSetRef: "rental-planning-test-v1",
    planningValueBasis: "blended_portfolio",
    localisationUpliftStatus: "not_applicable",
    scenarios: {
      low: {
        estimatedFleetUnits: 16,
        replacementSharePct: 30,
        averageSellingPriceAud: SYNTHETIC_ASP,
        addressableSharePct: 50,
      },
      base: {
        estimatedFleetUnits: 23,
        replacementSharePct: 45,
        averageSellingPriceAud: SYNTHETIC_ASP,
        addressableSharePct: 60,
      },
      high: {
        estimatedFleetUnits: 30,
        replacementSharePct: 60,
        averageSellingPriceAud: SYNTHETIC_ASP,
        addressableSharePct: 70,
      },
    },
    ...overrides,
  };
}

function electricPlanning(
  overrides: Partial<FullPotentialRestrictedScenarioRecord> = {},
): FullPotentialRestrictedScenarioRecord {
  return {
    recordKey: "rental:example:ts4-electric-adoption",
    planningValueSetRef: "electric-planning-test-v1",
    planningValueBasis: "machine_only",
    localisationUpliftStatus: "excluded_tbc",
    scenarios: {
      low: {
        adoptionPositions: 1,
        averageSellingPriceAud: 1_800,
        addressableSharePct: 50,
      },
      base: {
        adoptionPositions: 2,
        averageSellingPriceAud: 2_000,
        addressableSharePct: 60,
      },
      high: {
        adoptionPositions: 3,
        averageSellingPriceAud: 2_200,
        addressableSharePct: 70,
      },
    },
    ...overrides,
  };
}

function target(
  overrides: Partial<FullPotentialImportAccountTarget> = {},
): FullPotentialImportAccountTarget {
  return {
    buyerAccountKey: "example-rental-au",
    accountId: 101,
    stableKey: "example-rental|account|au|national|direct_ape",
    routeToMarket: "direct_ape",
    countsTowardPotential: true,
    recordStatus: "active",
    rowClass: "account",
    ...overrides,
  };
}

function manifestInput() {
  return {
    publicObservations: [observation()],
    restrictedPlanning: [planning()],
    accountTargets: [target()],
    generatedAt: "2026-08-21T12:00:00.000Z",
    generatedByRef: "controller-review-v1",
    sourcePackRef: "fp-rental-public-core-v1",
  };
}

describe("Full Potential draft import manifest", () => {
  it("creates deterministic draft proposals without approvals or side effects", () => {
    const first = buildFullPotentialDraftImportManifest(manifestInput());
    const second = buildFullPotentialDraftImportManifest(manifestInput());

    expect(first.manifestSha256).toBe(second.manifestSha256);
    expect(first).toMatchObject({
      version: 2,
      safetyMode: "draft_only_no_writes",
      publicObservationCount: 1,
      restrictedPlanningCount: 1,
      buyerCountingCount: 1,
      importEligibleBuyerCountingCount: 1,
      distinctBuyerAccountCount: 1,
      commercialPoolCount: 1,
      managementOnlyRecordCount: 0,
      managementOnlyMonetaryRecordCount: 0,
      invariants: {
        allStatusesDraft: true,
        oneModelPerAccount: true,
        multipleDistinctPoolsPerBuyerAllowed: true,
        unobservedAllowanceImportProposals: 0,
        approvalsProposed: 0,
        accountMutationsProposed: 0,
        crmWritesProposed: 0,
        pipelineInvocationsProposed: 0,
        providerCallsProposed: 0,
      },
    });
    expect(first.evidenceProposals).toHaveLength(2);
    expect(first.evidenceProposals.map(row => row.evidenceType).sort()).toEqual([
      "financial_assumption",
      "public_source",
    ]);
    expect(first.modelProposals).toHaveLength(1);
    expect(first.lineProposals).toHaveLength(1);
    expect(first.lineProposals[0]).toMatchObject({
      recordKey: "rental:example:public-core-v1",
      commercialPoolKey: "buyer:example:rental-portable-air",
      accountId: 101,
      productCell: "rental_portable_air_blended",
      estimatedTotalFleetUnits: 23,
      baseThreeYearUnits: 10.35,
      basePotentialAud: 6_210,
      averageSellingPriceAud: SYNTHETIC_ASP,
      addressableSharePct: 60,
      status: "draft",
    });
    expect(first.lineProposals[0].annualReplacementUnits).toBe(3.45);
    expect(() => verifyFullPotentialDraftImportManifest(first)).not.toThrow();
  });

  it("creates one account model with several distinct commercial-pool lines", () => {
    const manifest = buildFullPotentialDraftImportManifest({
      ...manifestInput(),
      publicObservations: [observation(), electricObservation()],
      restrictedPlanning: [planning(), electricPlanning()],
    });

    expect(manifest).toMatchObject({
      buyerCountingCount: 2,
      importEligibleBuyerCountingCount: 2,
      distinctBuyerAccountCount: 1,
      commercialPoolCount: 2,
      managementOnlyMonetaryRecordCount: 0,
    });
    expect(manifest.modelProposals).toHaveLength(1);
    expect(manifest.lineProposals).toHaveLength(2);
    expect(manifest.evidenceProposals).toHaveLength(4);
    expect(manifest.accountTargetSnapshot).toHaveLength(1);
    expect(manifest.lineProposals.map(row => row.productCell).sort()).toEqual([
      "TS4_specialist_rental_electric",
      "rental_portable_air_blended",
    ]);
    expect(() => verifyFullPotentialDraftImportManifest(manifest)).not.toThrow();
  });

  it("keeps non-counting application evidence management-only", () => {
    const overlay = observation({
      recordKey: "overlay:rental:temporary-electric",
      commercialPoolKey: "buyer:example:rental-portable-air",
      countingTreatment: "application_overlay_non_counting",
      productFamily: "e_air",
      productCell: "TS2_temporary_industrial_overlay",
      application: "temporary electric air for industrial continuity",
    });
    const manifest = buildFullPotentialDraftImportManifest({
      ...manifestInput(),
      publicObservations: [observation(), overlay],
    });
    expect(manifest.managementOnlyRecordCount).toBe(1);
    expect(manifest.managementOnlyRecordKeys).toEqual([
      "overlay:rental:temporary-electric",
    ]);
    expect(manifest.lineProposals).toHaveLength(1);
  });

  it("keeps unobserved monetary allowances out of account import", () => {
    const allowance = electricObservation({
      recordKey: "allowance:ts4:direct-powered-projects",
      commercialPoolKey: "allowance:ts4:direct-powered-projects",
      buyerAccountKey: "ts4-direct-powered-project-allowance",
      buyerName: "TS4 direct powered-project allowance",
      buyerSegment: "mining_direct",
      valueClass: "unobserved_allowance",
      productCell: "TS4_direct_powered_project_allowance",
    });
    const allowancePlanning = electricPlanning({
      recordKey: allowance.recordKey,
    });

    const manifest = buildFullPotentialDraftImportManifest({
      ...manifestInput(),
      publicObservations: [observation(), allowance],
      restrictedPlanning: [planning(), allowancePlanning],
      accountTargets: [target()],
    });

    expect(manifest).toMatchObject({
      buyerCountingCount: 2,
      importEligibleBuyerCountingCount: 1,
      distinctBuyerAccountCount: 1,
      commercialPoolCount: 1,
      managementOnlyRecordCount: 1,
      managementOnlyMonetaryRecordCount: 1,
    });
    expect(manifest.managementOnlyRecordKeys).toEqual([
      "allowance:ts4:direct-powered-projects",
    ]);
    expect(manifest.lineProposals).toHaveLength(1);
    expect(manifest.modelProposals).toHaveLength(1);
    expect(() => verifyFullPotentialDraftImportManifest(manifest)).not.toThrow();
  });

  it("fails closed when the canonical account target is missing or ineligible", () => {
    expect(() => buildFullPotentialDraftImportManifest({
      ...manifestInput(),
      accountTargets: [],
    })).toThrow("No eligible account target for buyer example-rental-au");

    expect(() => buildFullPotentialDraftImportManifest({
      ...manifestInput(),
      accountTargets: [target({ countsTowardPotential: false })],
    })).toThrow("is not eligible for a draft model");

    expect(() => buildFullPotentialDraftImportManifest({
      ...manifestInput(),
      accountTargets: [target({ rowClass: "site_context" })],
    })).toThrow("is not eligible for a draft model");
  });

  it("rejects distinct buyer identities assigned to one account target", () => {
    expect(() => buildFullPotentialDraftImportManifest({
      ...manifestInput(),
      accountTargets: [
        target(),
        target({
          buyerAccountKey: "different-buyer-au",
          stableKey: "different-buyer|account|au|national|direct_ape",
        }),
      ],
    })).toThrow("assigned to distinct buyer keys");
  });

  it("rejects tampered or non-draft manifests", () => {
    const manifest = buildFullPotentialDraftImportManifest(manifestInput());
    expect(() => verifyFullPotentialDraftImportManifest({
      ...manifest,
      generatedByRef: "tampered-ref",
    })).toThrow("SHA-256 mismatch");

    const changedStatus = structuredClone(manifest);
    changedStatus.evidenceProposals[0].status = "approved" as never;
    expect(() => verifyFullPotentialDraftImportManifest(changedStatus))
      .toThrow();
  });

  it("requires opaque non-sensitive manifest references", () => {
    expect(() => buildFullPotentialDraftImportManifest({
      ...manifestInput(),
      sourcePackRef: "contains a space",
    })).toThrow("sourcePackRef must be an opaque non-sensitive reference");
  });
});
