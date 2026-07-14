import { TRPCError } from "@trpc/server";
import type { FullPotentialModelLine } from "../drizzle/schema";
import type { FpProductFamily } from "@shared/const";

export const FP_MODEL_METHOD_VERSION = "fp-v1";
export const FP_MODEL_ACTIVE_STATUSES = ["draft", "submitted", "returned"] as const;
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
export const FP_CONFIDENCE_LEVELS = ["high", "medium", "low", "unknown"] as const;
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
export const FP_RECORD_STATUSES = [
  "active",
  "under_review",
  "merged",
  "parked",
  "excluded",
] as const;

export type ConfidenceLevel = typeof FP_CONFIDENCE_LEVELS[number];
export type EvidenceType = typeof FP_EVIDENCE_TYPES[number];
export type RouteToMarket = typeof FP_ROUTE_VALUES[number];
export type RelationshipType = typeof FP_RELATIONSHIP_TYPES[number];
export type RecordStatus = typeof FP_RECORD_STATUSES[number];

export interface FullPotentialActor {
  id: number;
  name?: string | null;
  email?: string | null;
  role?: "user" | "admin" | "distributor";
}

export interface FullPotentialModelLineInput {
  modelId: number;
  productFamily: FpProductFamily;
  application: string;
  routeToMarket: RouteToMarket;
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
  confidenceLevel: ConfidenceLevel;
  evidenceIds: number[];
}

export function fullPotentialActorName(actor: FullPotentialActor): string {
  return actor.name?.trim() || actor.email?.trim() || String(actor.id);
}

export function requiredText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new TRPCError({ code: "BAD_REQUEST", message: `${field} is required` });
  if (normalized.length > maxLength) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${field} exceeds ${maxLength} characters` });
  }
  return normalized;
}

export function optionalText(value: string | null | undefined, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Text exceeds ${maxLength} characters` });
  }
  return normalized;
}

export function decimalValue(
  value: string | null | undefined,
  field: string,
  options: { min?: number; max?: number; allowZero?: boolean } = {},
): string | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  const cleaned = value.trim().replace(/,/g, "");
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(cleaned)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${field} must have at most two decimal places` });
  }
  const number = Number(cleaned);
  const min = options.min ?? 0;
  const allowZero = options.allowZero ?? true;
  if (!Number.isFinite(number) || number < min || (!allowZero && number === 0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${field} is outside the permitted range` });
  }
  if (options.max !== undefined && number > options.max) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${field} cannot exceed ${options.max}` });
  }
  return number.toFixed(2);
}

export function numberValue(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function audMoney(value: number): string {
  return Math.max(0, Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

export function modelLineKey(modelId: number, productFamily: FpProductFamily, application: string): string {
  const normalized = application
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180) || "general";
  return `fp-line:${modelId}:${productFamily}:${normalized}`;
}

export function evidenceLinkKey(modelId: number, modelLineId: number | null, evidenceId: number): string {
  return `fp-link:${modelId}:${modelLineId ?? 0}:${evidenceId}`;
}

export function calculateModelLine(input: FullPotentialModelLineInput) {
  const currentRevenueAud = decimalValue(input.currentRevenueAud, "currentRevenueAud");
  const replacementCycleYears = decimalValue(input.replacementCycleYears, "replacementCycleYears", {
    min: 0.01,
    allowZero: false,
  });
  const suppliedAnnualReplacement = decimalValue(input.annualReplacementUnits, "annualReplacementUnits");
  const averageSellingPriceAud = decimalValue(input.averageSellingPriceAud, "averageSellingPriceAud");
  const addressableSharePct = decimalValue(input.addressableSharePct, "addressableSharePct", { max: 100 });
  const specialtyPotentialAud = decimalValue(input.specialtyPotentialAud, "specialtyPotentialAud");

  let annualReplacement = numberValue(suppliedAnnualReplacement);
  if (
    suppliedAnnualReplacement === null &&
    input.estimatedTotalFleetUnits !== null &&
    input.estimatedTotalFleetUnits !== undefined &&
    replacementCycleYears !== null
  ) {
    annualReplacement = input.estimatedTotalFleetUnits / numberValue(replacementCycleYears);
  }

  const equipmentPotential =
    annualReplacement > 0 && numberValue(averageSellingPriceAud) > 0 && numberValue(addressableSharePct) > 0
      ? annualReplacement * numberValue(averageSellingPriceAud) * (numberValue(addressableSharePct) / 100)
      : 0;

  return {
    currentRevenueAud,
    replacementCycleYears,
    annualReplacementUnits: annualReplacement > 0 ? annualReplacement.toFixed(2) : suppliedAnnualReplacement,
    averageSellingPriceAud,
    addressableSharePct,
    equipmentPotentialAud: audMoney(equipmentPotential),
    specialtyPotentialAud,
    linePotentialAud: audMoney(equipmentPotential + numberValue(specialtyPotentialAud)),
  };
}

export function deriveModelConfidence(lines: FullPotentialModelLine[]): ConfidenceLevel {
  if (lines.length === 0 || lines.some(line => line.confidenceLevel === "unknown")) return "unknown";
  if (lines.some(line => line.confidenceLevel === "low")) return "low";
  if (lines.some(line => line.confidenceLevel === "medium")) return "medium";
  return "high";
}
