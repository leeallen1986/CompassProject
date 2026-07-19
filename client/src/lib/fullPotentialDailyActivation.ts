export type RecommendationConfidence = "high" | "medium" | "low" | "unknown";
export type RecommendationDisposition = "pending" | "accepted" | "edited" | "deferred" | "rejected" | "not_relevant";
export type DailyActivationDecision = "accepted" | "edited" | "deferred" | "rejected" | "not_relevant";

export interface ActivationSource {
  sourceType: "account" | "action" | "evidence" | "model" | "fp_signal" | "project" | "pipeline";
  sourceId?: number | null;
  title: string;
  detail?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  observedAt?: string | null;
  confidence: RecommendationConfidence;
}

export interface ProductFamilyHypothesis {
  productFamily: string | null;
  application: string | null;
  rationale: string;
  confidence: RecommendationConfidence;
  basis: "approved_model" | "verified_evidence" | "signal" | "account_context" | "unknown";
}

export interface DailyRecommendation {
  recommendationKey: string;
  kind: string;
  score: number;
  accountId: number;
  accountName: string;
  ownerName: string | null;
  routeToMarket: string;
  priorityTier: string;
  platformPushDecision: string;
  whyNow: string;
  uncertainties: string[];
  recommendedAction: string;
  expectedOutcome: string;
  actionType: string;
  defaultDueDate: string;
  confidence: RecommendationConfidence;
  productHypothesis: ProductFamilyHypothesis;
  sources: ActivationSource[];
  sourceType: "fp_signal" | "project" | null;
  sourceId: number | null;
  existingActionId: number | null;
  existingActionStatus: string | null;
  disposition: RecommendationDisposition;
}

export interface DailyActivationSummary {
  eligibleAccounts: number;
  recommendationsIssued: number;
  pending: number;
  accepted: number;
  edited: number;
  deferred: number;
  rejected: number;
  notRelevant: number;
  freshSignals: number;
  overdueActions: number;
  modelsAwaitingReview: number;
  approvedModelsWithoutPursuit: number;
}

export interface ManagerRollup {
  recommendationsIssued: number;
  pending: number;
  accepted: number;
  edited: number;
  deferred: number;
  rejected: number;
  notRelevant: number;
  evidenceAddedThisWeek: number;
  modelsSubmittedThisWeek: number;
  modelsApprovedThisWeek: number;
  pursuitsStartedThisWeek: number;
  stalledAccounts: number;
  byOwner: Array<{
    ownerName: string;
    recommendations: number;
    pending: number;
    responded: number;
    stalled: number;
  }>;
}

export interface DailyActivationResponse {
  generatedAt: string;
  weekLabel: string;
  recommendations: DailyRecommendation[];
  summary: DailyActivationSummary;
  managerRollup: ManagerRollup | null;
}

export interface GroundedAiBrief {
  generatedBy: "ai" | "deterministic_fallback";
  accountBrief: string;
  whyNow: string;
  evidenceGaps: string[];
  productFamilyHypothesis: ProductFamilyHypothesis;
  questionsToAsk: string[];
  recommendedAction: string;
  expectedOutcome: string;
  warnings: string[];
  sources: ActivationSource[];
}

export interface RecommendationResponsePayload {
  recommendationKey: string;
  decision: DailyActivationDecision;
  editedAction?: string | null;
  dueDate?: string | null;
  reason?: string | null;
}

export class DailyActivationApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "DailyActivationApiError";
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
  const payload = await response.json().catch(() => null) as T | { error?: string; code?: string; details?: unknown } | null;
  if (!response.ok) {
    const errorPayload = payload && typeof payload === "object"
      ? payload as { error?: string; code?: string; details?: unknown }
      : null;
    throw new DailyActivationApiError(
      errorPayload?.error || `Daily activation request failed (${response.status})`,
      response.status,
      errorPayload?.code,
      errorPayload?.details,
    );
  }
  return payload as T;
}

export const dailyActivationApi = {
  load() {
    return requestJson<DailyActivationResponse>("/api/full-potential/daily-activation");
  },
  respond(payload: RecommendationResponsePayload) {
    return requestJson<{ action: { id: number; status: string }; alreadyExists: boolean }>(
      "/api/full-potential/daily-activation/respond",
      { method: "POST", body: JSON.stringify(payload) },
    );
  },
  brief(accountId: number) {
    return requestJson<GroundedAiBrief>("/api/full-potential/daily-activation/brief", {
      method: "POST",
      body: JSON.stringify({ accountId }),
    });
  },
};

export function recommendationStatusLabel(disposition: RecommendationDisposition): string {
  return disposition === "not_relevant"
    ? "Not relevant"
    : disposition.charAt(0).toUpperCase() + disposition.slice(1).replace(/_/g, " ");
}

export function confidenceClass(value: RecommendationConfidence): string {
  if (value === "high") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "medium") return "border-blue-200 bg-blue-50 text-blue-700";
  if (value === "low") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

export function dispositionClass(value: RecommendationDisposition): string {
  if (value === "accepted" || value === "edited") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "deferred") return "border-amber-200 bg-amber-50 text-amber-700";
  if (value === "rejected" || value === "not_relevant") return "border-slate-200 bg-slate-100 text-slate-600";
  return "border-gold/30 bg-gold/10 text-gold-dark";
}

export function formatActivationDate(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
}

export function buildResponsePayload(
  recommendation: DailyRecommendation,
  decision: DailyActivationDecision,
  actionText: string,
  dueDate: string,
  reason: string,
): RecommendationResponsePayload {
  return {
    recommendationKey: recommendation.recommendationKey,
    decision,
    editedAction: actionText.trim() || recommendation.recommendedAction,
    dueDate: dueDate || recommendation.defaultDueDate,
    reason: reason.trim() || null,
  };
}
