import {
  FP_PUBLIC_SCENARIOS,
  calculateFullPotentialPublicScenario,
  summarizeFullPotentialPublicEvidence,
  type FullPotentialPublicEvidenceGrade,
  type FullPotentialPublicEvidenceRecord,
  type FullPotentialPublicScenario,
} from "./fullPotentialPublicEvidence";
import {
  FP_TS2_SURFACE_POSITION_CLASSES,
  FP_UNDERGROUND_POSITION_CLASSES,
  type FullPotentialTs2SurfacePositionClass,
  type FullPotentialUndergroundPositionClass,
} from "./fullPotentialPublicBands";

export interface FullPotentialManagementScenarioValue {
  lowAud: number;
  baseAud: number;
  highAud: number;
}

export interface FullPotentialManagementPositionUniverse {
  low: number;
  base: number;
  high: number;
}

export interface FullPotentialManagementRow extends FullPotentialManagementScenarioValue {
  key: string;
  label: string;
  recordCount: number;
  shareOfBasePct: number;
}

export interface FullPotentialManagementCurrentRevenueInput {
  buyerSegment: string;
  currentRevenueAud: number;
  periodLabel: string;
  sourceReference: string;
}

export interface FullPotentialManagementBuyerRow extends FullPotentialManagementRow {
  currentRevenueAud: number | null;
  currentRevenuePeriod: string | null;
  currentRevenueSourceReference: string | null;
  remainingBasePotentialAud: number | null;
}

export interface FullPotentialManagementCoverageCount {
  key: string;
  label: string;
  count: number;
}

export interface FullPotentialManagementQualificationRecord {
  recordKey: string;
  buyerName: string;
  buyerAccountKey: string | null;
  buyerSegment: string;
  application: string;
  productCell: string;
  modelBand: string | null;
  evidenceGrade: FullPotentialPublicEvidenceGrade;
  addressabilityStatus: FullPotentialPublicEvidenceRecord["addressabilityStatus"];
  sourceName: string;
  sourceUrl: string;
}

export interface FullPotentialSeptemberManagementView {
  methodologyVersion: string;
  generatedFromRecordCount: number;
  countingRecordCount: number;
  nonCountingRecordCount: number;
  headline: {
    namedEvidencedCore: FullPotentialManagementScenarioValue;
    regionalLongTail: FullPotentialManagementScenarioValue;
    unobservedAllowance: FullPotentialManagementScenarioValue;
    total: FullPotentialManagementScenarioValue;
  };
  addressability: {
    addressableNow: FullPotentialManagementScenarioValue;
    conditional: FullPotentialManagementScenarioValue;
    portfolioGapRecordCount: number;
    excludedRecordCount: number;
  };
  qualificationUniverse: {
    namedBuyerContextCount: number;
    ts2SurfacePositionUniverse: FullPotentialManagementPositionUniverse;
    ts3UndergroundPositionUniverse: FullPotentialManagementPositionUniverse;
    byBuyerSegment: FullPotentialManagementCoverageCount[];
    byProductCell: FullPotentialManagementCoverageCount[];
    byModelBand: FullPotentialManagementCoverageCount[];
    records: FullPotentialManagementQualificationRecord[];
  };
  confidence: Array<FullPotentialManagementRow & {
    evidenceGrade: FullPotentialPublicEvidenceGrade;
  }>;
  buyerSegments: FullPotentialManagementBuyerRow[];
  productCells: FullPotentialManagementRow[];
  qualificationGaps: FullPotentialManagementRow[];
  reconciliation: {
    buyerSegmentBaseAud: number;
    headlineBaseAud: number;
    differenceAud: number;
    reconciled: boolean;
  };
  governanceNotes: string[];
}

const LABELS: Record<string, string> = {
  rental_hire: "Rental Hire",
  mining_direct: "Mining — direct buyer",
  underground_mining: "Underground mining",
  industrial_manufacturing: "Industrial / manufacturing",
  infrastructure_utilities: "Infrastructure / utilities",
  specialist_rental_application: "Specialist rental application",
  cross_segment_application: "Cross-segment application",
  named_evidenced_core: "Named Evidenced Core",
  regional_long_tail: "Regional Long Tail",
  unobserved_allowance: "Unobserved Allowance",
  addressable_now: "Addressable now",
  conditional_factory_confirmation: "Factory confirmation required",
  conditional_voltage: "Voltage confirmation required",
  conditional_compliance: "Local engineering / compliance required",
  portfolio_gap: "Portfolio gap",
  excluded: "Excluded",
  A: "A — directly observed public evidence",
  B: "B — strong public-evidence inference",
  C: "C — modelled adoption assumption",
  S1: "S1 — early surface qualification",
  S2: "S2 — material surface qualification",
  S3: "S3 — priority surface qualification",
  U1: "U1 — smaller underground qualification",
  U2: "U2 — significant underground qualification",
  U3: "U3 — priority underground / multi-front qualification",
};

function money(value: number): number {
  return Math.round((Math.max(0, value) + Number.EPSILON) * 100) / 100;
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round(((part / total) * 100 + Number.EPSILON) * 10) / 10;
}

function scenarioValue(
  records: FullPotentialPublicEvidenceRecord[],
): FullPotentialManagementScenarioValue {
  const total = (scenario: FullPotentialPublicScenario) => money(records.reduce(
    (sum, record) => sum + calculateFullPotentialPublicScenario(record, scenario).potentialAud,
    0,
  ));
  return {
    lowAud: total("low"),
    baseAud: total("base"),
    highAud: total("high"),
  };
}

function managementRow(
  key: string,
  recordCount: number,
  value: FullPotentialManagementScenarioValue,
  totalBase: number,
): FullPotentialManagementRow {
  return {
    key,
    label: LABELS[key] ?? key.replace(/_/g, " "),
    recordCount,
    ...value,
    shareOfBasePct: percent(value.baseAud, totalBase),
  };
}

function rowsBy(
  records: FullPotentialPublicEvidenceRecord[],
  keyOf: (record: FullPotentialPublicEvidenceRecord) => string,
  totalBase: number,
): FullPotentialManagementRow[] {
  const grouped = new Map<string, FullPotentialPublicEvidenceRecord[]>();
  for (const record of records) {
    const key = keyOf(record) || "unknown";
    const rows = grouped.get(key) ?? [];
    rows.push(record);
    grouped.set(key, rows);
  }
  return [...grouped.entries()]
    .map(([key, rows]) => managementRow(key, rows.length, scenarioValue(rows), totalBase))
    .sort((left, right) => right.baseAud - left.baseAud || left.label.localeCompare(right.label));
}

function coverageCounts(
  records: FullPotentialPublicEvidenceRecord[],
  keyOf: (record: FullPotentialPublicEvidenceRecord) => string,
): FullPotentialManagementCoverageCount[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = keyOf(record) || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: LABELS[key] ?? key.replace(/_/g, " "),
      count,
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function ts2SurfacePositionUniverse(
  records: FullPotentialPublicEvidenceRecord[],
): FullPotentialManagementPositionUniverse {
  const total = { low: 0, base: 0, high: 0 };
  for (const record of records) {
    const band = record.modelBand as FullPotentialTs2SurfacePositionClass | null;
    if (!band || !(band in FP_TS2_SURFACE_POSITION_CLASSES)) continue;
    const positions = FP_TS2_SURFACE_POSITION_CLASSES[band];
    total.low += positions.low;
    total.base += positions.base;
    total.high += positions.high;
  }
  return total;
}

function ts3UndergroundPositionUniverse(
  records: FullPotentialPublicEvidenceRecord[],
): FullPotentialManagementPositionUniverse {
  const total = { low: 0, base: 0, high: 0 };
  for (const record of records) {
    const band = record.modelBand as FullPotentialUndergroundPositionClass | null;
    if (!band || !(band in FP_UNDERGROUND_POSITION_CLASSES)) continue;
    const positions = FP_UNDERGROUND_POSITION_CLASSES[band];
    total.low += positions.low;
    total.base += positions.base;
    total.high += positions.high;
  }
  return total;
}

function revenueBySegment(
  inputs: FullPotentialManagementCurrentRevenueInput[],
): Map<string, FullPotentialManagementCurrentRevenueInput> {
  const result = new Map<string, FullPotentialManagementCurrentRevenueInput>();
  for (const input of inputs) {
    if (!input.buyerSegment.trim()) throw new Error("current revenue buyerSegment is required");
    if (!Number.isFinite(input.currentRevenueAud) || input.currentRevenueAud < 0) {
      throw new Error(`current revenue for ${input.buyerSegment} must be a non-negative number`);
    }
    if (!input.periodLabel.trim() || !input.sourceReference.trim()) {
      throw new Error(`current revenue for ${input.buyerSegment} requires period and source reference`);
    }
    if (result.has(input.buyerSegment)) {
      throw new Error(`Duplicate current revenue input for ${input.buyerSegment}`);
    }
    result.set(input.buyerSegment, input);
  }
  return result;
}

/**
 * Build the management view from an already materialized and validated evidence
 * pack. The function does not import, approve or mutate Full Potential data.
 */
export function buildFullPotentialSeptemberManagementView(
  records: FullPotentialPublicEvidenceRecord[],
  currentRevenueInputs: FullPotentialManagementCurrentRevenueInput[] = [],
): FullPotentialSeptemberManagementView {
  const summary = summarizeFullPotentialPublicEvidence(records);
  const total = {
    lowAud: summary.totals.low,
    baseAud: summary.totals.base,
    highAud: summary.totals.high,
  };
  const revenue = revenueBySegment(currentRevenueInputs);

  const valueClassRows = rowsBy(records, record => record.valueClass, total.baseAud);
  const valueClassValue = (key: string) => {
    const row = valueClassRows.find(candidate => candidate.key === key);
    return row
      ? { lowAud: row.lowAud, baseAud: row.baseAud, highAud: row.highAud }
      : { lowAud: 0, baseAud: 0, highAud: 0 };
  };

  const addressableRecords = records.filter(record => record.addressabilityStatus === "addressable_now");
  const conditionalRecords = records.filter(record => [
    "conditional_factory_confirmation",
    "conditional_voltage",
    "conditional_compliance",
  ].includes(record.addressabilityStatus));

  const namedQualificationRecords = records
    .filter(record => (
      record.countingTreatment !== "buyer_counting"
      && Boolean(record.buyerName?.trim())
      && Boolean(record.buyerAccountKey?.trim())
    ));

  const buyerSegments = rowsBy(records, record => record.buyerSegment, total.baseAud)
    .filter(row => row.baseAud > 0 || revenue.has(row.key))
    .map(row => {
      const current = revenue.get(row.key);
      return {
        ...row,
        currentRevenueAud: current ? money(current.currentRevenueAud) : null,
        currentRevenuePeriod: current?.periodLabel ?? null,
        currentRevenueSourceReference: current?.sourceReference ?? null,
        remainingBasePotentialAud: current
          ? money(Math.max(row.baseAud - current.currentRevenueAud, 0))
          : null,
      };
    });

  for (const input of currentRevenueInputs) {
    if (!buyerSegments.some(row => row.key === input.buyerSegment)) {
      buyerSegments.push({
        ...managementRow(
          input.buyerSegment,
          0,
          { lowAud: 0, baseAud: 0, highAud: 0 },
          total.baseAud,
        ),
        currentRevenueAud: money(input.currentRevenueAud),
        currentRevenuePeriod: input.periodLabel,
        currentRevenueSourceReference: input.sourceReference,
        remainingBasePotentialAud: 0,
      });
    }
  }
  buyerSegments.sort((left, right) => right.baseAud - left.baseAud || left.label.localeCompare(right.label));

  const confidence = rowsBy(records, record => record.evidenceGrade, total.baseAud)
    .map(row => ({
      ...row,
      evidenceGrade: row.key as FullPotentialPublicEvidenceGrade,
    }));

  const qualificationGaps = rowsBy(
    records.filter(record => record.addressabilityStatus !== "addressable_now"),
    record => record.addressabilityStatus,
    total.baseAud,
  );

  const buyerSegmentBaseAud = money(buyerSegments.reduce((sum, row) => sum + row.baseAud, 0));
  const differenceAud = money(Math.abs(buyerSegmentBaseAud - total.baseAud));

  return {
    methodologyVersion: summary.methodologyVersion,
    generatedFromRecordCount: summary.recordCount,
    countingRecordCount: summary.countingRecordCount,
    nonCountingRecordCount: summary.nonCountingRecordCount,
    headline: {
      namedEvidencedCore: valueClassValue("named_evidenced_core"),
      regionalLongTail: valueClassValue("regional_long_tail"),
      unobservedAllowance: valueClassValue("unobserved_allowance"),
      total,
    },
    addressability: {
      addressableNow: scenarioValue(addressableRecords),
      conditional: scenarioValue(conditionalRecords),
      portfolioGapRecordCount: records.filter(
        record => record.addressabilityStatus === "portfolio_gap",
      ).length,
      excludedRecordCount: records.filter(
        record => record.addressabilityStatus === "excluded",
      ).length,
    },
    qualificationUniverse: {
      namedBuyerContextCount: namedQualificationRecords.length,
      ts2SurfacePositionUniverse: ts2SurfacePositionUniverse(namedQualificationRecords),
      ts3UndergroundPositionUniverse: ts3UndergroundPositionUniverse(namedQualificationRecords),
      byBuyerSegment: coverageCounts(namedQualificationRecords, record => record.buyerSegment),
      byProductCell: coverageCounts(namedQualificationRecords, record => record.productCell),
      byModelBand: coverageCounts(namedQualificationRecords, record => record.modelBand ?? "unbanded"),
      records: namedQualificationRecords
        .map(record => ({
          recordKey: record.recordKey,
          buyerName: record.buyerName as string,
          buyerAccountKey: record.buyerAccountKey,
          buyerSegment: record.buyerSegment,
          application: record.application,
          productCell: record.productCell,
          modelBand: record.modelBand ?? null,
          evidenceGrade: record.evidenceGrade,
          addressabilityStatus: record.addressabilityStatus,
          sourceName: record.sourceName,
          sourceUrl: record.sourceUrl,
        }))
        .sort((left, right) => (
          (right.modelBand ?? "").localeCompare(left.modelBand ?? "")
          || left.buyerName.localeCompare(right.buyerName)
        )),
    },
    confidence,
    buyerSegments,
    productCells: rowsBy(records, record => record.productCell, total.baseAud),
    qualificationGaps,
    reconciliation: {
      buyerSegmentBaseAud,
      headlineBaseAud: total.baseAud,
      differenceAud,
      reconciled: differenceAud === 0,
    },
    governanceNotes: [
      "Only buyer-counting records carry monetary Full Potential.",
      "Application and site overlays remain visible but non-counting.",
      "Named non-counting buyer contexts are qualification targets, not asserted pipeline or installed-base facts.",
      "TS2 S-classes and TS3 U-classes express non-monetary adoption-position universes, not installed equipment or sales forecasts.",
      "Named Evidenced Core is shown separately from Regional Long Tail and Unobserved Allowance.",
      "Low, Base and High are transparent scenarios, not asserted customer fleet facts.",
      "Current revenue inputs are aggregate planning references and do not contain customer contacts, conversations or quotation detail.",
    ],
  };
}

export function assertFullPotentialManagementViewReconciles(
  view: FullPotentialSeptemberManagementView,
): void {
  if (!view.reconciliation.reconciled || view.reconciliation.differenceAud !== 0) {
    throw new Error(
      `Management view does not reconcile: difference ${view.reconciliation.differenceAud}`,
    );
  }
  for (const scenario of FP_PUBLIC_SCENARIOS) {
    const field = `${scenario}Aud` as keyof FullPotentialManagementScenarioValue;
    const classes = money(
      view.headline.namedEvidencedCore[field]
      + view.headline.regionalLongTail[field]
      + view.headline.unobservedAllowance[field],
    );
    if (classes !== view.headline.total[field]) {
      throw new Error(`Management value classes do not reconcile for ${scenario}`);
    }
  }
}
