import { describe, expect, it } from "vitest";
import {
  FP_UNDERGROUND_POSITION_CLASSES,
  type FullPotentialUndergroundPositionClass,
} from "../shared/fullPotentialPublicBands";
import {
  assertFullPotentialPublicObservationRecord,
  materializeFullPotentialDraftPack,
  summarizeFullPotentialPublicObservations,
} from "../shared/fullPotentialPublicDraftPack";
import { buildFullPotentialSeptemberManagementView } from "../shared/fullPotentialManagementView";
import { FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1 } from "./fullPotentialToughStationaryDirectMiningCore";

function positionUniverse(scenario: "low" | "base" | "high"): number {
  return FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1.reduce((sum, record) => {
    const positionClass = record.modelBand as FullPotentialUndergroundPositionClass;
    return sum + FP_UNDERGROUND_POSITION_CLASSES[positionClass][scenario];
  }, 0);
}

describe("TS3 named direct-mining qualification core", () => {
  it("contains ten unique public buyer/site qualification contexts", () => {
    expect(FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1).toHaveLength(10);
    expect(new Set(FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1.map(record => record.recordKey)).size).toBe(10);
    expect(FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1.every(record => record.buyerName && record.buyerAccountKey)).toBe(true);
  });

  it("keeps every TS3 mining record non-counting and scenario-free", () => {
    for (const record of FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1) {
      expect(record.countingTreatment).toBe("context_non_counting");
      expect(record.commercialPoolKey).toBeNull();
      expect(record.productCell).toBe("TS3_underground_mining_buyer");
      expect(record.buyerSegment).toBe("underground_mining");
      expect(record.scenarioBasis).toBe("adoption_positions");
      expect(Object.prototype.hasOwnProperty.call(record, "scenarios")).toBe(false);
      expect(() => assertFullPotentialPublicObservationRecord(record)).not.toThrow();
    }
  });

  it("uses six U3 and four U2 qualification classes", () => {
    const summary = summarizeFullPotentialPublicObservations(FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1);
    expect(summary.byModelBand).toEqual([
      { key: "U3", count: 6 },
      { key: "U2", count: 4 },
    ]);
  });

  it("creates a non-monetary 16/26/36 named TS3 position universe", () => {
    expect(positionUniverse("low")).toBe(16);
    expect(positionUniverse("base")).toBe(26);
    expect(positionUniverse("high")).toBe(36);
  });

  it("carries the same 16/26/36 TS3 universe into the management view with zero value", () => {
    const materialized = materializeFullPotentialDraftPack(
      FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1,
      [],
    );
    const view = buildFullPotentialSeptemberManagementView(materialized.records);
    expect(view.qualificationUniverse).toMatchObject({
      namedBuyerContextCount: 10,
      ts2SurfacePositionUniverse: { low: 0, base: 0, high: 0 },
      ts3UndergroundPositionUniverse: { low: 16, base: 26, high: 36 },
      byModelBand: [
        { key: "U3", label: "U3 — priority underground / multi-front qualification", count: 6 },
        { key: "U2", label: "U2 — significant underground qualification", count: 4 },
      ],
    });
    expect(view.headline.total).toEqual({ lowAud: 0, baseAud: 0, highAud: 0 });
  });

  it("uses stable official Evolution operating documents rather than transient job pages", () => {
    const evolution = FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1.filter(
      record => record.buyerAccountKey === "evolution-mining-au",
    );
    expect(evolution).toHaveLength(3);
    expect(evolution.every(record => record.sourceUrl.includes("evolutionmining.com.au/storage/"))).toBe(true);
    expect(evolution.every(record => !record.sourceUrl.includes("careers.evolutionmining.com.au"))).toBe(true);
    expect(evolution.map(record => record.recordKey).sort()).toEqual([
      "ts3:qualification:evolution:cowal",
      "ts3:qualification:evolution:ernest-henry",
      "ts3:qualification:evolution:mungari",
    ]);
  });

  it("retains the new-equipment versus overhaul and reticulation gate", () => {
    for (const record of FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1) {
      expect(record.qualificationGates?.some(gate => gate.includes("life-extension"))).toBe(true);
      expect(record.qualificationGates?.some(gate => gate.includes("monetary buyer pool"))).toBe(true);
    }
  });

  it("summarizes qualification coverage without creating monetary value", () => {
    const summary = summarizeFullPotentialPublicObservations(
      FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1,
    );
    expect(summary).toMatchObject({
      recordCount: 10,
      countingRecordCount: 0,
      nonCountingRecordCount: 10,
      byBuyerSegment: [{ key: "underground_mining", count: 10 }],
      byEvidenceGrade: [{ key: "B", count: 10 }],
      byAddressabilityStatus: [{ key: "conditional_compliance", count: 10 }],
    });
  });

  it("contains no restricted planning values or CRM-style intelligence", () => {
    const serialized = JSON.stringify(FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1);
    expect(serialized).not.toContain("averageSellingPriceAud");
    expect(serialized).not.toMatch(/\bAUD\b|A\$\s*\d|\$\s*\d/);
    expect(serialized).not.toMatch(/customer said|customer told|crm note|quotation|discount|intends? to buy/i);
  });
});
