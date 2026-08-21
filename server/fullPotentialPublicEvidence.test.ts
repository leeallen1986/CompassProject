import { describe, expect, it } from "vitest";
import {
  FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  assertFullPotentialPublicEvidenceRecord,
  calculateFullPotentialPublicScenario,
  summarizeFullPotentialPublicEvidence,
  toFullPotentialModelAssumptions,
  type FullPotentialPublicEvidenceRecord,
} from "../shared/fullPotentialPublicEvidence";

function rentalRecord(overrides: Partial<FullPotentialPublicEvidenceRecord> = {}): FullPotentialPublicEvidenceRecord {
  return {
    recordKey: "rental:kennards:portable-air",
    commercialPoolKey: "buyer:kennards:portable-air",
    buyerAccountKey: "kennards-hire-au",
    buyerName: "Kennards Hire",
    buyerSegment: "rental_hire",
    application: "general rental portable air",
    productFamily: "portable_air_small_medium",
    productCell: "rental_portable_air",
    countingTreatment: "buyer_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "fleet_replacement",
    scenarios: {
      low: {
        estimatedFleetUnits: 75,
        replacementSharePct: 30,
        averageSellingPriceAud: 70_000,
        addressableSharePct: 100,
      },
      base: {
        estimatedFleetUnits: 110,
        replacementSharePct: 45,
        averageSellingPriceAud: 70_000,
        addressableSharePct: 100,
      },
      high: {
        estimatedFleetUnits: 150,
        replacementSharePct: 60,
        averageSellingPriceAud: 70_000,
        addressableSharePct: 100,
      },
    },
    evidenceGrade: "A",
    sourceName: "Kennards Hire public catalogue",
    sourceUrl: "https://example.com/kennards-public-catalogue",
    observedAt: "2026-08-21",
    publicObservation: "The public catalogue shows multiple portable compressor bands and a national branch footprint.",
    inference: "A large national rental pool is modelled using a transparent P5 fleet band rather than an exact customer fleet count.",
    modelBand: "P5",
    addressabilityStatus: "addressable_now",
    qualificationGates: [],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
    ...overrides,
  };
}

function highPressureRecord(overrides: Partial<FullPotentialPublicEvidenceRecord> = {}): FullPotentialPublicEvidenceRecord {
  return {
    recordKey: "ts4:specialist-rental:high-pressure-electric",
    commercialPoolKey: "buyer:specialist-rental:ts4",
    buyerAccountKey: "specialist-rental-pool",
    buyerName: "Specialist rental pool",
    buyerSegment: "rental_hire",
    application: "powered high-pressure project air",
    productFamily: "e_air",
    productCell: "TS4_20_25_bar",
    countingTreatment: "buyer_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "adoption_positions",
    scenarios: {
      low: {
        adoptionPositions: 5,
        averageSellingPriceAud: 250_000,
        addressableSharePct: 50,
      },
      base: {
        adoptionPositions: 12,
        averageSellingPriceAud: 275_000,
        addressableSharePct: 60,
      },
      high: {
        adoptionPositions: 20,
        averageSellingPriceAud: 300_000,
        addressableSharePct: 70,
      },
    },
    evidenceGrade: "C",
    sourceName: "Public specialist rental catalogues",
    sourceUrl: "https://example.com/public-high-pressure-fleet",
    observedAt: "2026-08-21",
    publicObservation: "Public catalogues show 20 to 25 bar demand and electric adjacency across specialist rental fleets.",
    inference: "A three-year adoption-position range is modelled without asserting an installed electric fleet.",
    modelBand: "TS4-ADOPTION",
    addressabilityStatus: "conditional_voltage",
    qualificationGates: ["Confirm true 400 or 415 volt factory configuration before treating the product as locally deployable."],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
    ...overrides,
  };
}

describe("Full Potential public-evidence modelling", () => {
  it("calculates Rental Low/Base/High from inferred fleet and replacement assumptions", () => {
    const record = rentalRecord();

    expect(calculateFullPotentialPublicScenario(record, "low")).toEqual({
      scenario: "low",
      modelledThreeYearUnits: 22.5,
      potentialAud: 1_575_000,
    });
    expect(calculateFullPotentialPublicScenario(record, "base")).toEqual({
      scenario: "base",
      modelledThreeYearUnits: 49.5,
      potentialAud: 3_465_000,
    });
    expect(calculateFullPotentialPublicScenario(record, "high")).toEqual({
      scenario: "high",
      modelledThreeYearUnits: 90,
      potentialAud: 6_300_000,
    });
  });

  it("supports direct three-year adoption positions for Tough Stationary", () => {
    const result = calculateFullPotentialPublicScenario(highPressureRecord(), "base");
    expect(result).toEqual({
      scenario: "base",
      modelledThreeYearUnits: 12,
      potentialAud: 1_980_000,
    });
  });

  it("keeps application overlays visible but financially non-counting", () => {
    const overlay: FullPotentialPublicEvidenceRecord = {
      ...rentalRecord(),
      recordKey: "overlay:kennards:mining-shutdown",
      commercialPoolKey: "buyer:kennards:portable-air",
      buyerAccountKey: "kennards-hire-au",
      buyerName: "Kennards Hire",
      application: "temporary electric air for mining shutdowns",
      productFamily: "e_air",
      productCell: "TS2_temporary_electric",
      countingTreatment: "application_overlay_non_counting",
      scenarios: null,
      publicObservation: "Public product material shows temporary electric air can support powered project and shutdown applications.",
      inference: "This is an application overlay on the Rental buyer pool and must not create a second monetary market.",
    };

    const summary = summarizeFullPotentialPublicEvidence([rentalRecord(), overlay]);
    expect(summary.recordCount).toBe(2);
    expect(summary.countingRecordCount).toBe(1);
    expect(summary.nonCountingRecordCount).toBe(1);
    expect(summary.totals.base).toBe(3_465_000);
  });

  it("fails closed when two counting records claim the same commercial pool", () => {
    expect(() => summarizeFullPotentialPublicEvidence([
      rentalRecord(),
      rentalRecord({ recordKey: "rental:kennards:duplicate-line" }),
    ])).toThrow("Duplicate monetary commercialPoolKey buyer:kennards:portable-air");
  });

  it("rejects confidential contact and CRM-style content from public evidence", () => {
    expect(() => assertFullPotentialPublicEvidenceRecord(rentalRecord({
      publicObservation: "Customer told us that buyer@example.com intends to buy ten units.",
    }))).toThrow();

    expect(() => assertFullPotentialPublicEvidenceRecord(rentalRecord({
      inference: "The procurement manager can be reached on 0412 345 678.",
    }))).toThrow();
  });

  it("requires non-counting records to omit monetary scenarios", () => {
    expect(() => assertFullPotentialPublicEvidenceRecord(rentalRecord({
      countingTreatment: "context_non_counting",
    }))).toThrow("non-counting records must not carry monetary scenarios");
  });

  it("keeps portfolio gaps out of monetary totals while retaining the evidence", () => {
    const gap = highPressureRecord({
      recordKey: "ts4:35bar:portfolio-gap",
      commercialPoolKey: "buyer:specialist-rental:35bar-gap",
      productCell: "TS4_35_bar_gap",
      addressabilityStatus: "portfolio_gap",
      publicObservation: "Public high-pressure fleets show demand at 35 bar.",
      inference: "The currently identified electric portfolio does not cover the 35 bar requirement.",
    });

    expect(calculateFullPotentialPublicScenario(gap, "base").potentialAud).toBe(0);
    const summary = summarizeFullPotentialPublicEvidence([gap]);
    expect(summary.qualificationGaps[0]).toMatchObject({
      addressabilityStatus: "portfolio_gap",
      baseAud: 0,
      recordCount: 1,
    });
  });

  it("reconciles management totals by buyer, product and evidence grade", () => {
    const summary = summarizeFullPotentialPublicEvidence([
      rentalRecord(),
      highPressureRecord({
        commercialPoolKey: "buyer:specialist-rental:ts4-distinct",
        recordKey: "ts4:specialist-rental:distinct",
      }),
    ]);

    expect(summary.totals).toEqual({
      low: 2_200_000,
      base: 5_445_000,
      high: 10_500_000,
    });
    expect(summary.byBuyerSegment[0]).toMatchObject({
      key: "rental_hire",
      recordCount: 2,
      baseAud: 5_445_000,
    });
    expect(summary.byEvidenceGrade.map(row => [row.evidenceGrade, row.baseAud])).toEqual([
      ["A", 3_465_000],
      ["C", 1_980_000],
    ]);
  });

  it("bridges the governed scenario contract into existing model-line assumptions", () => {
    const assumptions = toFullPotentialModelAssumptions(rentalRecord());
    expect(assumptions).toMatchObject({
      publicEvidenceMethodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
      publicEvidenceRecordKey: "rental:kennards:portable-air",
      commercialPoolKey: "buyer:kennards:portable-air",
      countingTreatment: "buyer_counting",
      evidenceGrade: "A",
      productCell: "rental_portable_air",
      scenarioBasis: "fleet_replacement",
      addressabilityStatus: "addressable_now",
    });
  });
});
