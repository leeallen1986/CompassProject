import {
  FP_PUBLIC_SCENARIOS,
  type FullPotentialPublicScenario,
} from "./fullPotentialPublicEvidence";
import type {
  FullPotentialPublicObservationRecord,
  FullPotentialRestrictedScenarioRecord,
} from "./fullPotentialPublicDraftPack";
import {
  FP_RENTAL_FLEET_BANDS,
  type FullPotentialRentalFleetBand,
} from "./fullPotentialPublicBands";
import type {
  FullPotentialLocalisationUpliftStatus,
  FullPotentialPrivatePlanningValueBasis,
} from "./fullPotentialPrivatePlanning";

export interface FullPotentialScenarioNumberSet {
  low: number;
  base: number;
  high: number;
}

export interface FullPotentialRentalPlanningOverride {
  recordKey: string;
  averageSellingPriceAud?: number | FullPotentialScenarioNumberSet;
  addressableSharePct?: number | FullPotentialScenarioNumberSet;
  replacementSharePct?: Partial<FullPotentialScenarioNumberSet>;
  planningValueBasis?: FullPotentialPrivatePlanningValueBasis;
  localisationUpliftStatus?: FullPotentialLocalisationUpliftStatus;
}

export interface FullPotentialRentalPlanningDefaults {
  planningValueSetRef: string;
  averageSellingPriceAud: number | FullPotentialScenarioNumberSet;
  addressableSharePct: number | FullPotentialScenarioNumberSet;
  replacementSharePct?: Partial<FullPotentialScenarioNumberSet>;
  planningValueBasis: FullPotentialPrivatePlanningValueBasis;
  localisationUpliftStatus: FullPotentialLocalisationUpliftStatus;
  overrides?: FullPotentialRentalPlanningOverride[];
}

export interface FullPotentialAdoptionPlanningOverride {
  recordKey: string;
  adoptionPositions?: FullPotentialScenarioNumberSet;
  averageSellingPriceAud?: number | FullPotentialScenarioNumberSet;
  addressableSharePct?: number | FullPotentialScenarioNumberSet;
  planningValueBasis?: FullPotentialPrivatePlanningValueBasis;
  localisationUpliftStatus?: FullPotentialLocalisationUpliftStatus;
}

export interface FullPotentialAdoptionPlanningDefaults {
  planningValueSetRef: string;
  adoptionPositions: FullPotentialScenarioNumberSet;
  averageSellingPriceAud: number | FullPotentialScenarioNumberSet;
  addressableSharePct: number | FullPotentialScenarioNumberSet;
  planningValueBasis: FullPotentialPrivatePlanningValueBasis;
  localisationUpliftStatus: FullPotentialLocalisationUpliftStatus;
  overrides?: FullPotentialAdoptionPlanningOverride[];
}

const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEFAULT_REPLACEMENT_SHARE: FullPotentialScenarioNumberSet = {
  low: 30,
  base: 45,
  high: 60,
};

function finiteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
  return value;
}

function percentage(value: number, field: string): number {
  const parsed = finiteNonNegative(value, field);
  if (parsed > 100) throw new Error(`${field} cannot exceed 100`);
  return parsed;
}

function scenarioNumber(
  input: number | FullPotentialScenarioNumberSet,
  scenario: FullPotentialPublicScenario,
  field: string,
): number {
  const value = typeof input === "number" ? input : input[scenario];
  return finiteNonNegative(value, `${field}.${scenario}`);
}

function scenarioPercentage(
  input: number | FullPotentialScenarioNumberSet,
  scenario: FullPotentialPublicScenario,
  field: string,
): number {
  const value = typeof input === "number" ? input : input[scenario];
  return percentage(value, `${field}.${scenario}`);
}

function replacementShare(
  input: Partial<FullPotentialScenarioNumberSet> | undefined,
  scenario: FullPotentialPublicScenario,
): number {
  return percentage(
    input?.[scenario] ?? DEFAULT_REPLACEMENT_SHARE[scenario],
    `replacementSharePct.${scenario}`,
  );
}

function assertOpaque(value: string): void {
  if (!OPAQUE_REFERENCE_PATTERN.test(value)) {
    throw new Error("planningValueSetRef must be an opaque non-sensitive reference");
  }
}

function assertBand(value: string | null | undefined, recordKey: string): FullPotentialRentalFleetBand {
  if (!value || !(value in FP_RENTAL_FLEET_BANDS)) {
    throw new Error(`Rental public observation ${recordKey} requires a P1-P5 model band`);
  }
  return value as FullPotentialRentalFleetBand;
}

/**
 * Convert the public Rental observation core into a private planning pack using
 * a concise restricted value set. The source-controlled public records remain
 * free of current prices and monetary scenarios.
 */
export function buildRentalRestrictedPlanningPack(
  observations: FullPotentialPublicObservationRecord[],
  defaults: FullPotentialRentalPlanningDefaults,
): FullPotentialRestrictedScenarioRecord[] {
  assertOpaque(defaults.planningValueSetRef);

  const overrides = new Map<string, FullPotentialRentalPlanningOverride>();
  for (const override of defaults.overrides ?? []) {
    if (overrides.has(override.recordKey)) {
      throw new Error(`Duplicate Rental planning override ${override.recordKey}`);
    }
    overrides.set(override.recordKey, override);
  }

  const result = observations
    .filter(record => record.countingTreatment === "buyer_counting")
    .map<FullPotentialRestrictedScenarioRecord>(record => {
      if (record.buyerSegment !== "rental_hire" || record.scenarioBasis !== "fleet_replacement") {
        throw new Error(
          `Rental planning factory cannot process ${record.recordKey}: expected rental_hire fleet_replacement`,
        );
      }
      const band = assertBand(record.modelBand, record.recordKey);
      const fleet = FP_RENTAL_FLEET_BANDS[band];
      const override = overrides.get(record.recordKey);
      const asp = override?.averageSellingPriceAud ?? defaults.averageSellingPriceAud;
      const share = override?.addressableSharePct ?? defaults.addressableSharePct;
      const replacement = {
        ...defaults.replacementSharePct,
        ...override?.replacementSharePct,
      };

      const scenarios = Object.fromEntries(
        FP_PUBLIC_SCENARIOS.map(scenario => [
          scenario,
          {
            estimatedFleetUnits: fleet[scenario],
            replacementSharePct: replacementShare(replacement, scenario),
            averageSellingPriceAud: scenarioNumber(asp, scenario, "averageSellingPriceAud"),
            addressableSharePct: scenarioPercentage(share, scenario, "addressableSharePct"),
          },
        ]),
      ) as FullPotentialRestrictedScenarioRecord["scenarios"];

      return {
        recordKey: record.recordKey,
        planningValueSetRef: defaults.planningValueSetRef,
        planningValueBasis: override?.planningValueBasis ?? defaults.planningValueBasis,
        localisationUpliftStatus: override?.localisationUpliftStatus
          ?? defaults.localisationUpliftStatus,
        scenarios,
      };
    });

  const publicRecordKeys = new Set(result.map(row => row.recordKey));
  for (const override of overrides.values()) {
    if (!publicRecordKeys.has(override.recordKey)) {
      throw new Error(`Rental planning override ${override.recordKey} has no buyer-counting observation`);
    }
  }

  return result.sort((left, right) => left.recordKey.localeCompare(right.recordKey));
}

/**
 * Expand concise private adoption defaults across public buyer-counting records.
 * Each public observation remains price-free; current positions, planning values
 * and addressable-share assumptions are supplied only in the restricted input.
 */
export function buildAdoptionRestrictedPlanningPack(
  observations: FullPotentialPublicObservationRecord[],
  defaults: FullPotentialAdoptionPlanningDefaults,
): FullPotentialRestrictedScenarioRecord[] {
  assertOpaque(defaults.planningValueSetRef);

  const overrides = new Map<string, FullPotentialAdoptionPlanningOverride>();
  for (const override of defaults.overrides ?? []) {
    if (overrides.has(override.recordKey)) {
      throw new Error(`Duplicate adoption planning override ${override.recordKey}`);
    }
    overrides.set(override.recordKey, override);
  }

  const result = observations
    .filter(record => record.countingTreatment === "buyer_counting")
    .map<FullPotentialRestrictedScenarioRecord>(record => {
      if (record.scenarioBasis !== "adoption_positions") {
        throw new Error(
          `Adoption planning factory cannot process ${record.recordKey}: expected adoption_positions`,
        );
      }
      const override = overrides.get(record.recordKey);
      const positions = override?.adoptionPositions ?? defaults.adoptionPositions;
      const asp = override?.averageSellingPriceAud ?? defaults.averageSellingPriceAud;
      const share = override?.addressableSharePct ?? defaults.addressableSharePct;

      const scenarios = Object.fromEntries(
        FP_PUBLIC_SCENARIOS.map(scenario => [
          scenario,
          {
            adoptionPositions: scenarioNumber(positions, scenario, "adoptionPositions"),
            averageSellingPriceAud: scenarioNumber(asp, scenario, "averageSellingPriceAud"),
            addressableSharePct: scenarioPercentage(share, scenario, "addressableSharePct"),
          },
        ]),
      ) as FullPotentialRestrictedScenarioRecord["scenarios"];

      return {
        recordKey: record.recordKey,
        planningValueSetRef: defaults.planningValueSetRef,
        planningValueBasis: override?.planningValueBasis ?? defaults.planningValueBasis,
        localisationUpliftStatus: override?.localisationUpliftStatus
          ?? defaults.localisationUpliftStatus,
        scenarios,
      };
    });

  const publicRecordKeys = new Set(result.map(row => row.recordKey));
  for (const override of overrides.values()) {
    if (!publicRecordKeys.has(override.recordKey)) {
      throw new Error(`Adoption planning override ${override.recordKey} has no buyer-counting observation`);
    }
  }

  return result.sort((left, right) => left.recordKey.localeCompare(right.recordKey));
}
