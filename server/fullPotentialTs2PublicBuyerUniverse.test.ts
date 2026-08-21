import { describe, expect, it } from "vitest";
import { FP_TS2_SURFACE_POSITION_CLASSES, type FullPotentialTs2SurfacePositionClass } from "../shared/fullPotentialPublicBands";
import {
  assertFullPotentialPublicObservationRecord,
  summarizeFullPotentialPublicObservations,
} from "../shared/fullPotentialPublicDraftPack";
import { FP_TS2_PUBLIC_BUYER_UNIVERSE_V1 } from "./fullPotentialTs2PublicBuyerUniverse";

function adoptionUniverse(scenario: "low" | "base" | "high"): number {
  return FP_TS2_PUBLIC_BUYER_UNIVERSE_V1.reduce((sum, record) => {
    const positionClass = record.modelBand as FullPotentialTs2SurfacePositionClass;
    return sum + FP_TS2_SURFACE_POSITION_CLASSES[positionClass][scenario];
  }, 0);
}

describe("TS2 public direct-buyer qualification universe", () => {
  it("contains nine unique named buyer-context records", () => {
    expect(FP_TS2_PUBLIC_BUYER_UNIVERSE_V1).toHaveLength(9);
    expect(new Set(FP_TS2_PUBLIC_BUYER_UNIVERSE_V1.map(record => record.recordKey)).size).toBe(9);
    expect(FP_TS2_PUBLIC_BUYER_UNIVERSE_V1.every(record => record.buyerName && record.buyerAccountKey)).toBe(true);
    expect(FP_TS2_PUBLIC_BUYER_UNIVERSE_V1.every(record => record.buyerSegment === "mining_direct")).toBe(true);
  });

  it("keeps every named buyer non-counting until a distinct Portable Air application is proven", () => {
    for (const record of FP_TS2_PUBLIC_BUYER_UNIVERSE_V1) {
      expect(record.countingTreatment).toBe("context_non_counting");
      expect(record.commercialPoolKey).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(record, "scenarios")).toBe(false);
      expect(() => assertFullPotentialPublicObservationRecord(record)).not.toThrow();
    }
  });

  it("locks the initial high-priority S2/S3 distribution", () => {
    const summary = summarizeFullPotentialPublicObservations(FP_TS2_PUBLIC_BUYER_UNIVERSE_V1);
    expect(summary.byModelBand).toEqual([
      { key: "S2", count: 5 },
      { key: "S3", count: 4 },
    ]);
  });

  it("quantifies only a provisional adoption-position universe, not installed equipment", () => {
    expect(adoptionUniverse("low")).toBe(9);
    expect(adoptionUniverse("base")).toBe(13);
    expect(adoptionUniverse("high")).toBe(22);
  });

  it("keeps TS2 buyer qualification conditional and public-source safe", () => {
    const summary = summarizeFullPotentialPublicObservations(FP_TS2_PUBLIC_BUYER_UNIVERSE_V1);
    expect(summary).toMatchObject({
      recordCount: 9,
      countingRecordCount: 0,
      nonCountingRecordCount: 9,
      byBuyerSegment: [{ key: "mining_direct", count: 9 }],
      byAddressabilityStatus: [{ key: "conditional_compliance", count: 9 }],
    });

    const serialized = JSON.stringify(FP_TS2_PUBLIC_BUYER_UNIVERSE_V1);
    expect(serialized).not.toContain("averageSellingPriceAud");
    expect(serialized).not.toMatch(/\bAUD\b|A\$\s*\d|\$\s*\d/);
    expect(serialized).not.toMatch(/customer said|customer told|crm note|quotation|discount|intends? to buy/i);
  });

  it("keeps the stationary-compressor-room exclusion visible on every buyer", () => {
    for (const record of FP_TS2_PUBLIC_BUYER_UNIVERSE_V1) {
      expect(record.qualificationGates?.some(gate => gate.includes("compressor-room"))).toBe(true);
    }
  });
});
