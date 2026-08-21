import { describe, expect, it } from "vitest";
import {
  FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  type FullPotentialPublicEvidenceRecord,
} from "../shared/fullPotentialPublicEvidence";
import {
  assertFullPotentialManagementViewReconciles,
  buildFullPotentialSeptemberManagementView,
} from "../shared/fullPotentialManagementView";

const SYNTHETIC_ASP = 1_000;

function record(
  overrides: Partial<FullPotentialPublicEvidenceRecord> = {},
): FullPotentialPublicEvidenceRecord {
  return {
    recordKey: "rental:example:core",
    commercialPoolKey: "buyer:example:rental-core",
    buyerAccountKey: "example-rental-au",
    buyerName: "Example Rental",
    buyerSegment: "rental_hire",
    application: "rental fleet replacement",
    productFamily: "other",
    productCell: "rental_portable_air_blended",
    countingTreatment: "buyer_counting",
    valueClass: "named_evidenced_core",
    scenarioBasis: "fleet_replacement",
    scenarios: {
      low: {
        estimatedFleetUnits: 10,
        replacementSharePct: 30,
        averageSellingPriceAud: SYNTHETIC_ASP,
        addressableSharePct: 100,
      },
      base: {
        estimatedFleetUnits: 20,
        replacementSharePct: 50,
        averageSellingPriceAud: SYNTHETIC_ASP,
        addressableSharePct: 100,
      },
      high: {
        estimatedFleetUnits: 30,
        replacementSharePct: 60,
        averageSellingPriceAud: SYNTHETIC_ASP,
        addressableSharePct: 100,
      },
    },
    evidenceGrade: "B",
    sourceName: "Example public source",
    sourceUrl: "https://example.com/public-source",
    observedAt: "2026-08-21",
    publicObservation: "The public catalogue shows a multi-band compressor range.",
    inference: "A transparent band is used without asserting an exact fleet count.",
    modelBand: "P2",
    addressabilityStatus: "addressable_now",
    qualificationGates: [],
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
    ...overrides,
  };
}

describe("Full Potential September management view", () => {
  it("separates named core, conditional value and portfolio gaps", () => {
    const conditional = record({
      recordKey: "mining:example:ts2",
      commercialPoolKey: "buyer:example-miner:ts2",
      buyerAccountKey: "example-miner-au",
      buyerName: "Example Miner",
      buyerSegment: "mining_direct",
      application: "surface mine-spec relocatable electric air",
      productFamily: "e_air",
      productCell: "TS2_surface_mining",
      valueClass: "regional_long_tail",
      scenarioBasis: "adoption_positions",
      scenarios: {
        low: { adoptionPositions: 1, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 50 },
        base: { adoptionPositions: 2, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 60 },
        high: { adoptionPositions: 3, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 70 },
      },
      evidenceGrade: "C",
      modelBand: "TS2-ADOPTION",
      addressabilityStatus: "conditional_compliance",
      qualificationGates: ["Confirm local package compliance before approval."],
    });
    const gap = record({
      recordKey: "gap:35bar",
      commercialPoolKey: "buyer:example-rental:35bar-gap",
      productCell: "TS4_35_bar_gap",
      scenarios: {
        low: { estimatedFleetUnits: 1, replacementSharePct: 100, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 100 },
        base: { estimatedFleetUnits: 2, replacementSharePct: 100, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 100 },
        high: { estimatedFleetUnits: 3, replacementSharePct: 100, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 100 },
      },
      addressabilityStatus: "portfolio_gap",
      publicObservation: "Public specialist rental fleets show demand above the evidenced electric range.",
      inference: "The gap remains visible but carries no monetary value.",
    });

    const view = buildFullPotentialSeptemberManagementView(
      [record(), conditional, gap],
      [{
        buyerSegment: "rental_hire",
        currentRevenueAud: 2_000,
        periodLabel: "rolling 12 months",
        sourceReference: "aggregate-rental-ledger-test",
      }],
    );

    expect(view.headline.namedEvidencedCore).toEqual({
      lowAud: 3_000,
      baseAud: 10_000,
      highAud: 18_000,
    });
    expect(view.headline.regionalLongTail).toEqual({
      lowAud: 500,
      baseAud: 1_200,
      highAud: 2_100,
    });
    expect(view.addressability).toMatchObject({
      addressableNow: { lowAud: 3_000, baseAud: 10_000, highAud: 18_000 },
      conditional: { lowAud: 500, baseAud: 1_200, highAud: 2_100 },
      portfolioGapRecordCount: 1,
    });
    expect(view.buyerSegments.find(row => row.key === "rental_hire")).toMatchObject({
      currentRevenueAud: 2_000,
      currentRevenuePeriod: "rolling 12 months",
      remainingBasePotentialAud: 8_000,
    });
    expect(() => assertFullPotentialManagementViewReconciles(view)).not.toThrow();
  });

  it("keeps non-counting application overlays out of every monetary total", () => {
    const overlay = record({
      recordKey: "overlay:rental:shutdown",
      commercialPoolKey: "buyer:example:rental-core",
      countingTreatment: "application_overlay_non_counting",
      scenarios: null,
      productFamily: "e_air",
      productCell: "TS2_temporary_industrial_overlay",
      application: "temporary electric air for industrial continuity",
    });
    const view = buildFullPotentialSeptemberManagementView([record(), overlay]);
    expect(view.generatedFromRecordCount).toBe(2);
    expect(view.countingRecordCount).toBe(1);
    expect(view.nonCountingRecordCount).toBe(1);
    expect(view.headline.total.baseAud).toBe(10_000);
    expect(view.productCells.find(row => row.key === "TS2_temporary_industrial_overlay"))
      .toMatchObject({ baseAud: 0, recordCount: 1 });
    expect(() => assertFullPotentialManagementViewReconciles(view)).not.toThrow();
  });

  it("rejects duplicate or invalid current-revenue inputs", () => {
    expect(() => buildFullPotentialSeptemberManagementView([record()], [
      { buyerSegment: "rental_hire", currentRevenueAud: 1, periodLabel: "2025", sourceReference: "one" },
      { buyerSegment: "rental_hire", currentRevenueAud: 2, periodLabel: "rolling", sourceReference: "two" },
    ])).toThrow("Duplicate current revenue input");

    expect(() => buildFullPotentialSeptemberManagementView([record()], [
      { buyerSegment: "rental_hire", currentRevenueAud: -1, periodLabel: "2025", sourceReference: "one" },
    ])).toThrow("must be a non-negative number");
  });

  it("shows unobserved allowance separately rather than disguising it as named evidence", () => {
    const allowance = record({
      recordKey: "allowance:rental:unobserved",
      commercialPoolKey: "allowance:rental:unobserved",
      buyerAccountKey: "rental-unobserved-allowance",
      buyerName: "Rental unobserved allowance",
      valueClass: "unobserved_allowance",
      evidenceGrade: "C",
      publicObservation: "The named public core does not cover every regional rental operator.",
      inference: "Any allowance is shown separately and is not represented as a named customer fleet.",
    });
    const view = buildFullPotentialSeptemberManagementView([record(), allowance]);
    expect(view.headline.namedEvidencedCore.baseAud).toBe(10_000);
    expect(view.headline.unobservedAllowance.baseAud).toBe(10_000);
    expect(view.headline.total.baseAud).toBe(20_000);
    expect(() => assertFullPotentialManagementViewReconciles(view)).not.toThrow();
  });
});
