import type {
  FullPotentialPublicScenario,
  FullPotentialPublicScenarioAssumption,
} from "./fullPotentialPublicEvidence";

export const FP_RENTAL_FLEET_BANDS = {
  P1: { low: 1, base: 3, high: 5 },
  P2: { low: 6, base: 10, high: 15 },
  P3: { low: 16, base: 23, high: 30 },
  P4: { low: 31, base: 50, high: 75 },
  P5: { low: 75, base: 110, high: 150 },
} as const;

export const FP_UNDERGROUND_POSITION_CLASSES = {
  U1: { low: 1, base: 1, high: 2 },
  U2: { low: 1, base: 2, high: 3 },
  U3: { low: 2, base: 3, high: 4 },
} as const;

export type FullPotentialRentalFleetBand = keyof typeof FP_RENTAL_FLEET_BANDS;
export type FullPotentialUndergroundPositionClass = keyof typeof FP_UNDERGROUND_POSITION_CLASSES;

export interface FullPotentialRentalScenarioOptions {
  averageSellingPriceAud: number;
  addressableSharePct?: number;
  replacementSharePct?: Partial<Record<FullPotentialPublicScenario, number>>;
}

export interface FullPotentialAdoptionScenarioOptions {
  averageSellingPriceAud: number | Record<FullPotentialPublicScenario, number>;
  addressableSharePct?: number | Record<FullPotentialPublicScenario, number>;
}

const DEFAULT_REPLACEMENT_SHARE = {
  low: 30,
  base: 45,
  high: 60,
} as const;

function scenarioValue(
  value: number | Record<FullPotentialPublicScenario, number> | undefined,
  scenario: FullPotentialPublicScenario,
  fallback: number,
): number {
  if (typeof value === "number") return value;
  return value?.[scenario] ?? fallback;
}

export function rentalFleetBandScenarios(
  band: FullPotentialRentalFleetBand,
  options: FullPotentialRentalScenarioOptions,
): Record<FullPotentialPublicScenario, FullPotentialPublicScenarioAssumption> {
  const values = FP_RENTAL_FLEET_BANDS[band];
  return {
    low: {
      estimatedFleetUnits: values.low,
      replacementSharePct: options.replacementSharePct?.low ?? DEFAULT_REPLACEMENT_SHARE.low,
      averageSellingPriceAud: options.averageSellingPriceAud,
      addressableSharePct: options.addressableSharePct ?? 100,
    },
    base: {
      estimatedFleetUnits: values.base,
      replacementSharePct: options.replacementSharePct?.base ?? DEFAULT_REPLACEMENT_SHARE.base,
      averageSellingPriceAud: options.averageSellingPriceAud,
      addressableSharePct: options.addressableSharePct ?? 100,
    },
    high: {
      estimatedFleetUnits: values.high,
      replacementSharePct: options.replacementSharePct?.high ?? DEFAULT_REPLACEMENT_SHARE.high,
      averageSellingPriceAud: options.averageSellingPriceAud,
      addressableSharePct: options.addressableSharePct ?? 100,
    },
  };
}

export function adoptionPositionScenarios(
  positions: Record<FullPotentialPublicScenario, number>,
  options: FullPotentialAdoptionScenarioOptions,
): Record<FullPotentialPublicScenario, FullPotentialPublicScenarioAssumption> {
  return {
    low: {
      adoptionPositions: positions.low,
      averageSellingPriceAud: scenarioValue(options.averageSellingPriceAud, "low", 0),
      addressableSharePct: scenarioValue(options.addressableSharePct, "low", 100),
    },
    base: {
      adoptionPositions: positions.base,
      averageSellingPriceAud: scenarioValue(options.averageSellingPriceAud, "base", 0),
      addressableSharePct: scenarioValue(options.addressableSharePct, "base", 100),
    },
    high: {
      adoptionPositions: positions.high,
      averageSellingPriceAud: scenarioValue(options.averageSellingPriceAud, "high", 0),
      addressableSharePct: scenarioValue(options.addressableSharePct, "high", 100),
    },
  };
}

export function undergroundPositionClassScenarios(
  positionClass: FullPotentialUndergroundPositionClass,
  options: FullPotentialAdoptionScenarioOptions,
): Record<FullPotentialPublicScenario, FullPotentialPublicScenarioAssumption> {
  return adoptionPositionScenarios(FP_UNDERGROUND_POSITION_CLASSES[positionClass], options);
}
