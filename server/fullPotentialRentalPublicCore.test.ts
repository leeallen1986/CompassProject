import { describe, expect, it } from "vitest";
import { FP_RENTAL_FLEET_BANDS, type FullPotentialRentalFleetBand } from "../shared/fullPotentialPublicBands";
import {
  assertFullPotentialPublicObservationRecord,
  summarizeFullPotentialPublicObservations,
} from "../shared/fullPotentialPublicDraftPack";
import { FP_RENTAL_PUBLIC_CORE_V1 } from "./fullPotentialRentalPublicCore";

function fleetUniverse(scenario: "low" | "base" | "high"): number {
  return FP_RENTAL_PUBLIC_CORE_V1.reduce((sum, record) => {
    const band = record.modelBand as FullPotentialRentalFleetBand;
    return sum + FP_RENTAL_FLEET_BANDS[band][scenario];
  }, 0);
}

describe("Rental Hire public-evidence core", () => {
  it("contains exactly 25 unique buyer-counting public observations", () => {
    expect(FP_RENTAL_PUBLIC_CORE_V1).toHaveLength(25);
    expect(new Set(FP_RENTAL_PUBLIC_CORE_V1.map(record => record.recordKey)).size).toBe(25);
    expect(new Set(FP_RENTAL_PUBLIC_CORE_V1.map(record => record.commercialPoolKey)).size).toBe(25);
    expect(FP_RENTAL_PUBLIC_CORE_V1.every(record => record.countingTreatment === "buyer_counting")).toBe(true);
    expect(FP_RENTAL_PUBLIC_CORE_V1.every(record => record.valueClass === "named_evidenced_core")).toBe(true);
  });

  it("validates every source-controlled record and keeps monetary scenarios absent", () => {
    for (const record of FP_RENTAL_PUBLIC_CORE_V1) {
      expect(() => assertFullPotentialPublicObservationRecord(record)).not.toThrow();
      expect(Object.prototype.hasOwnProperty.call(record, "scenarios")).toBe(false);
      expect(record.sourceUrl.startsWith("https://")).toBe(true);
    }

    const serialized = JSON.stringify(FP_RENTAL_PUBLIC_CORE_V1);
    expect(serialized).not.toContain("averageSellingPriceAud");
    expect(serialized).not.toMatch(/\bAUD\b|A\$\s*\d|\$\s*\d/);
  });

  it("locks the agreed P-band distribution", () => {
    const summary = summarizeFullPotentialPublicObservations(FP_RENTAL_PUBLIC_CORE_V1);
    expect(summary.byModelBand).toEqual([
      { key: "P2", count: 10 },
      { key: "P3", count: 7 },
      { key: "P4", count: 3 },
      { key: "P5", count: 3 },
      { key: "P1", count: 2 },
    ]);
  });

  it("reconciles the named relevant-fleet universe without asserting exact fleets", () => {
    expect(fleetUniverse("low")).toBe(492);
    expect(fleetUniverse("base")).toBe(747);
    expect(fleetUniverse("high")).toBe(1_045);
  });

  it("keeps the pack wholly within the Rental buyer segment", () => {
    const summary = summarizeFullPotentialPublicObservations(FP_RENTAL_PUBLIC_CORE_V1);
    expect(summary).toMatchObject({
      recordCount: 25,
      countingRecordCount: 25,
      nonCountingRecordCount: 0,
      byBuyerSegment: [{ key: "rental_hire", count: 25 }],
      byEvidenceGrade: [{ key: "B", count: 25 }],
      byAddressabilityStatus: [{ key: "addressable_now", count: 25 }],
    });
  });
});
