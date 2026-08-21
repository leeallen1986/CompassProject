import { describe, expect, it } from "vitest";
import {
  FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  type FullPotentialPublicScenario,
  type FullPotentialPublicScenarioAssumption,
} from "../shared/fullPotentialPublicEvidence";
import {
  assertFullPotentialPublicObservationRecord,
  materializeFullPotentialDraftPack,
  summarizeFullPotentialPublicObservations,
  type FullPotentialPublicObservationRecord,
  type FullPotentialRestrictedScenarioRecord,
} from "../shared/fullPotentialPublicDraftPack";

const SYNTHETIC_ASP = 1_000;

function observation(
  overrides: Partial<FullPotentialPublicObservationRecord> = {},
): FullPotentialPublicObservationRecord {
  return {
    recordKey: "rental:example:portable-air",
    commercialPoolKey: "buyer:example:portable-air",
    buyerAccountKey: "example-rental-au",
    buyerName: "Example Rental",
    buyerSegment: "rental_hire",
    application: "general rental portable air",
    productFamily: "other",
    productCell: "rental_portable_air_blended",
    countingTreatment: "buyer_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "fleet_replacement",
    evidenceGrade: "B",
    sourceName: "Example public equipment catalogue",
    sourceUrl: "https://example.com/public-compressor-range",
    observedAt: "2026-08-21",
    publicObservation: "The public equipment catalogue lists several portable compressor bands.",
    inference: "A transparent fleet band is used without asserting an exact customer fleet count.",
    modelBand: "P3",
    addressabilityStatus: "addressable_now",
    qualificationGates: [],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
    ...overrides,
  };
}

function scenarios(): Record<FullPotentialPublicScenario, FullPotentialPublicScenarioAssumption> {
  return {
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
  };
}

function planning(
  overrides: Partial<FullPotentialRestrictedScenarioRecord> = {},
): FullPotentialRestrictedScenarioRecord {
  return {
    recordKey: "rental:example:portable-air",
    planningValueSetRef: "rental-planning-test-v1",
    planningValueBasis: "blended_portfolio",
    localisationUpliftStatus: "not_applicable",
    scenarios: scenarios(),
    ...overrides,
  };
}

describe("Full Potential public draft-pack separation", () => {
  it("keeps a source-controlled observation valid without monetary scenarios", () => {
    const record = observation();
    expect(Object.prototype.hasOwnProperty.call(record, "scenarios")).toBe(false);
    expect(() => assertFullPotentialPublicObservationRecord(record)).not.toThrow();
  });

  it("materializes a buyer-counting record only when restricted planning is supplied", () => {
    const result = materializeFullPotentialDraftPack([observation()], [planning()]);
    expect(result).toMatchObject({
      publicObservationCount: 1,
      restrictedPlanningCount: 1,
      planningValueSetRefs: ["rental-planning-test-v1"],
    });
    expect(result.records[0].scenarios?.base.averageSellingPriceAud).toBe(SYNTHETIC_ASP);
    expect(result.planningEnvelopes[0]).toMatchObject({
      planningValueBasis: "blended_portfolio",
      localisationUpliftStatus: "not_applicable",
    });
  });

  it("fails closed when a counting observation has no restricted planning", () => {
    expect(() => materializeFullPotentialDraftPack([observation()], []))
      .toThrow("Buyer-counting observation rental:example:portable-air is missing restricted planning");
  });

  it("rejects orphan and duplicate restricted planning records", () => {
    expect(() => materializeFullPotentialDraftPack(
      [observation()],
      [planning({ recordKey: "rental:unknown:portable-air" })],
    )).toThrow("has no public observation");

    expect(() => materializeFullPotentialDraftPack(
      [observation()],
      [planning(), planning()],
    )).toThrow("Duplicate restricted planning recordKey");
  });

  it("keeps non-counting application overlays free of restricted values", () => {
    const overlay = observation({
      recordKey: "overlay:example:mining-shutdown",
      commercialPoolKey: "buyer:example:portable-air",
      countingTreatment: "application_overlay_non_counting",
      application: "temporary electric air for a powered mining shutdown",
      productFamily: "e_air",
      productCell: "TS2_temporary_electric",
    });

    const result = materializeFullPotentialDraftPack([overlay], []);
    expect(result.records[0].scenarios).toBeNull();
    expect(result.planningEnvelopes).toEqual([]);

    expect(() => materializeFullPotentialDraftPack([overlay], [planning({
      recordKey: overlay.recordKey,
    })])).toThrow("Non-counting observation overlay:example:mining-shutdown must not have restricted planning");
  });

  it("rejects current AUD values embedded in public observation text", () => {
    expect(() => assertFullPotentialPublicObservationRecord(observation({
      inference: "Use AUD 100000 as the current commercial planning value.",
    }))).toThrow("must not contain current AUD planning values");

    expect(() => assertFullPotentialPublicObservationRecord(observation({
      qualificationGates: ["Local package uplift is A$25000."],
    }))).toThrow("must not contain current AUD planning values");
  });

  it("summarizes public coverage without exposing monetary totals", () => {
    const context = observation({
      recordKey: "context:example:branch",
      commercialPoolKey: null,
      buyerAccountKey: "example-rental-au",
      buyerName: "Example Rental",
      countingTreatment: "context_non_counting",
      modelBand: null,
    });
    const summary = summarizeFullPotentialPublicObservations([observation(), context]);
    expect(summary).toMatchObject({
      recordCount: 2,
      countingRecordCount: 1,
      nonCountingRecordCount: 1,
      byBuyerSegment: [{ key: "rental_hire", count: 2 }],
    });
    expect(summary.byModelBand).toEqual([
      { key: "P3", count: 1 },
      { key: "unbanded", count: 1 },
    ]);
  });
});
