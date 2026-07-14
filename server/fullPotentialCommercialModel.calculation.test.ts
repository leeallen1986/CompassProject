import { describe, expect, it } from "vitest";
import {
  calculateModelLine,
  deriveModelConfidence,
} from "./fullPotentialCommercialModel.shared";
import type { FullPotentialModelLine } from "../drizzle/schema";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    modelId: 1,
    productFamily: "portable_air_large" as const,
    application: "Large portable air rental fleet",
    routeToMarket: "direct_ape" as const,
    currentSupplier: null,
    currentRevenueAud: null,
    knownAtlasFleetUnits: 5,
    estimatedTotalFleetUnits: 100,
    replacementCycleYears: "5",
    annualReplacementUnits: null,
    averageSellingPriceAud: "150000",
    addressableSharePct: "25",
    specialtyPotentialAud: null,
    replacementCycleSource: "Customer discovery",
    assumptions: {},
    confidenceLevel: "medium" as const,
    evidenceIds: [1],
    ...overrides,
  };
}

describe("Full Potential commercial model calculations", () => {
  it("derives annual replacements and addressable equipment potential", () => {
    const result = calculateModelLine(baseInput());

    expect(result.annualReplacementUnits).toBe("20.00");
    expect(result.equipmentPotentialAud).toBe("750000.00");
    expect(result.linePotentialAud).toBe("750000.00");
  });

  it("uses an explicit annual replacement estimate when supplied", () => {
    const result = calculateModelLine(baseInput({
      annualReplacementUnits: "12.5",
      estimatedTotalFleetUnits: 1000,
      replacementCycleYears: "2",
    }));

    expect(result.annualReplacementUnits).toBe("12.50");
    expect(result.equipmentPotentialAud).toBe("468750.00");
  });

  it("adds explicitly supported specialty potential", () => {
    const result = calculateModelLine(baseInput({ specialtyPotentialAud: "125000" }));

    expect(result.equipmentPotentialAud).toBe("750000.00");
    expect(result.specialtyPotentialAud).toBe("125000.00");
    expect(result.linePotentialAud).toBe("875000.00");
  });

  it("does not invent equipment potential when inputs are incomplete", () => {
    const result = calculateModelLine(baseInput({
      averageSellingPriceAud: null,
      specialtyPotentialAud: null,
    }));

    expect(result.equipmentPotentialAud).toBe("0.00");
    expect(result.linePotentialAud).toBe("0.00");
  });

  it("rejects addressable share above 100 percent", () => {
    expect(() => calculateModelLine(baseInput({ addressableSharePct: "101" })))
      .toThrow(/cannot exceed 100/i);
  });

  it("derives model confidence from the weakest line", () => {
    const lines = [
      { confidenceLevel: "high" },
      { confidenceLevel: "medium" },
    ] as FullPotentialModelLine[];
    expect(deriveModelConfidence(lines)).toBe("medium");
    expect(deriveModelConfidence([{ confidenceLevel: "unknown" }] as FullPotentialModelLine[]))
      .toBe("unknown");
  });
});
