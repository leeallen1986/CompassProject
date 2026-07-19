import type { FP_PRODUCT_FAMILIES } from "@shared/const";

export type FpProductFamily = (typeof FP_PRODUCT_FAMILIES)[number];
export type RecommendationConfidence = "high" | "medium" | "low" | "unknown";
export type RecommendationKind =
  | "overdue_action"
  | "returned_model"
  | "manager_review"
  | "fresh_signal"
  | "build_model"
  | "verify_evidence"
  | "capture_evidence"
  | "activate_approved_model"
  | "advance_pursuit"
  | "set_next_action"
  | "validate_installed_base"
  | "validate_supplier"
  | "account_review";

export interface DailyActivationUser {
  id: number;
  name?: string | null;
  email?: string | null;
  role: "user" | "admin" | "distributor";
}

export interface DailyActivationAccount {
  id: number;
  canonicalName: string;
  displayName?: string | null;
  parentGroup?: string | null;
  ownerName?: string | null;
  channelOwner?: string | null;
  state?: string | null;
  segment?: string | null;
  subsegment?: string | null;
  rowClass: string;
  routeToMarket: string;
  fpStatus: string;
  priorityTier: string;
  platformPushDecision: string;
  currentSupplier?: string | null;
  installedBaseStatus: string;
  nextAction?: string | null;
  nextActionDate?: Date | string | null;
  applicationPlays?: string[] | null;
  confidenceLevel?: RecommendationConfidence | null;
  recordStatus?: string | null;
  countsTowardPotential?: boolean | null;
}

export interface DailyActivationAction {
  id: number;
  accountId: number;
  userId?: number | null;
  ownerName?: string | null;
  actionType: string;
  recommendedAction?: string | null;
  dueDate?: Date | string | null;
  status: string;
  notes?: string | null;
  signalId?: number | null;
  projectId?: number | null;
  createdAt?: Date | string | null;
  completedAt?: Date | string | null;
}

export interface DailyActivationSignal {
  sourceType: "fp_signal" | "project";
  sourceId: number;
  accountId: number;
  title: string;
  summary?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  signalDate?: Date | string | null;
  urgency: "hot" | "warm" | "cold" | "unknown";
  confidence: RecommendationConfidence;
  matchReason: string;
  suggestedAction?: string | null;
  productHints?: string[] | null;
}

export interface DailyActivationEvidence {
  id: number;
  accountId: number;
  productFamily?: FpProductFamily | null;
  title: string;
  summary: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  confidenceLevel: RecommendationConfidence;
  status: "draft" | "verified" | "rejected" | "superseded";
  createdAt?: Date | string | null;
  verifiedAt?: Date | string | null;
}

export interface DailyActivationModel {
  id: number;
  accountId: number;
  versionNumber: number;
  status: "draft" | "submitted" | "returned" | "approved" | "superseded";
  confidenceLevel: RecommendationConfidence;
  totalPotentialAud?: string | number | null;
  remainingPotentialAud?: string | number | null;
  assumptionsSummary?: string | null;
  reviewNotes?: string | null;
  createdBy?: number | null;
  submittedAt?: Date | string | null;
  reviewedAt?: Date | string | null;
  approvedAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface DailyActivationModelLine {
  id: number;
  modelId: number;
  accountId: number;
  productFamily: FpProductFamily;
  application: string;
  linePotentialAud: string | number;
  confidenceLevel: RecommendationConfidence;
}

export interface DailyActivationClaim {
  id: number;
  accountId: number;
  userId: number;
  status: string;
  productFamily?: string | null;
  application?: string | null;
  commercialHypothesis?: string | null;
  nextAction?: string | null;
  nextActionDate?: Date | string | null;
  estimatedValueAud?: string | number | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface DailyActivationSource {
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
  productFamily: FpProductFamily | null;
  application: string | null;
  rationale: string;
  confidence: RecommendationConfidence;
  basis: "approved_model" | "verified_evidence" | "signal" | "account_context" | "unknown";
}

export interface DailyRecommendationContext {
  account: DailyActivationAccount;
  actions: DailyActivationAction[];
  signals: DailyActivationSignal[];
  evidence: DailyActivationEvidence[];
  models: DailyActivationModel[];
  lines: DailyActivationModelLine[];
  claims: DailyActivationClaim[];
  user: DailyActivationUser;
  weekLabel: string;
  now: Date;
}

export interface DailyRecommendation {
  recommendationKey: string;
  kind: RecommendationKind;
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
  actionType: "account_review" | "contact_discovery" | "customer_call" | "site_visit" | "channel_handover" | "installed_base_validation" | "proposal_followup" | "manager_review" | "other";
  defaultDueDate: string;
  confidence: RecommendationConfidence;
  productHypothesis: ProductFamilyHypothesis;
  sources: DailyActivationSource[];
  sourceType: "fp_signal" | "project" | null;
  sourceId: number | null;
  existingActionId: number | null;
  existingActionStatus: string | null;
  disposition: "pending" | "accepted" | "edited" | "deferred" | "rejected" | "not_relevant";
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
  sources: DailyActivationSource[];
}

const OPEN_ACTION_STATUSES = new Set(["not_started", "in_progress", "contacted", "meeting_booked", "quoted"]);
const ACTIVE_CLAIM_STATUSES = new Set(["identified", "contacted", "meeting_booked", "qualified", "quoted", "deferred"]);
const CLOSED_RECOMMENDATION_STATUSES = new Set(["completed", "won", "lost", "not_relevant"]);
const PRODUCT_KEYWORDS: Array<{ family: FpProductFamily; confidence: RecommendationConfidence; terms: string[] }> = [
  { family: "specialty_air_boosters", confidence: "high", terms: ["booster", "high pressure", "pipeline commissioning", "nitrogen membrane feed"] },
  { family: "portable_air_large", confidence: "medium", terms: ["large air", "drilling", "blast", "mining fleet", "high cfm"] },
  { family: "portable_air_small_medium", confidence: "medium", terms: ["portable air", "compressor", "construction air", "rental fleet"] },
  { family: "e_air", confidence: "high", terms: ["e-air", "electric compressor", "electric air"] },
  { family: "dryers", confidence: "high", terms: ["dryer", "dry air"] },
  { family: "nitrogen", confidence: "high", terms: ["nitrogen", "n2"] },
  { family: "dewatering", confidence: "high", terms: ["dewatering", "pump", "water transfer"] },
  { family: "generators", confidence: "medium", terms: ["generator", "temporary power", "genset"] },
  { family: "bess", confidence: "high", terms: ["bess", "battery energy storage", "battery storage"] },
  { family: "lighting", confidence: "high", terms: ["light tower", "lighting tower", "site lighting"] },
];

export function normalizeActivationIdentity(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function startOfActivationWeek(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  const day = value.getDay();
  const distance = day === 0 ? 6 : day - 1;
  value.setDate(value.getDate() - distance);
  return value;
}

export function activationWeekLabel(date: Date): string {
  return startOfActivationWeek(date).toISOString().slice(0, 10);
}

export function ownerMatchesActivationUser(account: DailyActivationAccount, user: DailyActivationUser): boolean {
  if (user.role === "admin") return true;
  const identities = [user.name, user.email]
    .map(normalizeActivationIdentity)
    .filter(Boolean);
  if (identities.length === 0) return false;
  const owners = [account.ownerName, account.channelOwner]
    .map(normalizeActivationIdentity)
    .filter(Boolean);
  return owners.some(owner => identities.some(identity => owner.includes(identity) || identity.includes(owner)));
}

function dateValue(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dueInDays(now: Date, days: number): string {
  const value = new Date(now);
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return toIsoDate(value);
}

function numberValue(value: string | number | null | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function accountName(account: DailyActivationAccount): string {
  return account.displayName?.trim() || account.canonicalName;
}

function confidenceRank(value: RecommendationConfidence): number {
  return value === "high" ? 3 : value === "medium" ? 2 : value === "low" ? 1 : 0;
}

function strongestSignal(signals: DailyActivationSignal[]): DailyActivationSignal | null {
  const urgencyRank: Record<string, number> = { hot: 4, warm: 3, cold: 2, unknown: 1 };
  return [...signals].sort((left, right) => {
    const urgency = (urgencyRank[right.urgency] ?? 0) - (urgencyRank[left.urgency] ?? 0);
    if (urgency !== 0) return urgency;
    const confidence = confidenceRank(right.confidence) - confidenceRank(left.confidence);
    if (confidence !== 0) return confidence;
    return dateValue(right.signalDate) - dateValue(left.signalDate);
  })[0] ?? null;
}

function latestModel(models: DailyActivationModel[]): DailyActivationModel | null {
  return [...models].sort((left, right) => {
    if (right.versionNumber !== left.versionNumber) return right.versionNumber - left.versionNumber;
    return dateValue(right.updatedAt) - dateValue(left.updatedAt);
  })[0] ?? null;
}

function approvedModel(models: DailyActivationModel[]): DailyActivationModel | null {
  return [...models]
    .filter(model => model.status === "approved")
    .sort((left, right) => right.versionNumber - left.versionNumber)[0] ?? null;
}

function actionDecision(notes: string | null | undefined, recommendationKey: string): DailyRecommendation["disposition"] | null {
  if (!notes || !notes.includes(`[fp_daily:${recommendationKey}]`)) return null;
  const match = notes.match(/FP daily decision:\s*(accepted|edited|deferred|rejected|not_relevant)/i);
  return match ? match[1].toLowerCase() as DailyRecommendation["disposition"] : "accepted";
}

function feedbackAction(actions: DailyActivationAction[], recommendationKey: string): DailyActivationAction | null {
  return [...actions]
    .filter(action => action.notes?.includes(`[fp_daily:${recommendationKey}]`))
    .sort((left, right) => dateValue(right.createdAt) - dateValue(left.createdAt))[0] ?? null;
}

export function inferProductFamilyHypothesis(context: DailyRecommendationContext): ProductFamilyHypothesis {
  const approved = approvedModel(context.models);
  if (approved) {
    const approvedLines = context.lines
      .filter(line => line.modelId === approved.id && numberValue(line.linePotentialAud) > 0)
      .sort((left, right) => numberValue(right.linePotentialAud) - numberValue(left.linePotentialAud));
    const line = approvedLines[0];
    if (line) {
      return {
        productFamily: line.productFamily,
        application: line.application,
        rationale: `Highest positive line in approved model version ${approved.versionNumber}.`,
        confidence: line.confidenceLevel,
        basis: "approved_model",
      };
    }
  }

  const verifiedEvidence = context.evidence.filter(item => item.status === "verified" && item.productFamily);
  if (verifiedEvidence.length > 0) {
    const strongest = [...verifiedEvidence].sort((left, right) => confidenceRank(right.confidenceLevel) - confidenceRank(left.confidenceLevel))[0];
    return {
      productFamily: strongest.productFamily ?? null,
      application: strongest.title,
      rationale: `Verified evidence: ${strongest.title}.`,
      confidence: strongest.confidenceLevel,
      basis: "verified_evidence",
    };
  }

  const signal = strongestSignal(context.signals);
  const signalText = signal
    ? [signal.title, signal.summary, ...(signal.productHints ?? [])].filter(Boolean).join(" ")
    : "";
  const accountText = [
    context.account.segment,
    context.account.subsegment,
    ...(context.account.applicationPlays ?? []),
    signalText,
  ].filter(Boolean).join(" ").toLowerCase();

  for (const rule of PRODUCT_KEYWORDS) {
    const term = rule.terms.find(value => accountText.includes(value));
    if (!term) continue;
    return {
      productFamily: rule.family,
      application: signal?.title ?? context.account.applicationPlays?.[0] ?? null,
      rationale: `Grounded keyword match on “${term}” in account or signal context; validation is still required.`,
      confidence: signal ? (confidenceRank(signal.confidence) < confidenceRank(rule.confidence) ? signal.confidence : rule.confidence) : "low",
      basis: signal ? "signal" : "account_context",
    };
  }

  return {
    productFamily: null,
    application: null,
    rationale: "No evidence-backed product-family hypothesis is available yet.",
    confidence: "unknown",
    basis: "unknown",
  };
}

function sourceFromSignal(signal: DailyActivationSignal): DailyActivationSource {
  return {
    sourceType: signal.sourceType,
    sourceId: signal.sourceId,
    title: signal.title,
    detail: signal.summary ?? signal.matchReason,
    sourceName: signal.sourceName ?? null,
    sourceUrl: signal.sourceUrl ?? null,
    observedAt: signal.signalDate ? new Date(signal.signalDate).toISOString() : null,
    confidence: signal.confidence,
  };
}

function buildSources(context: DailyRecommendationContext, signal: DailyActivationSignal | null, model: DailyActivationModel | null, overdue: DailyActivationAction | null): DailyActivationSource[] {
  const sources: DailyActivationSource[] = [];
  if (signal) sources.push(sourceFromSignal(signal));
  if (overdue) {
    sources.push({
      sourceType: "action",
      sourceId: overdue.id,
      title: overdue.recommendedAction || `Open action ${overdue.id}`,
      detail: overdue.notes ?? null,
      observedAt: overdue.dueDate ? new Date(overdue.dueDate).toISOString() : null,
      confidence: "high",
    });
  }
  if (model) {
    sources.push({
      sourceType: "model",
      sourceId: model.id,
      title: `Full Potential model v${model.versionNumber} — ${model.status}`,
      detail: model.reviewNotes ?? model.assumptionsSummary ?? null,
      observedAt: model.updatedAt ? new Date(model.updatedAt).toISOString() : null,
      confidence: model.confidenceLevel,
    });
  }
  const verified = context.evidence.filter(item => item.status === "verified").slice(0, 2);
  for (const item of verified) {
    sources.push({
      sourceType: "evidence",
      sourceId: item.id,
      title: item.title,
      detail: item.summary,
      sourceName: item.sourceName ?? null,
      sourceUrl: item.sourceUrl ?? null,
      observedAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
      confidence: item.confidenceLevel,
    });
  }
  return sources.slice(0, 4);
}

function baseScore(account: DailyActivationAccount): number {
  const tier = account.priorityTier === "tier_a" ? 20 : account.priorityTier === "tier_b" ? 12 : account.priorityTier === "tier_c" ? 5 : 0;
  const push = account.platformPushDecision === "push_now" ? 18 : account.platformPushDecision === "push_context" ? 8 : account.platformPushDecision === "channel_view" ? 6 : 0;
  const status = account.fpStatus === "active_target" ? 12 : account.fpStatus === "develop" ? 6 : 0;
  return tier + push + status;
}

export function buildDailyRecommendation(context: DailyRecommendationContext): DailyRecommendation | null {
  const { account, now } = context;
  if (
    account.rowClass !== "account" ||
    account.countsTowardPotential === false ||
    ["merged", "parked", "excluded"].includes(account.recordStatus ?? "") ||
    ["park", "exclude"].includes(account.fpStatus) ||
    account.routeToMarket === "exclude"
  ) return null;

  const openActions = context.actions.filter(action => OPEN_ACTION_STATUSES.has(action.status));
  const overdue = [...openActions]
    .filter(action => dateValue(action.dueDate) > 0 && dateValue(action.dueDate) < now.getTime())
    .sort((left, right) => dateValue(left.dueDate) - dateValue(right.dueDate))[0] ?? null;
  const signal = strongestSignal(context.signals.filter(item => item.urgency !== "cold"));
  const latest = latestModel(context.models);
  const approved = approvedModel(context.models);
  const activeClaims = context.claims.filter(claim => ACTIVE_CLAIM_STATUSES.has(claim.status));
  const verifiedEvidence = context.evidence.filter(item => item.status === "verified");
  const draftEvidence = context.evidence.filter(item => item.status === "draft");
  const hypothesis = inferProductFamilyHypothesis(context);
  const uncertainties: string[] = [];
  if (account.installedBaseStatus === "unknown") uncertainties.push("Installed base is unknown");
  if (!account.currentSupplier?.trim()) uncertainties.push("Current supplier is not confirmed");
  if (verifiedEvidence.length === 0) uncertainties.push("No verified commercial evidence");
  if (!account.nextAction?.trim()) uncertainties.push("No account-level next action is recorded");
  if (!hypothesis.productFamily) uncertainties.push("Product-family fit is not yet evidenced");

  let kind: RecommendationKind = "account_review";
  let score = 25 + baseScore(account);
  let recommendedAction = `Review ${accountName(account)} and confirm the next evidence-generating commercial step.`;
  let expectedOutcome = "A clear pursue, defer or reject decision with an accountable next action.";
  let actionType: DailyRecommendation["actionType"] = "account_review";
  let confidence: RecommendationConfidence = account.confidenceLevel ?? "unknown";
  let sourceType: DailyRecommendation["sourceType"] = null;
  let sourceId: number | null = null;
  let dueDays = 7;

  if (latest?.status === "returned") {
    kind = "returned_model";
    score = 110 + baseScore(account);
    recommendedAction = `Revise returned model version ${latest.versionNumber} against the manager review note and resubmit.`;
    expectedOutcome = "A corrected evidence-backed model ready for manager approval.";
    actionType = "manager_review";
    confidence = "high";
    dueDays = 3;
  } else if (latest?.status === "submitted" && context.user.role === "admin") {
    kind = "manager_review";
    score = 108 + baseScore(account);
    recommendedAction = `Review submitted model version ${latest.versionNumber}; approve it only if every positive line has verified evidence.`;
    expectedOutcome = "A documented approve or return decision without inventing account value.";
    actionType = "manager_review";
    confidence = "high";
    dueDays = 2;
  } else if (overdue) {
    kind = "overdue_action";
    score = 104 + baseScore(account);
    recommendedAction = overdue.recommendedAction || `Complete overdue Full Potential action ${overdue.id}.`;
    expectedOutcome = "The overdue commitment is resolved or deliberately rescheduled with a reason.";
    actionType = (overdue.actionType as DailyRecommendation["actionType"]) || "account_review";
    confidence = "high";
    dueDays = 1;
  } else if (signal && !signal.actionState?.hasOpenAction) {
    kind = "fresh_signal";
    score = (signal.urgency === "hot" ? 100 : 88) + baseScore(account) + confidenceRank(signal.confidence) * 2;
    recommendedAction = signal.suggestedAction?.trim() || `Validate “${signal.title}” with the account owner or customer and capture what it changes commercially.`;
    expectedOutcome = "The signal is confirmed, rejected or converted into verified evidence and a dated action.";
    actionType = signal.sourceType === "project" ? "customer_call" : "account_review";
    confidence = signal.confidence;
    sourceType = signal.sourceType;
    sourceId = signal.sourceId;
    dueDays = signal.urgency === "hot" ? 3 : 7;
  } else if (approved && activeClaims.length === 0) {
    kind = "activate_approved_model";
    score = 86 + baseScore(account);
    recommendedAction = "Review the approved product-family hypothesis with the customer and decide whether a genuine attributed pursuit should begin.";
    expectedOutcome = "A human-confirmed pursue, defer or reject decision; C4C remains the system of record once qualified.";
    actionType = "customer_call";
    confidence = approved.confidenceLevel;
    dueDays = 5;
  } else if (activeClaims.length > 0) {
    kind = "advance_pursuit";
    score = 75 + baseScore(account);
    const claim = [...activeClaims].sort((left, right) => dateValue(right.updatedAt) - dateValue(left.updatedAt))[0];
    recommendedAction = claim.nextAction?.trim() || "Complete the next evidence-generating step on the attributed pursuit and hand it to C4C when genuinely qualified.";
    expectedOutcome = "A customer-validated outcome or formal C4C handoff, not additional internal pipeline administration.";
    actionType = "customer_call";
    confidence = approved?.confidenceLevel ?? "medium";
    dueDays = 5;
  } else if (verifiedEvidence.length > 0 && !latest) {
    kind = "build_model";
    score = 82 + baseScore(account);
    recommendedAction = "Convert the verified evidence into a product-family model line with explicit fleet, replacement, price and addressable-share assumptions.";
    expectedOutcome = "A transparent draft model that can be challenged and submitted for manager review.";
    actionType = "account_review";
    confidence = verifiedEvidence.some(item => item.confidenceLevel === "high") ? "high" : "medium";
    dueDays = 5;
  } else if (draftEvidence.length > 0 && verifiedEvidence.length === 0) {
    kind = "verify_evidence";
    score = 78 + baseScore(account);
    recommendedAction = context.user.role === "admin"
      ? `Review ${draftEvidence.length} draft evidence record${draftEvidence.length === 1 ? "" : "s"}; verify, reject or supersede each with a note.`
      : "Clarify the source and confidence of the draft evidence so a manager can verify it.";
    expectedOutcome = "At least one trustworthy evidence record or a documented reason the hypothesis should not proceed.";
    actionType = "manager_review";
    confidence = "medium";
    dueDays = 4;
  } else if (context.evidence.length === 0) {
    kind = "capture_evidence";
    score = 74 + baseScore(account);
    recommendedAction = "Capture the minimum evidence set: fleet or annual spend, current supplier, application mix and replacement timing.";
    expectedOutcome = "Enough sourced information to decide whether modelling is justified without assigning arbitrary value.";
    actionType = account.installedBaseStatus === "unknown" ? "installed_base_validation" : "customer_call";
    confidence = "medium";
    dueDays = 7;
  } else if (!account.nextAction?.trim() || (dateValue(account.nextActionDate) > 0 && dateValue(account.nextActionDate) < now.getTime())) {
    kind = "set_next_action";
    score = 64 + baseScore(account);
    recommendedAction = "Set one specific evidence-generating next action with an owner and date.";
    expectedOutcome = "The account is no longer passive and the next customer-facing step is explicit.";
    actionType = "account_review";
    confidence = "medium";
    dueDays = 5;
  } else if (account.installedBaseStatus === "unknown") {
    kind = "validate_installed_base";
    score = 58 + baseScore(account);
    recommendedAction = "Validate the installed base, fleet size range and replacement cycle before changing commercial potential.";
    expectedOutcome = "A sourced installed-base position or a clear statement that the data remains unknown.";
    actionType = "installed_base_validation";
    confidence = "medium";
    dueDays = 10;
  } else if (!account.currentSupplier?.trim()) {
    kind = "validate_supplier";
    score = 54 + baseScore(account);
    recommendedAction = "Confirm the incumbent supplier by relevant product family and whether any contract or channel constraint applies.";
    expectedOutcome = "A verified supplier position that sharpens the account hypothesis.";
    actionType = "customer_call";
    confidence = "low";
    dueDays = 10;
  }

  const recommendationKey = `fp-${context.weekLabel}-${account.id}-${kind}-${sourceType ?? "account"}-${sourceId ?? 0}`;
  const recorded = feedbackAction(context.actions, recommendationKey);
  const disposition = recorded ? actionDecision(recorded.notes, recommendationKey) ?? (CLOSED_RECOMMENDATION_STATUSES.has(recorded.status) ? "rejected" : "accepted") : "pending";
  const modelForSource = latest ?? approved;
  const sources = buildSources(context, signal, modelForSource, overdue);
  if (sources.length === 0) {
    sources.push({
      sourceType: "account",
      sourceId: account.id,
      title: accountName(account),
      detail: [account.priorityTier, account.platformPushDecision, account.segment].filter(Boolean).join(" · "),
      confidence: account.confidenceLevel ?? "unknown",
    });
  }

  const whyParts: string[] = [];
  if (overdue) whyParts.push("An existing Full Potential commitment is overdue.");
  if (signal) whyParts.push(`${signal.urgency === "hot" ? "A hot" : "A recent"} ${signal.sourceType === "project" ? "project" : "signal"} is matched to the account: ${signal.title}.`);
  if (latest?.status === "returned") whyParts.push("The latest commercial model was returned and needs revision.");
  if (latest?.status === "submitted") whyParts.push("A model is awaiting manager decision.");
  if (approved) whyParts.push(`Model version ${approved.versionNumber} is approved with ${approved.confidenceLevel} confidence.`);
  if (activeClaims.length > 0) whyParts.push(`${activeClaims.length} active attributed pursuit${activeClaims.length === 1 ? " is" : "s are"} linked to the account.`);
  if (context.evidence.length === 0) whyParts.push("No commercial evidence has been captured yet.");
  if (whyParts.length === 0) whyParts.push(`${accountName(account)} is ${account.priorityTier.replace("_", " ")} and marked ${account.platformPushDecision.replace(/_/g, " ")}.`);

  return {
    recommendationKey,
    kind,
    score,
    accountId: account.id,
    accountName: accountName(account),
    ownerName: account.ownerName?.trim() || account.channelOwner?.trim() || null,
    routeToMarket: account.routeToMarket,
    priorityTier: account.priorityTier,
    platformPushDecision: account.platformPushDecision,
    whyNow: whyParts.join(" "),
    uncertainties: [...new Set(uncertainties)].slice(0, 5),
    recommendedAction,
    expectedOutcome,
    actionType,
    defaultDueDate: dueInDays(now, dueDays),
    confidence,
    productHypothesis: hypothesis,
    sources,
    sourceType,
    sourceId,
    existingActionId: recorded?.id ?? overdue?.id ?? null,
    existingActionStatus: recorded?.status ?? overdue?.status ?? null,
    disposition,
  };
}

export function sortDailyRecommendations(items: DailyRecommendation[]): DailyRecommendation[] {
  const dispositionOrder: Record<DailyRecommendation["disposition"], number> = {
    pending: 0,
    deferred: 1,
    edited: 2,
    accepted: 3,
    rejected: 4,
    not_relevant: 5,
  };
  return [...items].sort((left, right) => {
    const disposition = dispositionOrder[left.disposition] - dispositionOrder[right.disposition];
    if (disposition !== 0) return disposition;
    if (right.score !== left.score) return right.score - left.score;
    return left.accountName.localeCompare(right.accountName);
  });
}

export function buildDeterministicAiBrief(recommendation: DailyRecommendation): GroundedAiBrief {
  const questions: string[] = [];
  if (recommendation.uncertainties.some(item => item.toLowerCase().includes("installed base"))) {
    questions.push("What equipment is currently in the fleet, by product family and approximate age?");
  }
  if (recommendation.uncertainties.some(item => item.toLowerCase().includes("supplier"))) {
    questions.push("Who is the current supplier, and is there a contract, channel or specification constraint?");
  }
  if (recommendation.uncertainties.some(item => item.toLowerCase().includes("evidence"))) {
    questions.push("What internal order history, service history or customer-confirmed evidence can support the hypothesis?");
  }
  if (!recommendation.productHypothesis.productFamily) {
    questions.push("Which Portable Air application is actually relevant, if any?");
  }
  if (questions.length === 0) {
    questions.push("What changed recently that makes this account worth acting on now?", "What customer outcome would justify progressing this into C4C?");
  }

  return {
    generatedBy: "deterministic_fallback",
    accountBrief: `${recommendation.accountName} is prioritised because ${recommendation.whyNow.charAt(0).toLowerCase()}${recommendation.whyNow.slice(1)}`,
    whyNow: recommendation.whyNow,
    evidenceGaps: recommendation.uncertainties,
    productFamilyHypothesis: recommendation.productHypothesis,
    questionsToAsk: questions.slice(0, 5),
    recommendedAction: recommendation.recommendedAction,
    expectedOutcome: recommendation.expectedOutcome,
    warnings: [
      "Do not infer fleet size, supplier, contact or financial value where the source data is silent.",
      "Compass records the intelligence and attribution; C4C remains authoritative once a pursuit is qualified.",
    ],
    sources: recommendation.sources,
  };
}
