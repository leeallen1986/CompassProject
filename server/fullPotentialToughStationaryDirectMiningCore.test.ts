import { describe, expect, it } from "vitest";
import {
  assertFullPotentialPublicObservationRecord,
  summarizeFullPotentialPublicObservations,
} from "../shared/fullPotentialPublicDraftPack";
import { FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1 } from "./fullPotentialToughStationaryDirectMiningCore";

describe("Tough Stationary direct-mining public core", () => {
  it("contains eleven distinct named adoption pools with no monetary scenarios", () => {
    expect(FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1).toHaveLength(11);
    expect(new Set(FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1.map(record => record.recordKey)).size)
      .toBe(11);
    expect(new Set(FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1.map(record => record.commercialPoolKey)).size)
      .toBe(11);
    expect(FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1.every(
      record => record.countingTreatment === "buyer_counting",
    )).toBe(true);
    expect(FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1.every(
      record => record.scenarioBasis === "adoption_positions",
    )).toBe(true);
    expect(FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1.every(
      record => !Object.prototype.hasOwnProperty.call(record, "scenarios"),
    )).toBe(true);
  });

  it("validates public sources and keeps current planning values absent", () => {
    for (const record of FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1) {
      expect(() => assertFullPotentialPublicObservationRecord(record)).not.toThrow();
      expect(record.buyerSegment).toBe("mining_direct");
      expect(record.productFamily).toBe("e_air");
      expect(record.valueClass).toBe("named_evidenced_core");
      expect(record.evidenceGrade).toBe("B");
      expect(record.addressabilityStatus).toBe("conditional_compliance");
      expect(record.sourceUrl.startsWith("https://")).toBe(true);
    }

    const serialized = JSON.stringify(FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1);
    expect(serialized).not.toContain("averageSellingPriceAud");
    expect(serialized).not.toMatch(/\bAUD\b|A\$\s*\d|\$\s*\d/);
    expect(serialized).not.toMatch(/customer said|purchasing intent|quotation|discount/i);
  });

  it("separates surface TS2 from underground TS3", () => {
    const ts2 = FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1.filter(
      record => record.productCell === "TS2_surface_mining_direct",
    );
    const ts3 = FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1.filter(
      record => record.productCell === "TS3_underground_direct",
    );

    expect(ts2).toHaveLength(1);
    expect(ts2[0]).toMatchObject({
      buyerAccountKey: "fortescue-au",
      modelBand: "TS2-DIRECT-NAMED",
    });
    expect(ts3).toHaveLength(10);
    expect(ts3.every(record => record.modelBand === "TS3-DIRECT-NAMED")).toBe(true);
  });

  it("allows one canonical mining buyer to carry distinct site pools", () => {
    const evolution = FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1.filter(
      record => record.buyerAccountKey === "evolution-mining-au",
    );
    const mmg = FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1.filter(
      record => record.buyerAccountKey === "mmg-au",
    );

    expect(evolution).toHaveLength(3);
    expect(new Set(evolution.map(record => record.commercialPoolKey)).size).toBe(3);
    expect(mmg).toHaveLength(2);
    expect(new Set(mmg.map(record => record.commercialPoolKey)).size).toBe(2);
  });

  it("summarizes named direct-mining coverage without claiming installed units", () => {
    const summary = summarizeFullPotentialPublicObservations(
      FP_TOUGH_STATIONARY_DIRECT_MINING_CORE_V1,
    );
    expect(summary).toMatchObject({
      recordCount: 11,
      countingRecordCount: 11,
      nonCountingRecordCount: 0,
      byBuyerSegment: [{ key: "mining_direct", count: 11 }],
      byEvidenceGrade: [{ key: "B", count: 11 }],
      byAddressabilityStatus: [{ key: "conditional_compliance", count: 11 }],
    });
    expect(summary.byModelBand).toEqual([
      { key: "TS3-DIRECT-NAMED", count: 10 },
      { key: "TS2-DIRECT-NAMED", count: 1 },
    ]);
  });
});
