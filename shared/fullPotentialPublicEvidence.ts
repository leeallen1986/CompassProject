import type { FpProductFamily } from "./const";

export const FP_PUBLIC_EVIDENCE_METHOD_VERSION = "fp-public-v1";
export const FP_PUBLIC_SCENARIOS = ["low", "base", "high"] as const;
export const FP_PUBLIC_EVIDENCE_GRADES = ["A", "B", "C"] as const;
export const FP_PUBLIC_COUNTING_TREATMENTS = [
  "buyer_counting",
  "context_non_counting",
  "application_overlay_non_counting",
] as const;
export const FP_PUBLIC_VALUE_CLASSES = [
  "named_evidenced_core",
  "regional_long_tail",
  "unobserved_allowance",
] as const;
export const FP_PUBLIC_SCENARIO_BASES = ["fleet_replacement", "adoption_positions"] as const;
export const FP_PUBLIC_ADDRESSABILITY_STATUSES = [
  "addressable_now",
  "conditional_factory_confirmation",
  "conditional_voltage",
  "conditional_compliance",
  "portfolio_gap",
  "excluded",
] as const;

export type FullPotentialPublicScenario = typeof FP_PUBLIC_SCENARIOS[number];
export type FullPotentialPublicEvidenceGrade = typeof FP_PUBLIC_EVIDENCE_GRADES[number];
export type FullPotentialPublicCountingTreatment = typeof FP_PUBLIC_COUNTING_TREATMENTS[number];
export type FullPotentialPublicValueClass = typeof FP_PUBLIC_VALUE_CLASSES[number];
export type FullPotentialPublicScenarioBasis = typeof FP_PUBLIC_SCENARIO_BASES[number];
export type FullPotentialPublicAddressabilityStatus = typeof FP_PUBLIC_ADDRESSABILITY_STATUSES[number];

export interface FullPotentialPublicScenarioAssumption {
  /** Required for fleet_replacement. This is an inferred range, not a customer-provided fleet fact. */
  estimatedFleetUnits?: number | null;
  /** Required for fleet_replacement. Percentage of the modelled fleet refreshed in the three-year horizon. */
  replacementSharePct?: number | null;
  /** Required for adoption_positions. Direct three-year adoption-position assumption. */
  adoptionPositions?: number | null;
  averageSellingPriceAud: number;
  addressableSharePct: number;
}

export interface FullPotentialPublicEvidenceRecord {
  recordKey: string;
  /** One commercial pool may have only one monetary counting record. */
  commercialPoolKey: string | null;
  buyerAccountKey: string | null;
  buyerName: string | null;
  buyerSegment: string;
  application: string;
  productFamily: FpProductFamily;
  productCell: string;
  countingTreatment: FullPotentialPublicCountingTreatment;
  valueClass: FullPotentialPublicValueClass;
  scenarioBasis: FullPotentialPublicScenarioBasis;
  scenarios?: Record<FullPotentialPublicScenario, FullPotentialPublicScenarioAssumption> | null;
  evidenceGrade: FullPotentialPublicEvidenceGrade;
  sourceName: string;
  sourceUrl: string;
  observedAt: string;
  publicObservation: string;
  inference: string;
  modelBand?: string | null;
  addressabilityStatus: FullPotentialPublicAddressabilityStatus;
  qualificationGates?: string[];
  methodologyVersion: typeof FP_PUBLIC_EVIDENCE_METHOD_VERSION;
}

export interface FullPotentialPublicScenarioResult {
  scenario: FullPotentialPublicScenario;
  modelledThreeYearUnits: number;
  potentialAud: number;
}

export interface FullPotentialPublicSummaryBucket {
  key: string;
  recordCount: number;
  lowAud: number;
  baseAud: number;
  highAud: number;
}

export interface FullPotentialPublicManagementSummary {
  methodologyVersion: typeof FP_PUBLIC_EVIDENCE_METHOD_VERSION;
  recordCount: number;
  countingRecordCount: number;
  nonCountingRecordCount: number;
  totals: Record<FullPotentialPublicScenario, number>;
  byBuyerSegment: FullPotentialPublicSummaryBucket[];
  byProductFamily: FullPotentialPublicSummaryBucket[];
  byProductCell: FullPotentialPublicSummaryBucket[];
  byEvidenceGrade: Array<FullPotentialPublicSummaryBucket & { evidenceGrade: FullPotentialPublicEvidenceGrade }>;
  byValueClass: Array<FullPotentialPublicSummaryBucket & { valueClass: FullPotentialPublicValueClass }>;
  qualificationGaps: Array<FullPotentialPublicSummaryBucket & {
    addressabilityStatus: FullPotentialPublicAddressabilityStatus;
  }>;
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?61|0)[\s().-]*(?:\d[\s().-]*){8,10}/;
const PRIVATE_LANGUAGE_PATTERN = /\b(?:customer said|customer told|private conversation|confidential tender|quote(?:d|ation)? price|discount|crm note|purchasing intent|intends? to buy|agreed to buy)\b/i;

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function finiteNonNegative(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
  return parsed;
}

function percentage(value: unknown, field: string): number {
  const parsed = finiteNonNegative(value, field);
  if (parsed > 100) throw new Error(`${field} cannot exceed 100`);
  return parsed;
}

function assertSafePublicText(value: unknown, field: string): void {
  const text = cleanText(value);
  if (!text) throw new Error(`${field} is required`);
  if (EMAIL_PATTERN.test(text)) throw new Error(`${field} must not contain an email address`);
  if (PHONE_PATTERN.test(text)) throw new Error(`${field} must not contain a phone number`);
  if (PRIVATE_LANGUAGE_PATTERN.test(text)) {
    throw new Error(`${field} appears to contain confidential/CRM-style intelligence`);
  }
}

function assertScenarioAssumption(
  scenario: FullPotentialPublicScenario,
  basis: FullPotentialPublicScenarioBasis,
  input: FullPotentialPublicScenarioAssumption,
): void {
  finiteNonNegative(input.averageSellingPriceAud, `${scenario}.averageSellingPriceAud`);
  percentage(input.addressableSharePct, `${scenario}.addressableSharePct`);

  if (basis === "fleet_replacement") {
    finiteNonNegative(input.estimatedFleetUnits, `${scenario}.estimatedFleetUnits`);
    percentage(input.replacementSharePct, `${scenario}.replacementSharePct`);
    if (input.adoptionPositions !== undefined && input.adoptionPositions !== null) {
      throw new Error(`${scenario}.adoptionPositions is not valid for fleet_replacement`);
    }
    return;
  }

  finiteNonNegative(input.adoptionPositions, `${scenario}.adoptionPositions`);
  if (input.estimatedFleetUnits !== undefined && input.estimatedFleetUnits !== null) {
    throw new Error(`${scenario}.estimatedFleetUnits is not valid for adoption_positions`);
  }
  if (input.replacementSharePct !== undefined && input.replacementSharePct !== null) {
    throw new Error(`${scenario}.replacementSharePct is not valid for adoption_positions`);
  }
}

export function assertFullPotentialPublicEvidenceRecord(
  record: FullPotentialPublicEvidenceRecord,
): void {
  if (record.methodologyVersion !== FP_PUBLIC_EVIDENCE_METHOD_VERSION) {
    throw new Error(`Unsupported methodologyVersion ${record.methodologyVersion}`);
  }
  if (!cleanText(record.recordKey)) throw new Error("recordKey is required");
  if (!cleanText(record.buyerSegment)) throw new Error("buyerSegment is required");
  if (!cleanText(record.application)) throw new Error("application is required");
  if (!cleanText(record.productCell)) throw new Error("productCell is required");
  if (!cleanText(record.sourceName)) throw new Error("sourceName is required");
  if (!/^https:\/\//i.test(cleanText(record.sourceUrl))) {
    throw new Error("sourceUrl must be an https URL");
  }
  if (Number.isNaN(Date.parse(record.observedAt))) throw new Error("observedAt must be a valid date");
  assertSafePublicText(record.publicObservation, "publicObservation");
  assertSafePublicText(record.inference, "inference");

  if (record.countingTreatment === "buyer_counting") {
    if (!cleanText(record.commercialPoolKey)) throw new Error("buyer_counting records require commercialPoolKey");
    if (!cleanText(record.buyerAccountKey)) throw new Error("buyer_counting records require buyerAccountKey");
    if (!cleanText(record.buyerName)) throw new Error("buyer_counting records require buyerName");
    if (!record.scenarios) throw new Error("buyer_counting records require Low/Base/High scenarios");
    for (const scenario of FP_PUBLIC_SCENARIOS) {
      assertScenarioAssumption(scenario, record.scenarioBasis, record.scenarios[scenario]);
    }
  } else {
    if (record.scenarios !== undefined && record.scenarios !== null) {
      throw new Error("non-counting records must not carry monetary scenarios");
    }
    if (record.commercialPoolKey !== null && !cleanText(record.commercialPoolKey)) {
      throw new Error("commercialPoolKey must be null or non-empty");
    }
  }

  for (const gate of record.qualificationGates ?? []) {
    assertSafePublicText(gate, "qualificationGate");
  }
}

export function calculateFullPotentialPublicScenario(
  record: FullPotentialPublicEvidenceRecord,
  scenario: FullPotentialPublicScenario,
): FullPotentialPublicScenarioResult {
  assertFullPotentialPublicEvidenceRecord(record);
  if (record.countingTreatment !== "buyer_counting" || !record.scenarios) {
    return { scenario, modelledThreeYearUnits: 0, potentialAud: 0 };
  }
  if (record.addressabilityStatus === "portfolio_gap" || record.addressabilityStatus === "excluded") {
    return { scenario, modelledThreeYearUnits: 0, potentialAud: 0 };
  }

  const assumptions = record.scenarios[scenario];
  const modelledThreeYearUnits = record.scenarioBasis === "fleet_replacement"
    ? finiteNonNegative(assumptions.estimatedFleetUnits, `${scenario}.estimatedFleetUnits`)
      * (percentage(assumptions.replacementSharePct, `${scenario}.replacementSharePct`) / 100)
    : finiteNonNegative(assumptions.adoptionPositions, `${scenario}.adoptionPositions`);

  const potentialAud = modelledThreeYearUnits
    * finiteNonNegative(assumptions.averageSellingPriceAud, `${scenario}.averageSellingPriceAud`)
    * (percentage(assumptions.addressableSharePct, `${scenario}.addressableSharePct`) / 100);

  return {
    scenario,
    modelledThreeYearUnits,
    potentialAud: Math.round((potentialAud + Number.EPSILON) * 100) / 100,
  };
}

function emptyBucket(key: string): FullPotentialPublicSummaryBucket {
  return { key, recordCount: 0, lowAud: 0, baseAud: 0, highAud: 0 };
}

function addToBucket(
  map: Map<string, FullPotentialPublicSummaryBucket>,
  key: string,
  record: FullPotentialPublicEvidenceRecord,
): void {
  const bucket = map.get(key) ?? emptyBucket(key);
  bucket.recordCount += 1;
  bucket.lowAud += calculateFullPotentialPublicScenario(record, "low").potentialAud;
  bucket.baseAud += calculateFullPotentialPublicScenario(record, "base").potentialAud;
  bucket.highAud += calculateFullPotentialPublicScenario(record, "high").potentialAud;
  map.set(key, bucket);
}

function roundedBucket(bucket: FullPotentialPublicSummaryBucket): FullPotentialPublicSummaryBucket {
  return {
    ...bucket,
    lowAud: Math.round((bucket.lowAud + Number.EPSILON) * 100) / 100,
    baseAud: Math.round((bucket.baseAud + Number.EPSILON) * 100) / 100,
    highAud: Math.round((bucket.highAud + Number.EPSILON) * 100) / 100,
  };
}

function sortedBuckets(map: Map<string, FullPotentialPublicSummaryBucket>): FullPotentialPublicSummaryBucket[] {
  return [...map.values()]
    .map(roundedBucket)
    .sort((left, right) => right.baseAud - left.baseAud || left.key.localeCompare(right.key));
}

export function summarizeFullPotentialPublicEvidence(
  records: FullPotentialPublicEvidenceRecord[],
): FullPotentialPublicManagementSummary {
  const recordKeys = new Set<string>();
  const countingPoolKeys = new Set<string>();
  const buyerSegments = new Map<string, FullPotentialPublicSummaryBucket>();
  const productFamilies = new Map<string, FullPotentialPublicSummaryBucket>();
  const productCells = new Map<string, FullPotentialPublicSummaryBucket>();
  const evidenceGrades = new Map<string, FullPotentialPublicSummaryBucket>();
  const valueClasses = new Map<string, FullPotentialPublicSummaryBucket>();
  const qualificationStatuses = new Map<string, FullPotentialPublicSummaryBucket>();

  for (const record of records) {
    assertFullPotentialPublicEvidenceRecord(record);
    if (recordKeys.has(record.recordKey)) throw new Error(`Duplicate recordKey ${record.recordKey}`);
    recordKeys.add(record.recordKey);

    if (record.countingTreatment === "buyer_counting") {
      const poolKey = cleanText(record.commercialPoolKey);
      if (countingPoolKeys.has(poolKey)) {
        throw new Error(`Duplicate monetary commercialPoolKey ${poolKey}`);
      }
      countingPoolKeys.add(poolKey);
    }

    addToBucket(buyerSegments, record.buyerSegment, record);
    addToBucket(productFamilies, record.productFamily, record);
    addToBucket(productCells, record.productCell, record);
    addToBucket(evidenceGrades, record.evidenceGrade, record);
    addToBucket(valueClasses, record.valueClass, record);
    addToBucket(qualificationStatuses, record.addressabilityStatus, record);
  }

  const totals = Object.fromEntries(
    FP_PUBLIC_SCENARIOS.map(scenario => [
      scenario,
      Math.round((records.reduce(
        (sum, record) => sum + calculateFullPotentialPublicScenario(record, scenario).potentialAud,
        0,
      ) + Number.EPSILON) * 100) / 100,
    ]),
  ) as Record<FullPotentialPublicScenario, number>;

  return {
    methodologyVersion: FP_PUBLIC_EVIDENCE_METHOD_VERSION,
    recordCount: records.length,
    countingRecordCount: records.filter(record => record.countingTreatment === "buyer_counting").length,
    nonCountingRecordCount: records.filter(record => record.countingTreatment !== "buyer_counting").length,
    totals,
    byBuyerSegment: sortedBuckets(buyerSegments),
    byProductFamily: sortedBuckets(productFamilies),
    byProductCell: sortedBuckets(productCells),
    byEvidenceGrade: sortedBuckets(evidenceGrades).map(bucket => ({
      ...bucket,
      evidenceGrade: bucket.key as FullPotentialPublicEvidenceGrade,
    })),
    byValueClass: sortedBuckets(valueClasses).map(bucket => ({
      ...bucket,
      valueClass: bucket.key as FullPotentialPublicValueClass,
    })),
    qualificationGaps: sortedBuckets(qualificationStatuses)
      .filter(bucket => bucket.key !== "addressable_now")
      .map(bucket => ({
        ...bucket,
        addressabilityStatus: bucket.key as FullPotentialPublicAddressabilityStatus,
      })),
  };
}

/**
 * Bridge to the existing Full Potential V1 model-line `assumptions` JSON field.
 * This does not approve or write model values; it preserves the public-evidence
 * scenario contract for a later draft-only import/review workflow.
 */
export function toFullPotentialModelAssumptions(
  record: FullPotentialPublicEvidenceRecord,
): Record<string, unknown> {
  assertFullPotentialPublicEvidenceRecord(record);
  return {
    publicEvidenceMethodologyVersion: record.methodologyVersion,
    publicEvidenceRecordKey: record.recordKey,
    commercialPoolKey: record.commercialPoolKey,
    countingTreatment: record.countingTreatment,
    valueClass: record.valueClass,
    evidenceGrade: record.evidenceGrade,
    publicObservation: record.publicObservation,
    inference: record.inference,
    modelBand: record.modelBand ?? null,
    productCell: record.productCell,
    scenarioBasis: record.scenarioBasis,
    scenarios: record.scenarios ?? null,
    addressabilityStatus: record.addressabilityStatus,
    qualificationGates: record.qualificationGates ?? [],
  };
}
