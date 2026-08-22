import { describe, expect, it } from "vitest";
import { FP_RENTAL_FLEET_BANDS, type FullPotentialRentalFleetBand } from "../shared/fullPotentialPublicBands";
import {
  assertFullPotentialPublicObservationRecord,
  summarizeFullPotentialPublicObservations,
} from "../shared/fullPotentialPublicDraftPack";
import {
  FP_RENTAL_PUBLIC_CORE_V1,
  FP_RENTAL_PUBLIC_MARKET_CONTEXT_V1,
} from "./fullPotentialRentalPublicCore";

function fleetUniverse(scenario: "low" | "base" | "high"): number {
  return FP_RENTAL_PUBLIC_CORE_V1.reduce((sum, record) => {
    const band = record.modelBand as FullPotentialRentalFleetBand;
    return sum + FP_RENTAL_FLEET_BANDS[band][scenario];
  }, 0);
}

describe("Rental Hire public-evidence core", () => {
  it("contains exactly 24 unique buyer-counting public observations", () => {
    expect(FP_RENTAL_PUBLIC_CORE_V1).toHaveLength(24);
    expect(new Set(FP_RENTAL_PUBLIC_CORE_V1.map(record => record.recordKey)).size).toBe(24);
    expect(new Set(FP_RENTAL_PUBLIC_CORE_V1.map(record => record.commercialPoolKey)).size).toBe(24);
    expect(FP_RENTAL_PUBLIC_CORE_V1.every(record => record.countingTreatment === "buyer_counting")).toBe(true);
    expect(FP_RENTAL_PUBLIC_CORE_V1.every(record => record.valueClass === "named_evidenced_core")).toBe(true);
    expect(FP_RENTAL_PUBLIC_CORE_V1.some(record => record.buyerName === "Mobile Compressed Air")).toBe(false);
  });

  it("validates every source-controlled buyer record and keeps monetary scenarios absent", () => {
    for (const record of FP_RENTAL_PUBLIC_CORE_V1) {
      expect(() => assertFullPotentialPublicObservationRecord(record)).not.toThrow();
      expect(Object.prototype.hasOwnProperty.call(record, "scenarios")).toBe(false);
      expect(record.sourceUrl.startsWith("https://")).toBe(true);
    }

    const serialized = JSON.stringify(FP_RENTAL_PUBLIC_CORE_V1);
    expect(serialized).not.toContain("averageSellingPriceAud");
    expect(serialized).not.toMatch(/\bAUD\b|A\$\s*\d|\$\s*\d/);
  });

  it("locks the corrected P-band distribution", () => {
    const summary = summarizeFullPotentialPublicObservations(FP_RENTAL_PUBLIC_CORE_V1);
    expect(summary.byModelBand).toEqual([
      { key: "P2", count: 10 },
      { key: "P3", count: 6 },
      { key: "P4", count: 3 },
      { key: "P5", count: 3 },
      { key: "P1", count: 2 },
    ]);
  });

  it("reconciles the corrected named relevant-fleet universe without asserting exact fleets", () => {
    expect(fleetUniverse("low")).toBe(476);
    expect(fleetUniverse("base")).toBe(724);
    expect(fleetUniverse("high")).toBe(1_015);
  });

  it("keeps the buyer core wholly within the Rental buyer segment", () => {
    const summary = summarizeFullPotentialPublicObservations(FP_RENTAL_PUBLIC_CORE_V1);
    expect(summary).toMatchObject({
      recordCount: 24,
      countingRecordCount: 24,
      nonCountingRecordCount: 0,
      byBuyerSegment: [{ key: "rental_hire", count: 24 }],
      byEvidenceGrade: [{ key: "B", count: 24 }],
      byAddressabilityStatus: [{ key: "addressable_now", count: 24 }],
    });
  });

  it("retains Mobile Compressed Air as excluded non-counting market evidence", () => {
    expect(FP_RENTAL_PUBLIC_MARKET_CONTEXT_V1).toHaveLength(1);
    const [record] = FP_RENTAL_PUBLIC_MARKET_CONTEXT_V1;
    expect(record).toMatchObject({
      recordKey: "context:mobile-compressed-air:public-core-v1",
      buyerName: "Mobile Compressed Air",
      buyerSegment: "rental_market_context",
      countingTreatment: "context_non_counting",
      commercialPoolKey: null,
      addressabilityStatus: "excluded",
      modelBand: null,
    });
    expect(() => assertFullPotentialPublicObservationRecord(record)).not.toThrow();
    expect(Object.prototype.hasOwnProperty.call(record, "scenarios")).toBe(false);

    const combined = summarizeFullPotentialPublicObservations([
      ...FP_RENTAL_PUBLIC_CORE_V1,
      ...FP_RENTAL_PUBLIC_MARKET_CONTEXT_V1,
    ]);
    expect(combined).toMatchObject({
      recordCount: 25,
      countingRecordCount: 24,
      nonCountingRecordCount: 1,
    });
    expect(combined.byCountingTreatment).toEqual([
      { key: "buyer_counting", count: 24 },
      { key: "context_non_counting", count: 1 },
    ]);
  });
});
