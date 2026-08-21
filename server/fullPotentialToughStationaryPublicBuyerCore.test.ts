import { describe, expect, it } from "vitest";
import {
  assertFullPotentialPublicObservationRecord,
  summarizeFullPotentialPublicObservations,
} from "../shared/fullPotentialPublicDraftPack";
import { FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1 } from "./fullPotentialToughStationaryPublicBuyerCore";

describe("Tough Stationary public buyer core", () => {
  it("contains distinct buyer-counting adoption pools with no monetary scenarios", () => {
    expect(FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1).toHaveLength(7);
    expect(new Set(FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1.map(record => record.recordKey)).size).toBe(7);
    expect(new Set(FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1.map(record => record.commercialPoolKey)).size).toBe(7);
    expect(FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1.every(
      record => record.countingTreatment === "buyer_counting",
    )).toBe(true);
    expect(FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1.every(
      record => record.scenarioBasis === "adoption_positions",
    )).toBe(true);
    expect(FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1.every(
      record => !Object.prototype.hasOwnProperty.call(record, "scenarios"),
    )).toBe(true);
  });

  it("validates every public record and keeps private planning values absent", () => {
    for (const record of FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1) {
      expect(() => assertFullPotentialPublicObservationRecord(record)).not.toThrow();
      expect(record.sourceUrl.startsWith("https://")).toBe(true);
      expect(record.productFamily).toBe("e_air");
      expect(record.addressabilityStatus).toBe("conditional_compliance");
    }
    const serialized = JSON.stringify(FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1);
    expect(serialized).not.toContain("averageSellingPriceAud");
    expect(serialized).not.toMatch(/\bAUD\b|A\$\s*\d|\$\s*\d/);
  });

  it("separates TS2 and TS4 adoption from the conventional Rental core", () => {
    const ts2 = FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1.filter(
      record => record.productCell === "TS2_specialist_rental_electric",
    );
    const ts4Named = FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1.filter(
      record => record.productCell === "TS4_specialist_rental_electric",
    );
    const allowance = FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1.filter(
      record => record.productCell === "TS4_direct_powered_project_allowance",
    );

    expect(ts2).toHaveLength(2);
    expect(ts4Named).toHaveLength(4);
    expect(allowance).toHaveLength(1);
    expect(allowance[0]).toMatchObject({
      buyerSegment: "mining_direct",
      valueClass: "unobserved_allowance",
      evidenceGrade: "C",
    });
  });

  it("allows the same public buyer to carry genuinely distinct TS2 and TS4 commercial pools", () => {
    const airpac = FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1.filter(
      record => record.buyerAccountKey === "airpac-rentals-australia-au",
    );
    const flowControl = FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1.filter(
      record => record.buyerAccountKey === "flow-control-engineering-au",
    );
    expect(airpac.map(record => record.productCell).sort()).toEqual([
      "TS2_specialist_rental_electric",
      "TS4_specialist_rental_electric",
    ]);
    expect(flowControl.map(record => record.productCell).sort()).toEqual([
      "TS2_specialist_rental_electric",
      "TS4_specialist_rental_electric",
    ]);
    expect(new Set(airpac.map(record => record.commercialPoolKey)).size).toBe(2);
    expect(new Set(flowControl.map(record => record.commercialPoolKey)).size).toBe(2);
  });

  it("summarizes named core and unobserved allowance separately", () => {
    const summary = summarizeFullPotentialPublicObservations(
      FP_TOUGH_STATIONARY_PUBLIC_BUYER_CORE_V1,
    );
    expect(summary).toMatchObject({
      recordCount: 7,
      countingRecordCount: 7,
      nonCountingRecordCount: 0,
      byValueClass: undefined,
    });
    expect(summary.byEvidenceGrade).toEqual([
      { key: "C", count: 5 },
      { key: "B", count: 2 },
    ]);
  });
});
