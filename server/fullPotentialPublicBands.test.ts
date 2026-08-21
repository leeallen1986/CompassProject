import { describe, expect, it } from "vitest";
import {
  FP_RENTAL_FLEET_BANDS,
  FP_UNDERGROUND_POSITION_CLASSES,
  adoptionPositionScenarios,
  rentalFleetBandScenarios,
  undergroundPositionClassScenarios,
} from "../shared/fullPotentialPublicBands";

describe("Full Potential public scenario bands", () => {
  it("keeps the agreed Rental P1-P5 ranges explicit", () => {
    expect(FP_RENTAL_FLEET_BANDS).toEqual({
      P1: { low: 1, base: 3, high: 5 },
      P2: { low: 6, base: 10, high: 15 },
      P3: { low: 16, base: 23, high: 30 },
      P4: { low: 31, base: 50, high: 75 },
      P5: { low: 75, base: 110, high: 150 },
    });
  });

  it("builds the agreed 30/45/60 three-year Rental refresh scenarios", () => {
    expect(rentalFleetBandScenarios("P4", {
      averageSellingPriceAud: 70_000,
      addressableSharePct: 80,
    })).toEqual({
      low: {
        estimatedFleetUnits: 31,
        replacementSharePct: 30,
        averageSellingPriceAud: 70_000,
        addressableSharePct: 80,
      },
      base: {
        estimatedFleetUnits: 50,
        replacementSharePct: 45,
        averageSellingPriceAud: 70_000,
        addressableSharePct: 80,
      },
      high: {
        estimatedFleetUnits: 75,
        replacementSharePct: 60,
        averageSellingPriceAud: 70_000,
        addressableSharePct: 80,
      },
    });
  });

  it("keeps underground U1-U3 application positions separate from fleet claims", () => {
    expect(FP_UNDERGROUND_POSITION_CLASSES).toEqual({
      U1: { low: 1, base: 1, high: 2 },
      U2: { low: 1, base: 2, high: 3 },
      U3: { low: 2, base: 3, high: 4 },
    });
    expect(undergroundPositionClassScenarios("U3", {
      averageSellingPriceAud: 180_000,
      addressableSharePct: { low: 40, base: 60, high: 80 },
    })).toEqual({
      low: { adoptionPositions: 2, averageSellingPriceAud: 180_000, addressableSharePct: 40 },
      base: { adoptionPositions: 3, averageSellingPriceAud: 180_000, addressableSharePct: 60 },
      high: { adoptionPositions: 4, averageSellingPriceAud: 180_000, addressableSharePct: 80 },
    });
  });

  it("supports scenario-specific planning values for emerging product cells", () => {
    expect(adoptionPositionScenarios(
      { low: 5, base: 12, high: 20 },
      {
        averageSellingPriceAud: { low: 250_000, base: 275_000, high: 300_000 },
        addressableSharePct: { low: 50, base: 60, high: 70 },
      },
    )).toEqual({
      low: { adoptionPositions: 5, averageSellingPriceAud: 250_000, addressableSharePct: 50 },
      base: { adoptionPositions: 12, averageSellingPriceAud: 275_000, addressableSharePct: 60 },
      high: { adoptionPositions: 20, averageSellingPriceAud: 300_000, addressableSharePct: 70 },
    });
  });
});
