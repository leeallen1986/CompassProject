export const FP_PRODUCT_FAMILIES = [
  "portable_air_small_medium",
  "portable_air_large",
  "specialty_air_boosters",
  "e_air",
  "dryers",
  "nitrogen",
  "dewatering",
  "generators",
  "bess",
  "lighting",
  "other",
] as const;

export type FpProductFamily = (typeof FP_PRODUCT_FAMILIES)[number];

export const FP_PRODUCT_FAMILY_LABELS: Record<FpProductFamily, string> = {
  portable_air_small_medium: "Portable air — small / medium",
  portable_air_large: "Portable air — large",
  specialty_air_boosters: "Specialty air / boosters",
  e_air: "E-Air",
  dryers: "Dryers",
  nitrogen: "Nitrogen",
  dewatering: "Dewatering",
  generators: "Generators",
  bess: "Battery energy storage",
  lighting: "Lighting",
  other: "Other",
};

export const FP_EVIDENCE_TYPES = [
  "internal_order_history",
  "crm_history",
  "service_warranty",
  "fleetlink",
  "distributor_channel",
  "customer_discovery",
  "public_source",
  "tender_project",
  "financial_assumption",
  "other",
] as const;
export type FpEvidenceType = (typeof FP_EVIDENCE_TYPES)[number];

export const FP_EVIDENCE_TYPE_LABELS: Record<FpEvidenceType, string> = {
  internal_order_history: "Internal order history",
  crm_history: "CRM history",
  service_warranty: "Service / warranty",
  fleetlink: "Fleetlink",
  distributor_channel: "Distributor / channel",
  customer_discovery: "Customer discovery",
  public_source: "Public source",
  tender_project: "Tender / project",
  financial_assumption: "Financial assumption",
  other: "Other",
};

export const FP_CONFIDENCE_LEVELS = ["high", "medium", "low", "unknown"] as const;
export type FpConfidenceLevel = (typeof FP_CONFIDENCE_LEVELS)[number];

export const FP_ROUTE_VALUES = [
  "direct_ape",
  "cea",
  "cp_aps",
  "cp_blastone",
  "cp_pneumatic_engineering",
  "cp_more_air",
  "nz_distributor",
  "png_oceania",
  "hybrid_strategic",
  "product_support",
  "manual_review",
  "exclude",
] as const;
export type FpRouteToMarket = (typeof FP_ROUTE_VALUES)[number];

export const FP_ROUTE_LABELS: Record<FpRouteToMarket, string> = {
  direct_ape: "Direct APE",
  cea: "CEA",
  cp_aps: "CP — APS",
  cp_blastone: "CP — BlastOne",
  cp_pneumatic_engineering: "CP — Pneumatic Engineering",
  cp_more_air: "CP — More Air",
  nz_distributor: "NZ distributor",
  png_oceania: "PNG / Oceania",
  hybrid_strategic: "Hybrid strategic",
  product_support: "Product support",
  manual_review: "Manual review",
  exclude: "Exclude",
};

export const FP_RELATIONSHIP_TYPES = [
  "standalone",
  "parent",
  "division",
  "branch",
  "site",
  "service_unit",
  "strategic_context",
  "duplicate",
] as const;
export type FpRelationshipType = (typeof FP_RELATIONSHIP_TYPES)[number];

export const FP_RELATIONSHIP_LABELS: Record<FpRelationshipType, string> = {
  standalone: "Standalone",
  parent: "Parent",
  division: "Division",
  branch: "Branch",
  site: "Site",
  service_unit: "Service unit",
  strategic_context: "Strategic context",
  duplicate: "Duplicate",
};

export const FP_RECORD_STATUSES = ["active", "under_review", "merged", "parked", "excluded"] as const;
export type FpRecordStatus = (typeof FP_RECORD_STATUSES)[number];

export const FP_RECORD_STATUS_LABELS: Record<FpRecordStatus, string> = {
  active: "Active",
  under_review: "Under review",
  merged: "Merged",
  parked: "Parked",
  excluded: "Excluded",
};

export type FpEvidenceStatus = "draft" | "verified" | "rejected" | "superseded";
export type FpModelStatus = "draft" | "submitted" | "returned" | "approved" | "superseded";
export type FpModelReviewAction = "created" | "submitted" | "returned" | "approved" | "reopened" | "superseded";

export interface CommercialAccount {
  id: number;
  canonicalName: string;
  displayName?: string | null;
  rowClass: string;
  routeToMarket: FpRouteToMarket;
  fpStatus: string;
  currentRevenueAud?: string | number | null;
  fullPotentialAud?: string | number | null;
  remainingPotentialAud?: string | number | null;
  confidenceLevel?: FpConfidenceLevel | null;
  currentSupplier?: string | null;
  parentAccountId?: number | null;
  mergedIntoAccountId?: number | null;
  relationshipType: FpRelationshipType;
  recordStatus: FpRecordStatus;
  countsTowardPotential: boolean;
}

export interface CommercialEvidence {
  id: number;
  accountId: number;
  productFamily?: FpProductFamily | null;
  evidenceType: FpEvidenceType;
  title: string;
  summary: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceReference?: string | null;
  observedAt?: string | Date | null;
  capturedBy?: number | null;
  capturedByName?: string | null;
  confidenceLevel: FpConfidenceLevel;
  status: FpEvidenceStatus;
  reviewNote?: string | null;
  reviewedBy?: number | null;
  reviewedByName?: string | null;
  reviewedAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface CommercialModel {
  id: number;
  modelKey: string;
  accountId: number;
  versionNumber: number;
  status: FpModelStatus;
  methodologyVersion: string;
  currentRevenueAud?: string | number | null;
  totalPotentialAud?: string | number | null;
  remainingPotentialAud?: string | number | null;
  confidenceLevel: FpConfidenceLevel;
  assumptionsSummary?: string | null;
  createdBy: number;
  createdByName?: string | null;
  submittedBy?: number | null;
  submittedByName?: string | null;
  submittedAt?: string | Date | null;
  reviewedBy?: number | null;
  reviewedByName?: string | null;
  reviewedAt?: string | Date | null;
  reviewNotes?: string | null;
  approvedAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface CommercialModelLine {
  id: number;
  lineKey: string;
  modelId: number;
  accountId: number;
  productFamily: FpProductFamily;
  application: string;
  routeToMarket: FpRouteToMarket;
  currentSupplier?: string | null;
  currentRevenueAud?: string | number | null;
  knownAtlasFleetUnits?: number | null;
  estimatedTotalFleetUnits?: number | null;
  replacementCycleYears?: string | number | null;
  annualReplacementUnits?: string | number | null;
  averageSellingPriceAud?: string | number | null;
  addressableSharePct?: string | number | null;
  equipmentPotentialAud?: string | number | null;
  specialtyPotentialAud?: string | number | null;
  linePotentialAud: string | number;
  replacementCycleSource?: string | null;
  assumptions?: Record<string, unknown> | null;
  confidenceLevel: FpConfidenceLevel;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface CommercialEvidenceLink {
  id: number;
  modelId: number;
  modelLineId?: number | null;
  evidenceId: number;
}

export interface CommercialModelReview {
  id: number;
  modelId: number;
  accountId: number;
  action: FpModelReviewAction;
  fromStatus?: string | null;
  toStatus: string;
  userId: number;
  userName?: string | null;
  note?: string | null;
  createdAt: string | Date;
}

export interface CommercialWorkspace {
  account: CommercialAccount;
  aliases: Array<{ id: number; aliasName: string; aliasType: string }>;
  children: CommercialAccount[];
  models: CommercialModel[];
  latestModel: CommercialModel | null;
  approvedModel: CommercialModel | null;
  lines: CommercialModelLine[];
  evidence: CommercialEvidence[];
  evidenceLinks: CommercialEvidenceLink[];
  reviews: CommercialModelReview[];
}

export interface EvidenceDraftPayload {
  accountId: number;
  productFamily?: FpProductFamily | null;
  evidenceType: FpEvidenceType;
  title: string;
  summary: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceReference?: string | null;
  observedAt?: string | null;
  confidenceLevel: FpConfidenceLevel;
}

export interface ModelLineDraftPayload {
  modelId: number;
  productFamily: FpProductFamily;
  application: string;
  routeToMarket: FpRouteToMarket;
  currentSupplier?: string | null;
  currentRevenueAud?: string | null;
  knownAtlasFleetUnits?: number | null;
  estimatedTotalFleetUnits?: number | null;
  replacementCycleYears?: string | null;
  annualReplacementUnits?: string | null;
  averageSellingPriceAud?: string | null;
  addressableSharePct?: string | null;
  specialtyPotentialAud?: string | null;
  replacementCycleSource?: string | null;
  assumptions?: Record<string, unknown> | null;
  confidenceLevel: FpConfidenceLevel;
  evidenceIds: number[];
}

export interface RelationshipPayload {
  parentAccountId?: number | null;
  mergedIntoAccountId?: number | null;
  relationshipType: FpRelationshipType;
  recordStatus: FpRecordStatus;
  countsTowardPotential: boolean;
}

export class CommercialModelApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "CommercialModelApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const hasBody = init.body !== undefined && init.body !== null;
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      Accept: "application/json",
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => null) as
    | { error?: string; code?: string; details?: unknown }
    | T
    | null;

  if (!response.ok) {
    const errorPayload = payload && typeof payload === "object"
      ? payload as { error?: string; code?: string; details?: unknown }
      : null;
    throw new CommercialModelApiError(
      errorPayload?.error || `Commercial model request failed (${response.status})`,
      response.status,
      errorPayload?.code,
      errorPayload?.details,
    );
  }

  return payload as T;
}

function body(value: unknown): string {
  return JSON.stringify(value);
}

export const commercialModelApi = {
  workspace(accountId: number) {
    return requestJson<CommercialWorkspace>(`/api/full-potential/commercial-model/${accountId}`);
  },
  createDraft(accountId: number) {
    return requestJson<{ model: CommercialModel; alreadyExists: boolean }>(
      `/api/full-potential/commercial-model/${accountId}/draft`,
      { method: "POST" },
    );
  },
  addEvidence(payload: EvidenceDraftPayload) {
    return requestJson<CommercialEvidence>("/api/full-potential/commercial-model/evidence", {
      method: "POST",
      body: body(payload),
    });
  },
  reviewEvidence(evidenceId: number, decision: "verified" | "rejected" | "superseded", note: string) {
    return requestJson<CommercialEvidence>(
      `/api/full-potential/commercial-model/evidence/${evidenceId}/review`,
      { method: "POST", body: body({ decision, note }) },
    );
  },
  upsertLine(payload: ModelLineDraftPayload) {
    return requestJson<{ line: CommercialModelLine; model: CommercialModel }>(
      "/api/full-potential/commercial-model/line",
      { method: "PUT", body: body(payload) },
    );
  },
  removeLine(lineId: number) {
    return requestJson<{ deleted: true }>(`/api/full-potential/commercial-model/line/${lineId}`, {
      method: "DELETE",
    });
  },
  submit(modelId: number, assumptionsSummary: string) {
    return requestJson<{
      status: "submitted";
      totalPotentialAud: string;
      remainingPotentialAud: string;
      confidenceLevel: FpConfidenceLevel;
      submittedAt: string | Date;
    }>(`/api/full-potential/commercial-model/${modelId}/submit`, {
      method: "POST",
      body: body({ assumptionsSummary }),
    });
  },
  reviewModel(modelId: number, decision: "approve" | "return", note: string) {
    return requestJson<{
      status: "approved" | "returned";
      totalPotentialAud?: string;
      remainingPotentialAud?: string;
      confidenceLevel?: FpConfidenceLevel;
    }>(`/api/full-potential/commercial-model/${modelId}/review`, {
      method: "POST",
      body: body({ decision, note }),
    });
  },
  updateRelationship(accountId: number, payload: RelationshipPayload) {
    return requestJson<CommercialAccount>(
      `/api/full-potential/commercial-model/account/${accountId}/relationship`,
      { method: "PUT", body: body(payload) },
    );
  },
};

export interface ModelLinePreviewInput {
  estimatedTotalFleetUnits?: string | number | null;
  replacementCycleYears?: string | number | null;
  annualReplacementUnits?: string | number | null;
  averageSellingPriceAud?: string | number | null;
  addressableSharePct?: string | number | null;
  specialtyPotentialAud?: string | number | null;
}

export interface ModelLinePreview {
  annualReplacementUnits: number;
  equipmentPotentialAud: number;
  specialtyPotentialAud: number;
  linePotentialAud: number;
}

export function numericValue(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateModelLinePreview(input: ModelLinePreviewInput): ModelLinePreview {
  const explicitAnnualReplacement = numericValue(input.annualReplacementUnits);
  const fleetUnits = numericValue(input.estimatedTotalFleetUnits);
  const replacementCycle = numericValue(input.replacementCycleYears);
  const annualReplacementUnits = explicitAnnualReplacement > 0
    ? explicitAnnualReplacement
    : fleetUnits > 0 && replacementCycle > 0
      ? fleetUnits / replacementCycle
      : 0;
  const averageSellingPrice = numericValue(input.averageSellingPriceAud);
  const addressableShare = numericValue(input.addressableSharePct);
  const equipmentPotentialAud =
    annualReplacementUnits > 0 && averageSellingPrice > 0 && addressableShare > 0 && addressableShare <= 100
      ? annualReplacementUnits * averageSellingPrice * (addressableShare / 100)
      : 0;
  const specialtyPotentialAud = Math.max(numericValue(input.specialtyPotentialAud), 0);

  return {
    annualReplacementUnits,
    equipmentPotentialAud,
    specialtyPotentialAud,
    linePotentialAud: equipmentPotentialAud + specialtyPotentialAud,
  };
}

export function modelLineValidationErrors(input: ModelLineDraftPayload): string[] {
  const errors: string[] = [];
  if (!input.application.trim()) errors.push("Application is required");
  const share = numericValue(input.addressableSharePct);
  if (share < 0 || share > 100) errors.push("Addressable share must be between 0 and 100");
  if (numericValue(input.estimatedTotalFleetUnits) < 0) errors.push("Estimated fleet cannot be negative");
  if (numericValue(input.replacementCycleYears) < 0) errors.push("Replacement cycle cannot be negative");
  if (numericValue(input.annualReplacementUnits) < 0) errors.push("Annual replacements cannot be negative");
  if (numericValue(input.averageSellingPriceAud) < 0) errors.push("Average selling price cannot be negative");
  if (input.confidenceLevel === "unknown") errors.push("Choose a confidence level before submission");
  if (input.evidenceIds.length === 0) errors.push("Link at least one evidence record");
  return errors;
}

export function modelEligibilityReasons(account: CommercialAccount): string[] {
  const reasons: string[] = [];
  if (account.rowClass !== "account") reasons.push("Only account rows can be modelled");
  if (!account.countsTowardPotential) reasons.push("This record is excluded from potential counting");
  if (["merged", "parked", "excluded"].includes(account.recordStatus)) {
    reasons.push(`Record status is ${FP_RECORD_STATUS_LABELS[account.recordStatus].toLowerCase()}`);
  }
  if (["park", "exclude"].includes(account.fpStatus)) reasons.push(`FP status is ${account.fpStatus}`);
  if (account.routeToMarket === "exclude") reasons.push("Route to market is excluded");
  return reasons;
}

export function lineEvidenceIds(lineId: number, links: CommercialEvidenceLink[]): number[] {
  return links
    .filter(link => link.modelLineId === lineId)
    .map(link => link.evidenceId);
}

export function modelSubmissionReadiness(
  model: CommercialModel | null,
  lines: CommercialModelLine[],
  links: CommercialEvidenceLink[],
): { ready: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!model) return { ready: false, issues: ["Create a model draft"] };
  const modelLines = lines.filter(line => line.modelId === model.id);
  if (modelLines.length === 0) issues.push("Add at least one product-family line");
  for (const line of modelLines) {
    const label = FP_PRODUCT_FAMILY_LABELS[line.productFamily];
    if (numericValue(line.linePotentialAud) <= 0) issues.push(`${label}: calculated potential must be positive`);
    if (line.confidenceLevel === "unknown") issues.push(`${label}: confidence is required`);
    if (lineEvidenceIds(line.id, links).length === 0) issues.push(`${label}: link supporting evidence`);
  }
  return { ready: issues.length === 0, issues };
}

export function modelApprovalReadiness(
  model: CommercialModel | null,
  lines: CommercialModelLine[],
  links: CommercialEvidenceLink[],
  evidence: CommercialEvidence[],
): { ready: boolean; issues: string[] } {
  const submission = modelSubmissionReadiness(model, lines, links);
  const issues = [...submission.issues];
  if (!model) return { ready: false, issues };
  const modelLines = lines.filter(line => line.modelId === model.id);
  const verified = new Set(evidence.filter(item => item.status === "verified").map(item => item.id));
  for (const line of modelLines) {
    const evidenceIds = lineEvidenceIds(line.id, links);
    if (!evidenceIds.some(id => verified.has(id))) {
      issues.push(`${FP_PRODUCT_FAMILY_LABELS[line.productFamily]}: at least one linked evidence record must be verified`);
    }
  }
  return { ready: issues.length === 0, issues };
}

export function nullIfBlank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatAud(value: string | number | null | undefined): string {
  const amount = numericValue(value);
  if (!amount) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: amount >= 1000 ? 0 : 2,
  }).format(amount);
}

export function formatCommercialDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}
