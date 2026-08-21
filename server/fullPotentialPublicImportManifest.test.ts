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
      version: 1,
      safetyMode: "draft_only_no_writes",
      publicObservationCount: 1,
      restrictedPlanningCount: 1,
      buyerCountingCount: 1,
      managementOnlyRecordCount: 0,
      invariants: {
        allStatusesDraft: true,
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
      accountId: 101,
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

  it("keeps non-counting application evidence management-only", () => {
    const overlay = observation({
      recordKey: "overlay:rental:temporary-electric",
      commercialPoolKey: "buyer:example:rental-portable-air",
      countingTreatment: "application_overlay_non_counting",
      scenarios: undefined as never,
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

  it("rejects tampered or non-draft manifests", () => {
    const manifest = buildFullPotentialDraftImportManifest(manifestInput());
    expect(() => verifyFullPotentialDraftImportManifest({
      ...manifest,
      generatedByRef: "tampered-ref",
    })).toThrow("SHA-256 mismatch");

    const changedStatus = structuredClone(manifest);
    changedStatus.evidenceProposals[0].status = "approved" as never;
    const unsigned = { ...changedStatus, manifestSha256: manifest.manifestSha256 };
    expect(() => verifyFullPotentialDraftImportManifest(unsigned))
      .toThrow();
  });

  it("requires opaque non-sensitive manifest references", () => {
    expect(() => buildFullPotentialDraftImportManifest({
      ...manifestInput(),
      sourcePackRef: "contains a space",
    })).toThrow("sourcePackRef must be an opaque non-sensitive reference");
  });
});
