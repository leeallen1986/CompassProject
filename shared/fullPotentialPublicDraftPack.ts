import {
  FP_PUBLIC_EVIDENCE_METHOD_VERSION,
  FP_PUBLIC_SCENARIOS,
  assertFullPotentialPublicEvidenceRecord,
  type FullPotentialPublicEvidenceRecord,
  type FullPotentialPublicScenario,
  type FullPotentialPublicScenarioAssumption,
} from "./fullPotentialPublicEvidence";
import {
  assertFullPotentialPrivatePlanningEnvelope,
  type FullPotentialLocalisationUpliftStatus,
  type FullPotentialPrivatePlanningEnvelope,
  type FullPotentialPrivatePlanningValueBasis,
} from "./fullPotentialPrivatePlanning";

/**
 * Publicly committable evidence record. Monetary scenarios are deliberately
 * absent: current planning values and addressable-share assumptions arrive in a
 * separately authorised admin-only pack.
 */
export type FullPotentialPublicObservationRecord = Omit<
  FullPotentialPublicEvidenceRecord,
  "scenarios"
> & {
  scenarios?: never;
};

/**
 * Restricted planning input matched to a public observation by recordKey.
 * This data is not intended for public source control.
 */
export interface FullPotentialRestrictedScenarioRecord {
  recordKey: string;
  planningValueSetRef: string;
  planningValueBasis: FullPotentialPrivatePlanningValueBasis;
  localisationUpliftStatus: FullPotentialLocalisationUpliftStatus;
  scenarios: Record<FullPotentialPublicScenario, FullPotentialPublicScenarioAssumption>;
}

export interface FullPotentialMaterializedDraftPack {
  records: FullPotentialPublicEvidenceRecord[];
  planningEnvelopes: FullPotentialPrivatePlanningEnvelope[];
  publicObservationCount: number;
  restrictedPlanningCount: number;
  planningValueSetRefs: string[];
}

export interface FullPotentialPublicObservationSummary {
  methodologyVersion: typeof FP_PUBLIC_EVIDENCE_METHOD_VERSION;
  recordCount: number;
  countingRecordCount: number;
  nonCountingRecordCount: number;
  byBuyerSegment: Array<{ key: string; count: number }>;
  byModelBand: Array<{ key: string; count: number }>;
  byEvidenceGrade: Array<{ key: string; count: number }>;
  byAddressabilityStatus: Array<{ key: string; count: number }>;
  byCountingTreatment: Array<{ key: string; count: number }>;
}

const PRIVATE_VALUE_TEXT_PATTERN = /(?:\bAUD\b|\bA\$\s*\d|\$\s*\d)/i;
const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function zeroScenariosFor(
  basis: FullPotentialPublicObservationRecord["scenarioBasis"],
): Record<FullPotentialPublicScenario, FullPotentialPublicScenarioAssumption> {
  return Object.fromEntries(
    FP_PUBLIC_SCENARIOS.map(scenario => [
      scenario,
      basis === "fleet_replacement"
        ? {
          estimatedFleetUnits: 0,
          replacementSharePct: 0,
          averageSellingPriceAud: 0,
          addressableSharePct: 0,
        }
        : {
          adoptionPositions: 0,
          averageSellingPriceAud: 0,
          addressableSharePct: 0,
        },
    ]),
  ) as Record<FullPotentialPublicScenario, FullPotentialPublicScenarioAssumption>;
}

function assertNoPrivatePlanningText(record: FullPotentialPublicObservationRecord): void {
  const fields = [
    record.publicObservation,
    record.inference,
    ...(record.qualificationGates ?? []),
  ];
  if (fields.some(value => PRIVATE_VALUE_TEXT_PATTERN.test(String(value ?? "")))) {
    throw new Error(
      `Public observation ${record.recordKey} must not contain current AUD planning values`,
    );
  }
}

/**
 * Validate a source-controlled observation without requiring a monetary pack.
 * A temporary zero-value scenario is used only to reuse the central public-text,
 * URL, confidence and relationship validation; it is never returned or stored.
 */
export function assertFullPotentialPublicObservationRecord(
  record: FullPotentialPublicObservationRecord,
): void {
  if (Object.prototype.hasOwnProperty.call(record, "scenarios")) {
    throw new Error("Public observation records must omit scenarios entirely");
  }
  assertNoPrivatePlanningText(record);

  const validationRecord: FullPotentialPublicEvidenceRecord = {
    ...record,
    scenarios: record.countingTreatment === "buyer_counting"
      ? zeroScenariosFor(record.scenarioBasis)
      : null,
  };
  assertFullPotentialPublicEvidenceRecord(validationRecord);
}

function countBy(
  records: FullPotentialPublicObservationRecord[],
  value: (record: FullPotentialPublicObservationRecord) => string,
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = value(record) || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

export function summarizeFullPotentialPublicObservations(
  records: FullPotentialPublicObservationRecord[],
): FullPotentialPublicObservationSummary {
  const recordKeys = new Set<string>();
  for (const record of records) {
    assertFullPotentialPublicObservationRecord(record);
    if (recordKeys.has(record.recordKey)) {
      throw new Error(`Duplicate public observation recordKey ${record.recordKey}`);
    }
    recordKeys.add(record.recordKey);
  }

  return {
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
    recordCount: records.length,
    countingRecordCount: records.filter(record => record.countingTreatment === "buyer_counting").length,
    nonCountingRecordCount: records.filter(record => record.countingTreatment !== "buyer_counting").length,
    byBuyerSegment: countBy(records, record => record.buyerSegment),
    byModelBand: countBy(records, record => record.modelBand ?? "unbanded"),
    byEvidenceGrade: countBy(records, record => record.evidenceGrade),
    byAddressabilityStatus: countBy(records, record => record.addressabilityStatus),
    byCountingTreatment: countBy(records, record => record.countingTreatment),
  };
}

/**
 * Join a public observation pack to a separately authorised restricted planning
 * pack. The join fails closed for missing, duplicate or orphan planning rows.
 */
export function materializeFullPotentialDraftPack(
  observations: FullPotentialPublicObservationRecord[],
  restrictedPlanning: FullPotentialRestrictedScenarioRecord[],
): FullPotentialMaterializedDraftPack {
  const observationByKey = new Map<string, FullPotentialPublicObservationRecord>();
  for (const observation of observations) {
    assertFullPotentialPublicObservationRecord(observation);
    if (observationByKey.has(observation.recordKey)) {
      throw new Error(`Duplicate public observation recordKey ${observation.recordKey}`);
    }
    observationByKey.set(observation.recordKey, observation);
  }

  const planningByKey = new Map<string, FullPotentialRestrictedScenarioRecord>();
  for (const planning of restrictedPlanning) {
    if (!OPAQUE_REFERENCE_PATTERN.test(planning.planningValueSetRef)) {
      throw new Error(
        `Restricted planning record ${planning.recordKey} has an invalid planningValueSetRef`,
      );
    }
    if (planningByKey.has(planning.recordKey)) {
      throw new Error(`Duplicate restricted planning recordKey ${planning.recordKey}`);
    }
    if (!observationByKey.has(planning.recordKey)) {
      throw new Error(`Restricted planning record ${planning.recordKey} has no public observation`);
    }
    planningByKey.set(planning.recordKey, planning);
  }

  const records: FullPotentialPublicEvidenceRecord[] = [];
  const planningEnvelopes: FullPotentialPrivatePlanningEnvelope[] = [];

  for (const observation of observations) {
    const planning = planningByKey.get(observation.recordKey);
    if (observation.countingTreatment === "buyer_counting") {
      if (!planning) {
        throw new Error(`Buyer-counting observation ${observation.recordKey} is missing restricted planning`);
      }
      const record: FullPotentialPublicEvidenceRecord = {
        ...observation,
        scenarios: planning.scenarios,
      };
      assertFullPotentialPublicEvidenceRecord(record);

      const envelope: FullPotentialPrivatePlanningEnvelope = {
        record,
        planningValueSetRef: planning.planningValueSetRef,
        planningValueBasis: planning.planningValueBasis,
        localisationUpliftStatus: planning.localisationUpliftStatus,
      };
      assertFullPotentialPrivatePlanningEnvelope(envelope);
      records.push(record);
      planningEnvelopes.push(envelope);
      continue;
    }

    if (planning) {
      throw new Error(`Non-counting observation ${observation.recordKey} must not have restricted planning`);
    }
    const record: FullPotentialPublicEvidenceRecord = {
      ...observation,
      scenarios: null,
    };
    assertFullPotentialPublicEvidenceRecord(record);
    records.push(record);
  }

  return {
    records,
    planningEnvelopes,
    publicObservationCount: observations.length,
    restrictedPlanningCount: restrictedPlanning.length,
    planningValueSetRefs: [...new Set(
      restrictedPlanning.map(record => record.planningValueSetRef),
    )].sort(),
  };
}
