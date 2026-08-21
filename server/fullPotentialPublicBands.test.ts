import { describe, expect, it } from "vitest";
import {
  FP_RENTAL_FLEET_BANDS,
  FP_TS2_SURFACE_POSITION_CLASSES,
  FP_UNDERGROUND_POSITION_CLASSES,
  adoptionPositionScenarios,
  rentalFleetBandScenarios,
  ts2SurfacePositionClassScenarios,
  undergroundPositionClassScenarios,
} from "../shared/fullPotentialPublicBands";

/** Synthetic arithmetic fixtures only; not current commercial planning values. */
const SYNTHETIC_ASP = 1_000;

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
      averageSellingPriceAud: SYNTHETIC_ASP,
      addressableSharePct: 80,
    })).toEqual({
      low: {
        estimatedFleetUnits: 31,
        replacementSharePct: 30,
        averageSellingPriceAud: SYNTHETIC_ASP,
        addressableSharePct: 80,
      },
      base: {
        estimatedFleetUnits: 50,
        replacementSharePct: 45,
        averageSellingPriceAud: SYNTHETIC_ASP,
        addressableSharePct: 80,
      },
      high: {
        estimatedFleetUnits: 75,
        replacementSharePct: 60,
        averageSellingPriceAud: SYNTHETIC_ASP,
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
      averageSellingPriceAud: SYNTHETIC_ASP,
      addressableSharePct: { low: 40, base: 60, high: 80 },
    })).toEqual({
      low: { adoptionPositions: 2, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 40 },
      base: { adoptionPositions: 3, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 60 },
      high: { adoptionPositions: 4, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 80 },
    });
  });

  it("keeps TS2 S1-S3 surface classes as adoption positions rather than installed fleets", () => {
    expect(FP_TS2_SURFACE_POSITION_CLASSES).toEqual({
      S1: { low: 0, base: 1, high: 1 },
      S2: { low: 1, base: 1, high: 2 },
      S3: { low: 1, base: 2, high: 3 },
    });
    expect(ts2SurfacePositionClassScenarios("S3", {
      averageSellingPriceAud: SYNTHETIC_ASP,
      addressableSharePct: { low: 30, base: 50, high: 70 },
    })).toEqual({
      low: { adoptionPositions: 1, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 30 },
      base: { adoptionPositions: 2, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 50 },
      high: { adoptionPositions: 3, averageSellingPriceAud: SYNTHETIC_ASP, addressableSharePct: 70 },
    });
  });

  it("supports scenario-specific synthetic values for emerging product cells", () => {
    expect(adoptionPositionScenarios(
      { low: 5, base: 12, high: 20 },
      {
        averageSellingPriceAud: { low: 800, base: 1_000, high: 1_200 },
        addressableSharePct: { low: 50, base: 60, high: 70 },
      },
    )).toEqual({
      low: { adoptionPositions: 5, averageSellingPriceAud: 800, addressableSharePct: 50 },
      base: { adoptionPositions: 12, averageSellingPriceAud: 1_000, addressableSharePct: 60 },
      high: { adoptionPositions: 20, averageSellingPriceAud: 1_200, addressableSharePct: 70 },
    });
  });
});
