import { describe, expect, it } from "vitest";
import {
  assertFullPotentialPublicObservationRecord,
  summarizeFullPotentialPublicObservations,
} from "../shared/fullPotentialPublicDraftPack";
import { FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1 } from "./fullPotentialToughStationaryPublicApplications";

describe("Tough Stationary public application evidence", () => {
  it("contains unique, non-counting public observations only", () => {
    expect(FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1.length).toBeGreaterThanOrEqual(10);
    expect(new Set(FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1.map(record => record.recordKey)).size)
      .toBe(FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1.length);
    expect(FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1.every(
      record => record.countingTreatment !== "buyer_counting",
    )).toBe(true);
    expect(FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1.every(
      record => !Object.prototype.hasOwnProperty.call(record, "scenarios"),
    )).toBe(true);
  });

  it("validates the public text and source contract", () => {
    for (const record of FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1) {
      expect(() => assertFullPotentialPublicObservationRecord(record)).not.toThrow();
      expect(record.sourceUrl.startsWith("https://")).toBe(true);
      expect(record.productFamily).toBe("e_air");
    }
  });

  it("keeps temporary rental applications non-counting", () => {
    const temporary = FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1.filter(
      record => record.productCell === "TS2_temporary_industrial_overlay",
    );
    expect(temporary.length).toBeGreaterThanOrEqual(2);
    expect(temporary.every(
      record => record.countingTreatment === "application_overlay_non_counting",
    )).toBe(true);
  });

  it("retains the public 35 bar demand as a zero-value portfolio gap", () => {
    const gap = FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1.find(
      record => record.productCell === "TS4_35_bar_gap",
    );
    expect(gap).toMatchObject({
      addressabilityStatus: "portfolio_gap",
      countingTreatment: "context_non_counting",
    });
  });

  it("summarizes application coverage without creating monetary buyers", () => {
    const summary = summarizeFullPotentialPublicObservations(
      FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1,
    );
    expect(summary.countingRecordCount).toBe(0);
    expect(summary.nonCountingRecordCount).toBe(summary.recordCount);
    expect(summary.byCountingTreatment).toEqual(expect.arrayContaining([
      { key: "context_non_counting", count: 10 },
      { key: "application_overlay_non_counting", count: 2 },
    ]));
  });

  it("does not contain current planning values or internal commercial data", () => {
    const serialized = JSON.stringify(FP_TOUGH_STATIONARY_PUBLIC_APPLICATIONS_V1);
    expect(serialized).not.toContain("averageSellingPriceAud");
    expect(serialized).not.toMatch(/\bAUD\b|A\$\s*\d|\$\s*\d/);
    expect(serialized).not.toMatch(/transfer price|landed cost|local modification cost|factory lead time/i);
  });
});
