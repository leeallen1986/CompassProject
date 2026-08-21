import { describe, expect, it } from "vitest";
import { FP_PUBLIC_EVIDENCE_METHOD_VERSION } from "../shared/fullPotentialPublicEvidence";
import type { FullPotentialPublicObservationRecord } from "../shared/fullPotentialPublicDraftPack";
import {
  buildAdoptionRestrictedPlanningPack,
  buildRentalRestrictedPlanningPack,
} from "../shared/fullPotentialRestrictedPlanningFactory";

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

function adoptionObservation(
  recordKey: string,
  overrides: Partial<FullPotentialPublicObservationRecord> = {},
): FullPotentialPublicObservationRecord {
  return {
    recordKey,
    commercialPoolKey: `buyer:${recordKey}:electric-adoption`,
    buyerAccountKey: `${recordKey}-au`,
    buyerName: recordKey,
    buyerSegment: "rental_hire",
    application: "incremental electric adoption",
    productFamily: "e_air",
    productCell: "TS4_specialist_rental_electric",
    countingTreatment: "buyer_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "adoption_positions",
    evidenceGrade: "C",
    sourceName: "Example public high-pressure source",
    sourceUrl: "https://example.com/public-high-pressure",
    observedAt: "2026-08-21",
    publicObservation: "The public range shows high-pressure project demand.",
    inference: "A transparent adoption range is used without claiming a current electric fleet.",
    modelBand: "TS4-NAMED-ADOPTION",
    addressabilityStatus: "conditional_compliance",
    qualificationGates: ["Confirm local package compliance."],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
    ...overrides,
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

describe("Adoption restricted planning factory", () => {
  it("expands concise adoption defaults across named buyer pools", () => {
    const pack = buildAdoptionRestrictedPlanningPack(
      [adoptionObservation("buyer-one"), adoptionObservation("buyer-two")],
      {
        planningValueSetRef: "ts4-planning-test-v1",
        adoptionPositions: { low: 1, base: 2, high: 3 },
        averageSellingPriceAud: { low: 1_800, base: 2_000, high: 2_200 },
        addressableSharePct: { low: 50, base: 60, high: 70 },
        planningValueBasis: "machine_only",
        localisationUpliftStatus: "excluded_tbc",
      },
    );

    expect(pack).toHaveLength(2);
    expect(pack[0].scenarios).toEqual({
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
    });
  });

  it("supports a distinct direct-project allowance override", () => {
    const allowanceKey = "allowance:ts4:direct-powered-projects";
    const pack = buildAdoptionRestrictedPlanningPack(
      [
        adoptionObservation("named-buyer"),
        adoptionObservation(allowanceKey, {
          buyerSegment: "mining_direct",
          valueClass: "unobserved_allowance",
        }),
      ],
      {
        planningValueSetRef: "ts4-planning-test-v1",
        adoptionPositions: { low: 1, base: 2, high: 3 },
        averageSellingPriceAud: { low: 1_800, base: 2_000, high: 2_200 },
        addressableSharePct: { low: 50, base: 60, high: 70 },
        planningValueBasis: "machine_only",
        localisationUpliftStatus: "excluded_tbc",
        overrides: [{
          recordKey: allowanceKey,
          adoptionPositions: { low: 1, base: 4, high: 8 },
        }],
      },
    );

    const allowance = pack.find(record => record.recordKey === allowanceKey);
    expect(allowance?.scenarios).toMatchObject({
      low: { adoptionPositions: 1 },
      base: { adoptionPositions: 4 },
      high: { adoptionPositions: 8 },
    });
  });

  it("rejects replacement records, duplicate overrides and orphan overrides", () => {
    expect(() => buildAdoptionRestrictedPlanningPack(
      [observation("rental-one", "P2")],
      {
        planningValueSetRef: "ts4-planning-test-v1",
        adoptionPositions: { low: 1, base: 2, high: 3 },
        averageSellingPriceAud: 2_000,
        addressableSharePct: 60,
        planningValueBasis: "machine_only",
        localisationUpliftStatus: "excluded_tbc",
      },
    )).toThrow("expected adoption_positions");

    expect(() => buildAdoptionRestrictedPlanningPack(
      [adoptionObservation("buyer-one")],
      {
        planningValueSetRef: "ts4-planning-test-v1",
        adoptionPositions: { low: 1, base: 2, high: 3 },
        averageSellingPriceAud: 2_000,
        addressableSharePct: 60,
        planningValueBasis: "machine_only",
        localisationUpliftStatus: "excluded_tbc",
        overrides: [
          { recordKey: "buyer-one", adoptionPositions: { low: 1, base: 2, high: 3 } },
          { recordKey: "buyer-one", adoptionPositions: { low: 2, base: 3, high: 4 } },
        ],
      },
    )).toThrow("Duplicate adoption planning override");

    expect(() => buildAdoptionRestrictedPlanningPack(
      [adoptionObservation("buyer-one")],
      {
        planningValueSetRef: "ts4-planning-test-v1",
        adoptionPositions: { low: 1, base: 2, high: 3 },
        averageSellingPriceAud: 2_000,
        addressableSharePct: 60,
        planningValueBasis: "machine_only",
        localisationUpliftStatus: "excluded_tbc",
        overrides: [{
          recordKey: "unknown-record",
          adoptionPositions: { low: 1, base: 2, high: 3 },
        }],
      },
    )).toThrow("has no buyer-counting observation");
  });
});
