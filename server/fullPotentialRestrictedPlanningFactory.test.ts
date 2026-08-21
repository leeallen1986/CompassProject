import { describe, expect, it } from "vitest";
import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type { FullPotentialPublicObservationRecord } from "../shared/fullPotentialPublicDraftPack";
import { buildRentalRestrictedPlanningPack } from "../shared/fullPotentialRestrictedPlanningFactory";

function observation(
  recordKey: string,
  modelBand: "P1" | "P2" | "P3" | "P4" | "P5",
): FullPotentialPublicObservationRecord {
  return {
    recordKey,
    commercialPoolKey: `buyer:${recordKey}:portable-air`,
    buyerAccountKey: `${recordKey}-au`,
    buyerName: recordKey,
    buyerSegment: "rental_hire",
    application: "rental portable-air fleet replacement and refresh",
    productFamily: "other",
    productCell: "rental_portable_air_blended",
    countingTreatment: "buyer_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "fleet_replacement",
    evidenceGrade: "B",
    sourceName: "Example public source",
    sourceUrl: "https://example.com/public-source",
    observedAt: "2026-08-21",
    publicObservation: "The public catalogue shows portable compressor bands.",
    inference: "A transparent band is used without asserting an exact fleet count.",
    modelBand,
    addressabilityStatus: "addressable_now",
    qualificationGates: [],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  };
}

describe("Rental restricted planning factory", () => {
  it("expands concise private defaults across P-band public observations", () => {
    const pack = buildRentalRestrictedPlanningPack(
      [observation("rental-one", "P1"), observation("rental-five", "P5")],
      {
        planningValueSetRef: "rental-planning-test-v1",
        averageSellingPriceAud: 1_000,
        addressableSharePct: { low: 50, base: 60, high: 70 },
        planningValueBasis: "blended_portfolio",
        localisationUpliftStatus: "not_applicable",
      },
    );

    expect(pack).toHaveLength(2);
    expect(pack[0].recordKey).toBe("rental-five");
    expect(pack[0].scenarios).toMatchObject({
      low: {
        estimatedFleetUnits: 75,
        replacementSharePct: 30,
        averageSellingPriceAud: 1_000,
        addressableSharePct: 50,
      },
      base: {
        estimatedFleetUnits: 110,
        replacementSharePct: 45,
        averageSellingPriceAud: 1_000,
        addressableSharePct: 60,
      },
      high: {
        estimatedFleetUnits: 150,
        replacementSharePct: 60,
        averageSellingPriceAud: 1_000,
        addressableSharePct: 70,
      },
    });
  });

  it("supports per-account planning overrides without changing public bands", () => {
    const pack = buildRentalRestrictedPlanningPack(
      [observation("rental-one", "P2")],
      {
        planningValueSetRef: "rental-planning-test-v1",
        averageSellingPriceAud: 1_000,
        addressableSharePct: 50,
        planningValueBasis: "blended_portfolio",
        localisationUpliftStatus: "not_applicable",
        overrides: [{
          recordKey: "rental-one",
          averageSellingPriceAud: { low: 900, base: 1_100, high: 1_300 },
          addressableSharePct: { low: 40, base: 55, high: 65 },
          replacementSharePct: { base: 50 },
          planningValueBasis: "machine_only",
          localisationUpliftStatus: "excluded_tbc",
        }],
      },
    );

    expect(pack[0]).toMatchObject({
      planningValueBasis: "machine_only",
      localisationUpliftStatus: "excluded_tbc",
      scenarios: {
        low: {
          estimatedFleetUnits: 6,
          replacementSharePct: 30,
          averageSellingPriceAud: 900,
          addressableSharePct: 40,
        },
        base: {
          estimatedFleetUnits: 10,
          replacementSharePct: 50,
          averageSellingPriceAud: 1_100,
          addressableSharePct: 55,
        },
        high: {
          estimatedFleetUnits: 15,
          replacementSharePct: 60,
          averageSellingPriceAud: 1_300,
          addressableSharePct: 65,
        },
      },
    });
  });

  it("rejects non-Rental, non-replacement and unbanded observations", () => {
    expect(() => buildRentalRestrictedPlanningPack(
      [{ ...observation("mining", "P2"), buyerSegment: "mining_direct" }],
      {
        planningValueSetRef: "rental-planning-test-v1",
        averageSellingPriceAud: 1_000,
        addressableSharePct: 50,
        planningValueBasis: "blended_portfolio",
        localisationUpliftStatus: "not_applicable",
      },
    )).toThrow("expected rental_hire fleet_replacement");

    expect(() => buildRentalRestrictedPlanningPack(
      [{ ...observation("unbanded", "P2"), modelBand: null }],
      {
        planningValueSetRef: "rental-planning-test-v1",
        averageSellingPriceAud: 1_000,
        addressableSharePct: 50,
        planningValueBasis: "blended_portfolio",
        localisationUpliftStatus: "not_applicable",
      },
    )).toThrow("requires a P1-P5 model band");
  });

  it("rejects invalid or orphan overrides", () => {
    expect(() => buildRentalRestrictedPlanningPack(
      [observation("rental-one", "P2")],
      {
        planningValueSetRef: "contains a space",
        averageSellingPriceAud: 1_000,
        addressableSharePct: 50,
        planningValueBasis: "blended_portfolio",
        localisationUpliftStatus: "not_applicable",
      },
    )).toThrow("opaque non-sensitive reference");

    expect(() => buildRentalRestrictedPlanningPack(
      [observation("rental-one", "P2")],
      {
        planningValueSetRef: "rental-planning-test-v1",
        averageSellingPriceAud: 1_000,
        addressableSharePct: 50,
        planningValueBasis: "blended_portfolio",
        localisationUpliftStatus: "not_applicable",
        overrides: [{ recordKey: "unknown-record", averageSellingPriceAud: 2_000 }],
      },
    )).toThrow("has no buyer-counting observation");
  });

  it("rejects percentages above one hundred", () => {
    expect(() => buildRentalRestrictedPlanningPack(
      [observation("rental-one", "P2")],
      {
        planningValueSetRef: "rental-planning-test-v1",
        averageSellingPriceAud: 1_000,
        addressableSharePct: 101,
        planningValueBasis: "blended_portfolio",
        localisationUpliftStatus: "not_applicable",
      },
    )).toThrow("cannot exceed 100");
  });
});
