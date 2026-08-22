export const RECURRING_PROJECT_CONTRACT_VERSION = "recurring-project-v1" as const;

export const RECURRING_PROJECT_TYPES = [
  "annual",
  "quarterly",
  "monthly",
  "rolling",
  "irregular",
] as const;

export type RecurringProjectType = (typeof RECURRING_PROJECT_TYPES)[number];

export const RECURRING_PROGRAMME_STATUSES = [
  "under_review",
  "active",
  "inactive",
  "archived",
] as const;

export type RecurringProgrammeStatus = (typeof RECURRING_PROGRAMME_STATUSES)[number];

export const RECURRING_OCCURRENCE_STATUSES = [
  "anticipated",
  "planning",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "superseded",
] as const;

export type RecurringOccurrenceStatus = (typeof RECURRING_OCCURRENCE_STATUSES)[number];

export interface RecurringDateWindow {
  startDate: string;
  endDate: string;
}

export interface RecurringProgrammeContract {
  programmeKey: string;
  programmeName: string;
  recurrenceType: RecurringProjectType;
  status: RecurringProgrammeStatus;
  buyerName?: string | null;
  siteName?: string | null;
  fullPotentialAccountId?: number | null;
  routeToMarket?: string | null;
  ownerName?: string | null;
  usualLeadTimeDays: number;
  productFamilies: string[];
  applicationTags: string[];
  confidenceLevel: "high" | "medium" | "low" | "unknown";
}

export interface RecurringOccurrenceContract {
  occurrenceKey: string;
  programmeKey: string;
  cycleLabel: string;
  packageKey: string;
  status: RecurringOccurrenceStatus;
  anticipatedWindow: RecurringDateWindow;
  confirmedWindow?: RecurringDateWindow | null;
  canonicalProjectId?: number | null;
  priorOccurrenceKey?: string | null;
  scopeFingerprint: string;
  sourceFingerprint: string;
}

export type RecurringOccurrenceCandidateDecision =
  | "no_change"
  | "update_existing_occurrence"
  | "create_new_occurrence"
  | "manual_review_separate_package";

export interface RecurringOccurrenceCandidateResult {
  decision: RecurringOccurrenceCandidateDecision;
  targetOccurrenceKey: string | null;
  reason: string;
}

export interface RecurringWeeklyRecommendationInput {
  programmeId: number;
  occurrenceId: number;
  programme: RecurringProgrammeContract;
  occurrence: RecurringOccurrenceContract;
  asOfDate: string;
  accountId?: number | null;
  projectId?: number | null;
  signalId?: number | null;
  fullPotentialContext?: {
    accountName: string;
    productFamily?: string | null;
    application?: string | null;
  } | null;
}

export interface RecurringWeeklyRecommendation {
  recommendationKey: string;
  programmeId: number;
  occurrenceId: number;
  accountId: number | null;
  projectId: number | null;
  signalId: number | null;
  programmeName: string;
  cycleLabel: string;
  nextExpectedWindow: RecurringDateWindow;
  whyNow: string;
  recommendedAction: string;
  urgency: "urgent" | "high" | "medium";
  dueDate: string;
  requiresUserAcceptance: true;
  durableActionCreated: false;
  countingTreatment: "application_overlay_non_counting";
  fullPotentialMonetaryImpactAud: 0;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const KEY_SAFE = /^[a-z0-9][a-z0-9._:-]{2,511}$/;

function parseDateOnly(value: string, field: string): Date {
  if (!DATE_ONLY.test(value)) throw new Error(`${field} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a valid calendar date`);
  }
  return parsed;
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addUtcMonths(value: Date, months: number): Date {
  const next = new Date(value.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function normaliseRecurringKeyPart(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function buildRecurringProgrammeKey(input: {
  buyerName?: string | null;
  siteName?: string | null;
  programmeName: string;
}): string {
  const parts = [input.buyerName, input.siteName, input.programmeName]
    .map(normaliseRecurringKeyPart)
    .filter(Boolean);
  if (parts.length === 0) throw new Error("Recurring programme identity is required");
  const key = parts.join(":").slice(0, 512);
  if (!KEY_SAFE.test(key)) throw new Error("Recurring programme key is invalid");
  return key;
}

export function deriveRecurringCycleLabel(
  recurrenceType: RecurringProjectType,
  startDate: string,
  explicitLabel?: string | null,
): string {
  const start = parseDateOnly(startDate, "startDate");
  if (recurrenceType === "annual") return String(start.getUTCFullYear());
  if (recurrenceType === "quarterly") {
    return `${start.getUTCFullYear()}-Q${Math.floor(start.getUTCMonth() / 3) + 1}`;
  }
  if (recurrenceType === "monthly") return formatDateOnly(start).slice(0, 7);
  const normalised = normaliseRecurringKeyPart(explicitLabel);
  if (!normalised) {
    throw new Error(`${recurrenceType} recurrence requires an explicit cycle label`);
  }
  return String(explicitLabel).trim();
}

export function buildRecurringOccurrenceKey(input: {
  programmeKey: string;
  recurrenceType: RecurringProjectType;
  startDate: string;
  explicitCycleLabel?: string | null;
  packageKey?: string | null;
}): string {
  if (!KEY_SAFE.test(input.programmeKey)) throw new Error("programmeKey is invalid");
  const cycle = normaliseRecurringKeyPart(
    deriveRecurringCycleLabel(input.recurrenceType, input.startDate, input.explicitCycleLabel),
  );
  const packageKey = normaliseRecurringKeyPart(input.packageKey || "primary");
  const key = `${input.programmeKey}:${cycle}:${packageKey}`.slice(0, 512);
  if (!KEY_SAFE.test(key)) throw new Error("Recurring occurrence key is invalid");
  return key;
}

export function assertRecurringWindow(window: RecurringDateWindow, field = "window"): void {
  const start = parseDateOnly(window.startDate, `${field}.startDate`);
  const end = parseDateOnly(window.endDate, `${field}.endDate`);
  if (end.getTime() < start.getTime()) throw new Error(`${field} end date must not precede start date`);
}

export function assertRecurringProgrammeContract(programme: RecurringProgrammeContract): void {
  if (!KEY_SAFE.test(programme.programmeKey)) throw new Error("programmeKey is invalid");
  if (!programme.programmeName.trim()) throw new Error("programmeName is required");
  if (!RECURRING_PROJECT_TYPES.includes(programme.recurrenceType)) throw new Error("recurrenceType is invalid");
  if (!RECURRING_PROGRAMME_STATUSES.includes(programme.status)) throw new Error("programme status is invalid");
  if (!Number.isInteger(programme.usualLeadTimeDays) || programme.usualLeadTimeDays < 0 || programme.usualLeadTimeDays > 730) {
    throw new Error("usualLeadTimeDays must be an integer between 0 and 730");
  }
  if (programme.fullPotentialAccountId != null && (!Number.isInteger(programme.fullPotentialAccountId) || programme.fullPotentialAccountId <= 0)) {
    throw new Error("fullPotentialAccountId must be a positive integer when supplied");
  }
}

export function assertRecurringOccurrenceContract(occurrence: RecurringOccurrenceContract): void {
  if (!KEY_SAFE.test(occurrence.occurrenceKey)) throw new Error("occurrenceKey is invalid");
  if (!KEY_SAFE.test(occurrence.programmeKey)) throw new Error("programmeKey is invalid");
  if (!occurrence.cycleLabel.trim()) throw new Error("cycleLabel is required");
  if (!normaliseRecurringKeyPart(occurrence.packageKey)) throw new Error("packageKey is required");
  if (!RECURRING_OCCURRENCE_STATUSES.includes(occurrence.status)) throw new Error("occurrence status is invalid");
  assertRecurringWindow(occurrence.anticipatedWindow, "anticipatedWindow");
  if (occurrence.confirmedWindow) assertRecurringWindow(occurrence.confirmedWindow, "confirmedWindow");
  if (!occurrence.scopeFingerprint.trim() || !occurrence.sourceFingerprint.trim()) {
    throw new Error("scopeFingerprint and sourceFingerprint are required");
  }
}

export function planNextRecurringWindow(input: {
  recurrenceType: RecurringProjectType;
  currentWindow: RecurringDateWindow;
  explicitNextWindow?: RecurringDateWindow | null;
}): RecurringDateWindow {
  assertRecurringWindow(input.currentWindow, "currentWindow");
  if (input.explicitNextWindow) {
    assertRecurringWindow(input.explicitNextWindow, "explicitNextWindow");
    return { ...input.explicitNextWindow };
  }
  if (input.recurrenceType === "rolling" || input.recurrenceType === "irregular") {
    throw new Error(`${input.recurrenceType} recurrence requires an explicit next window`);
  }
  const start = parseDateOnly(input.currentWindow.startDate, "currentWindow.startDate");
  const end = parseDateOnly(input.currentWindow.endDate, "currentWindow.endDate");
  const months = input.recurrenceType === "annual" ? 12 : input.recurrenceType === "quarterly" ? 3 : 1;
  return {
    startDate: formatDateOnly(addUtcMonths(start, months)),
    endDate: formatDateOnly(addUtcMonths(end, months)),
  };
}

export function classifyRecurringOccurrenceCandidate(input: {
  existingOccurrences: RecurringOccurrenceContract[];
  candidate: RecurringOccurrenceContract;
}): RecurringOccurrenceCandidateResult {
  assertRecurringOccurrenceContract(input.candidate);
  const exact = input.existingOccurrences.find(row => row.occurrenceKey === input.candidate.occurrenceKey);
  if (exact) {
    assertRecurringOccurrenceContract(exact);
    if (normaliseRecurringKeyPart(exact.packageKey) !== normaliseRecurringKeyPart(input.candidate.packageKey)) {
      return {
        decision: "manual_review_separate_package",
        targetOccurrenceKey: exact.occurrenceKey,
        reason: "The same programme cycle contains a materially different package key; do not overwrite the existing occurrence.",
      };
    }
    const same = JSON.stringify({
      status: exact.status,
      anticipatedWindow: exact.anticipatedWindow,
      confirmedWindow: exact.confirmedWindow ?? null,
      scopeFingerprint: exact.scopeFingerprint,
      sourceFingerprint: exact.sourceFingerprint,
      canonicalProjectId: exact.canonicalProjectId ?? null,
    }) === JSON.stringify({
      status: input.candidate.status,
      anticipatedWindow: input.candidate.anticipatedWindow,
      confirmedWindow: input.candidate.confirmedWindow ?? null,
      scopeFingerprint: input.candidate.scopeFingerprint,
      sourceFingerprint: input.candidate.sourceFingerprint,
      canonicalProjectId: input.candidate.canonicalProjectId ?? null,
    });
    return same
      ? {
        decision: "no_change",
        targetOccurrenceKey: exact.occurrenceKey,
        reason: "The same programme, cycle and package already exist with no material change.",
      }
      : {
        decision: "update_existing_occurrence",
        targetOccurrenceKey: exact.occurrenceKey,
        reason: "The same programme, cycle and package exist with changed dates, status, scope or source evidence.",
      };
  }

  const sameCycleDifferentPackage = input.existingOccurrences.find(row => (
    row.programmeKey === input.candidate.programmeKey
    && normaliseRecurringKeyPart(row.cycleLabel) === normaliseRecurringKeyPart(input.candidate.cycleLabel)
    && normaliseRecurringKeyPart(row.packageKey) !== normaliseRecurringKeyPart(input.candidate.packageKey)
  ));
  if (sameCycleDifferentPackage) {
    return {
      decision: "manual_review_separate_package",
      targetOccurrenceKey: sameCycleDifferentPackage.occurrenceKey,
      reason: "A different package already exists in the same programme cycle; review whether this is a separate occurrence.",
    };
  }

  return {
    decision: "create_new_occurrence",
    targetOccurrenceKey: null,
    reason: "This is a new programme cycle or an explicitly approved new occurrence.",
  };
}

export function buildRecurringWeeklyRecommendation(
  input: RecurringWeeklyRecommendationInput,
): RecurringWeeklyRecommendation | null {
  assertRecurringProgrammeContract(input.programme);
  assertRecurringOccurrenceContract(input.occurrence);
  if (input.programme.programmeKey !== input.occurrence.programmeKey) {
    throw new Error("Programme and occurrence keys do not match");
  }
  if (!Number.isInteger(input.programmeId) || input.programmeId <= 0) throw new Error("programmeId is invalid");
  if (!Number.isInteger(input.occurrenceId) || input.occurrenceId <= 0) throw new Error("occurrenceId is invalid");
  if (["completed", "cancelled", "superseded"].includes(input.occurrence.status)) return null;

  const asOf = parseDateOnly(input.asOfDate, "asOfDate");
  const activeWindow = input.occurrence.confirmedWindow ?? input.occurrence.anticipatedWindow;
  const start = parseDateOnly(activeWindow.startDate, "occurrence window startDate");
  const end = parseDateOnly(activeWindow.endDate, "occurrence window endDate");
  const planningStart = addUtcDays(start, -input.programme.usualLeadTimeDays);
  if (asOf.getTime() < planningStart.getTime() || asOf.getTime() > end.getTime()) return null;

  const daysUntilStart = Math.ceil((start.getTime() - asOf.getTime()) / 86_400_000);
  const due = daysUntilStart > 0 ? addUtcDays(asOf, Math.min(Math.max(daysUntilStart - 7, 0), 14)) : asOf;
  const urgency: RecurringWeeklyRecommendation["urgency"] = daysUntilStart <= 14
    ? "urgent"
    : daysUntilStart <= 45
      ? "high"
      : "medium";
  const accountLabel = input.fullPotentialContext?.accountName || input.programme.buyerName || "the linked account";
  const productLabel = input.fullPotentialContext?.productFamily
    || input.fullPotentialContext?.application
    || input.programme.applicationTags[0]
    || "the relevant product/application";

  return {
    recommendationKey: [
      "recurring",
      input.programmeId,
      input.occurrenceId,
      input.accountId ?? 0,
      input.signalId ?? 0,
    ].join(":"),
    programmeId: input.programmeId,
    occurrenceId: input.occurrenceId,
    accountId: input.accountId ?? null,
    projectId: input.projectId ?? input.occurrence.canonicalProjectId ?? null,
    signalId: input.signalId ?? null,
    programmeName: input.programme.programmeName,
    cycleLabel: input.occurrence.cycleLabel,
    nextExpectedWindow: { ...activeWindow },
    whyNow: daysUntilStart > 0
      ? `${input.programme.programmeName} enters its planning window in ${daysUntilStart} days for ${accountLabel}.`
      : `${input.programme.programmeName} is inside its current commercial window for ${accountLabel}.`,
    recommendedAction: `Review the ${input.occurrence.cycleLabel} occurrence with ${accountLabel} and confirm the need, timing and route for ${productLabel}.`,
    urgency,
    dueDate: formatDateOnly(due),
    requiresUserAcceptance: true,
    durableActionCreated: false,
    countingTreatment: "application_overlay_non_counting",
    fullPotentialMonetaryImpactAud: 0,
  };
}
