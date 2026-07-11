import type { Request, Response } from "express";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { fullPotentialAccounts, fullPotentialActions, fullPotentialSignals } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";

const OPEN_ACTION_STATUSES = new Set(["not_started", "in_progress", "contacted", "meeting_booked", "quoted"]);
const LIVE_SIGNAL_STATUSES = new Set(["new", "reviewed", "promoted"]);
const CHANNEL_ROUTES = new Set([
  "cea",
  "cp_aps",
  "cp_blastone",
  "cp_pneumatic_engineering",
  "cp_more_air",
  "nz_distributor",
  "png_oceania",
]);
const DIRECT_ROUTES = new Set(["direct_ape", "hybrid_strategic"]);

const RYAN = "Ryan Pemberton";
const PAUL = "Paul Lueth";
const DAN = "Dan Day";
const ALL_AU_STATE_CODES = ["WA", "QLD", "NSW", "VIC", "SA", "TAS", "NT", "ACT"] as const;

export const RENTAL_HIRE_VIEW_KEYS = [
  "all",
  "tier_a",
  "push_now",
  "shared_ownership",
  "ownership_review",
  "owner_gap",
  "owner_mismatch",
  "channel_owner_gap",
  "unknown_installed_base",
  "supplier_gap",
  "financial_gap",
  "unmanaged_remediation",
  "no_open_activity",
  "live_signal",
] as const;

export const RENTAL_REMEDIATION_TYPES = [
  "ownership_review",
  "financial_potential",
  "installed_base",
  "supplier_validation",
] as const;

export type RentalHireView = typeof RENTAL_HIRE_VIEW_KEYS[number];
export type RentalRemediationType = typeof RENTAL_REMEDIATION_TYPES[number];
export type OwnerAlignment = "aligned" | "shared_aligned" | "mismatch" | "unassigned" | "manual_review";
export type OwnershipModel = "coates_national" | "single_territory" | "shared_territory" | "manual_review";

type AccountLike = Record<string, unknown> & { id: number };
type ActionLike = Record<string, unknown> & { id?: number; accountId?: number | null; status?: string | null };
type SignalLike = Record<string, unknown> & { accountId?: number | null; status?: string | null; urgency?: string | null };

type ActionMeta = {
  openActionCount: number;
  latestOpenAction: ActionLike | null;
  openActions: ActionLike[];
};

type SignalMeta = {
  signalCount: number;
  liveSignalCount: number;
  latestSignal: SignalLike | null;
  highestLiveUrgency: "hot" | "warm" | "cold" | "unknown";
};

type OwnershipExpectation = {
  expectedOwnerNames: string[];
  expectedOwnerName: string | null;
  stateCodes: string[];
  ownershipModel: OwnershipModel;
  rule: string;
};

type OwnershipAssessment = OwnershipExpectation & {
  actualOwnerNames: string[];
  ownerAlignment: OwnerAlignment;
  reviewReason: string | null;
};

type RemediationState = Record<RentalRemediationType, {
  managed: boolean;
  actionId: number | null;
  dueDate: string | null;
}>;

export type RentalHireWorkspaceInput = {
  search?: string;
  state?: string;
  routeToMarket?: string;
  ownerName?: string;
  subsegment?: string;
  priorityTier?: string;
  rowClass?: string;
  view?: RentalHireView;
  limit?: number;
  offset?: number;
};

export type RentalRemediationPlanInput = {
  accountIds: number[];
  remediationType: RentalRemediationType;
};

const requestSchema = z.object({
  search: z.string().max(200).optional(),
  state: z.string().max(64).optional(),
  routeToMarket: z.string().max(128).optional(),
  ownerName: z.string().max(256).optional(),
  subsegment: z.string().max(128).optional(),
  priorityTier: z.string().max(64).optional(),
  rowClass: z.string().max(64).optional(),
  view: z.enum(RENTAL_HIRE_VIEW_KEYS).optional().default("all"),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const remediationRequestSchema = z.object({
  accountIds: z.array(z.number().int().positive()).min(1).max(100),
  remediationType: z.enum(RENTAL_REMEDIATION_TYPES),
  dueDate: z.string().min(1).max(64),
  notes: z.string().max(1000).optional(),
  dryRun: z.boolean().optional().default(true),
});

export const RENTAL_REMEDIATION_DEFINITIONS: Record<RentalRemediationType, {
  label: string;
  actionType: "manager_review" | "account_review" | "installed_base_validation";
  recommendedAction: string;
  description: string;
}> = {
  ownership_review: {
    label: "Ownership review",
    actionType: "manager_review",
    recommendedAction: "Review Rental Hire ownership exception and confirm accountable internal and channel owner(s)",
    description: "Resolve a true owner mismatch, missing owner, manual-review state or channel-owner gap.",
  },
  financial_potential: {
    label: "Financial potential",
    actionType: "account_review",
    recommendedAction: "Validate and record Rental Hire Full Potential, 2026 target and remaining potential",
    description: "Populate at least one positive financial-potential field using validated commercial evidence.",
  },
  installed_base: {
    label: "Installed-base validation",
    actionType: "installed_base_validation",
    recommendedAction: "Validate Rental Hire installed base, fleet profile and replacement timing",
    description: "Confirm compressor fleet, age, ownership model and replacement timing.",
  },
  supplier_validation: {
    label: "Supplier validation",
    actionType: "account_review",
    recommendedAction: "Identify current compressor supplier and relevant fleet mix for Rental Hire account",
    description: "Confirm incumbent supplier, product mix and competitive position.",
  },
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normalize(value: unknown): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function numberValue(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function arrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function containsWord(value: unknown, words: Set<string>): boolean {
  const tokens = normalize(value).split(" ").filter(Boolean);
  return tokens.some(token => words.has(token));
}

function hasWord(value: string, word: string): boolean {
  return value.split(" ").includes(word);
}

export function isRentalHireAccount(account: AccountLike): boolean {
  const rentalWords = new Set(["rental", "rentals", "hire"]);
  if (containsWord(account.segment, rentalWords) || containsWord(account.subsegment, rentalWords)) return true;
  if (containsWord(account.canonicalName, rentalWords) || containsWord(account.displayName, rentalWords) || containsWord(account.parentGroup, rentalWords)) return true;

  // Coates is the strategic national rental account but not every record includes rental/hire in its classification.
  const identity = normalize([account.canonicalName, account.displayName, account.parentGroup].filter(Boolean).join(" "));
  return identity.includes("coates");
}

function isCoates(account: AccountLike): boolean {
  const identity = normalize([account.canonicalName, account.displayName, account.parentGroup].filter(Boolean).join(" "));
  return identity.includes("coates");
}

function stateCodes(value: unknown): string[] {
  const source = clean(value);
  if (!source) return [];
  const normalized = normalize(source);
  if (
    normalized.includes("national")
    || normalized.includes("australia wide")
    || normalized.includes("all states")
    || normalized.includes("multi state")
    || normalized.includes("multistate")
  ) {
    return [...ALL_AU_STATE_CODES];
  }

  let upper = source.toUpperCase();
  const fullNameMap: Array<[RegExp, string]> = [
    [/\bWESTERN AUSTRALIA\b/g, "WA"],
    [/\bQUEENSLAND\b/g, "QLD"],
    [/\bNEW SOUTH WALES\b/g, "NSW"],
    [/\bVICTORIA\b/g, "VIC"],
    [/\bSOUTH AUSTRALIA\b/g, "SA"],
    [/\bTASMANIA\b/g, "TAS"],
    [/\bNORTHERN TERRITORY\b/g, "NT"],
    [/\bAUSTRALIAN CAPITAL TERRITORY\b/g, "ACT"],
    [/\bNEW ZEALAND\b/g, "NZ"],
  ];
  for (const [pattern, replacement] of fullNameMap) upper = upper.replace(pattern, replacement);
  const matches = upper.match(/\b(WA|QLD|NSW|VIC|SA|TAS|NT|ACT|NZ)\b/g) ?? [];
  return unique(matches.length > 0 ? matches : [upper.replace(/\s+/g, " ").trim()]);
}

function ownerForStateCode(code: string): string {
  if (code === "WA") return RYAN;
  if (code === "QLD" || code === "NSW") return PAUL;
  return DAN;
}

export function expectedRentalOwnership(account: AccountLike): OwnershipExpectation {
  if (isCoates(account)) {
    return {
      expectedOwnerNames: [RYAN],
      expectedOwnerName: RYAN,
      stateCodes: stateCodes(account.state),
      ownershipModel: "coates_national",
      rule: "Coates national strategic account",
    };
  }

  const codes = stateCodes(account.state);
  if (codes.length === 0) {
    return {
      expectedOwnerNames: [],
      expectedOwnerName: null,
      stateCodes: [],
      ownershipModel: "manual_review",
      rule: "State required for territory ownership",
    };
  }

  const expectedOwnerNames = unique(codes.map(ownerForStateCode));
  const shared = expectedOwnerNames.length > 1;
  return {
    expectedOwnerNames,
    expectedOwnerName: expectedOwnerNames.join(" / "),
    stateCodes: codes,
    ownershipModel: shared ? "shared_territory" : "single_territory",
    rule: shared
      ? `Shared territory coverage: ${codes.join(" / ")}`
      : `${codes.join(" / ")} territory`,
  };
}

// Compatibility helper retained for existing consumers and tests.
export function expectedRentalOwner(account: AccountLike): { expectedOwnerName: string | null; rule: string } {
  const expectation = expectedRentalOwnership(account);
  return { expectedOwnerName: expectation.expectedOwnerName, rule: expectation.rule };
}

export function detectRentalOwners(value: unknown): string[] {
  const text = normalize(value);
  if (!text) return [];
  const detected: string[] = [];
  if (text.includes("ryan pemberton") || hasWord(text, "ryan")) detected.push(RYAN);
  if (text.includes("paul lueth") || (hasWord(text, "paul") && !text.includes("paul edmonds"))) detected.push(PAUL);
  if (text.includes("dan day") || hasWord(text, "dan")) detected.push(DAN);
  return unique(detected);
}

export function assessRentalOwnership(account: AccountLike): OwnershipAssessment {
  const expectation = expectedRentalOwnership(account);
  const actualOwner = clean(account.ownerName);
  const actualOwnerNames = detectRentalOwners(actualOwner);

  if (expectation.expectedOwnerNames.length === 0) {
    return {
      ...expectation,
      actualOwnerNames,
      ownerAlignment: "manual_review",
      reviewReason: "The account state does not resolve to a territory ownership rule.",
    };
  }
  if (!actualOwner) {
    return {
      ...expectation,
      actualOwnerNames,
      ownerAlignment: "unassigned",
      reviewReason: "No internal sales owner is recorded.",
    };
  }
  if (actualOwnerNames.length === 0) {
    return {
      ...expectation,
      actualOwnerNames,
      ownerAlignment: "mismatch",
      reviewReason: `Recorded owner '${actualOwner}' does not identify the expected territory owner(s).`,
    };
  }

  if (expectation.expectedOwnerNames.length === 1) {
    const aligned = actualOwnerNames.length === 1 && actualOwnerNames[0] === expectation.expectedOwnerNames[0];
    return {
      ...expectation,
      actualOwnerNames,
      ownerAlignment: aligned ? "aligned" : "mismatch",
      reviewReason: aligned
        ? null
        : `Expected ${expectation.expectedOwnerNames[0]}, but the recorded ownership resolves to ${actualOwnerNames.join(" / ")}.`,
    };
  }

  const coversExpected = expectation.expectedOwnerNames.every(owner => actualOwnerNames.includes(owner));
  return {
    ...expectation,
    actualOwnerNames,
    ownerAlignment: coversExpected ? "shared_aligned" : "mismatch",
    reviewReason: coversExpected
      ? null
      : `Shared coverage expects ${expectation.expectedOwnerNames.join(" / ")}; recorded ownership resolves to ${actualOwnerNames.join(" / ") || actualOwner}.`,
  };
}

function routeClass(route: unknown): "direct" | "channel" | "other" {
  const value = clean(route);
  if (DIRECT_ROUTES.has(value)) return "direct";
  if (CHANNEL_ROUTES.has(value)) return "channel";
  return "other";
}

function buildActionMeta(actions: ActionLike[]): Map<number, ActionMeta> {
  const result = new Map<number, ActionMeta>();
  for (const action of actions) {
    const accountId = Number(action.accountId);
    if (!Number.isFinite(accountId) || !OPEN_ACTION_STATUSES.has(clean(action.status))) continue;
    const current = result.get(accountId) ?? { openActionCount: 0, latestOpenAction: null, openActions: [] };
    current.openActionCount += 1;
    current.openActions.push(action);
    const currentTime = current.latestOpenAction?.createdAt ? new Date(current.latestOpenAction.createdAt as Date | string).getTime() : 0;
    const candidateTime = action.createdAt ? new Date(action.createdAt as Date | string).getTime() : 0;
    if (!current.latestOpenAction || candidateTime >= currentTime) current.latestOpenAction = action;
    result.set(accountId, current);
  }
  return result;
}

const URGENCY_RANK: Record<string, number> = { hot: 0, warm: 1, cold: 2, unknown: 3 };

function buildSignalMeta(signals: SignalLike[]): Map<number, SignalMeta> {
  const result = new Map<number, SignalMeta>();
  for (const signal of signals) {
    const accountId = Number(signal.accountId);
    if (!Number.isFinite(accountId)) continue;
    const current = result.get(accountId) ?? {
      signalCount: 0,
      liveSignalCount: 0,
      latestSignal: null,
      highestLiveUrgency: "unknown" as const,
    };
    current.signalCount += 1;
    const live = LIVE_SIGNAL_STATUSES.has(clean(signal.status));
    if (live) {
      current.liveSignalCount += 1;
      const urgency = clean(signal.urgency) || "unknown";
      if ((URGENCY_RANK[urgency] ?? 3) < URGENCY_RANK[current.highestLiveUrgency]) {
        current.highestLiveUrgency = urgency as SignalMeta["highestLiveUrgency"];
      }
    }
    const currentDate = current.latestSignal?.signalDate
      ? new Date(current.latestSignal.signalDate as Date | string).getTime()
      : current.latestSignal?.createdAt
        ? new Date(current.latestSignal.createdAt as Date | string).getTime()
        : 0;
    const candidateDate = signal.signalDate
      ? new Date(signal.signalDate as Date | string).getTime()
      : signal.createdAt
        ? new Date(signal.createdAt as Date | string).getTime()
        : 0;
    if (!current.latestSignal || candidateDate >= currentDate) current.latestSignal = signal;
    result.set(accountId, current);
  }
  return result;
}

function hasFinancialPotential(account: AccountLike): boolean {
  return numberValue(account.fullPotentialAud) > 0
    || numberValue(account.target2026Aud) > 0
    || numberValue(account.remainingPotentialAud) > 0;
}

function isChannelAccount(account: AccountLike): boolean {
  return clean(account.rowClass) === "channel_managed" || routeClass(account.routeToMarket) === "channel";
}

function actionMatchesRemediation(action: ActionLike, remediationType: RentalRemediationType): boolean {
  const definition = RENTAL_REMEDIATION_DEFINITIONS[remediationType];
  const marker = `[rental_remediation:${remediationType}]`;
  return clean(action.actionType) === definition.actionType
    && (
      normalize(action.recommendedAction) === normalize(definition.recommendedAction)
      || clean(action.notes).includes(marker)
    );
}

function remediationState(actions: ActionMeta): RemediationState {
  return Object.fromEntries(RENTAL_REMEDIATION_TYPES.map(type => {
    const action = actions.openActions.find(candidate => actionMatchesRemediation(candidate, type));
    return [type, {
      managed: Boolean(action),
      actionId: action?.id ? Number(action.id) : null,
      dueDate: action?.dueDate ? new Date(action.dueDate as Date | string).toISOString() : null,
    }];
  })) as RemediationState;
}

function ownershipNeedsReview(account: AccountLike, ownership: OwnershipAssessment): boolean {
  return ownership.ownerAlignment === "mismatch"
    || ownership.ownerAlignment === "unassigned"
    || ownership.ownerAlignment === "manual_review"
    || (isChannelAccount(account) && !clean(account.channelOwner));
}

export function remediationEligible(
  account: AccountLike,
  ownership: OwnershipAssessment,
  remediationType: RentalRemediationType,
): boolean {
  if (remediationType === "ownership_review") return ownershipNeedsReview(account, ownership);
  if (remediationType === "financial_potential") return !hasFinancialPotential(account);
  if (remediationType === "installed_base") return !clean(account.installedBaseStatus) || clean(account.installedBaseStatus) === "unknown";
  return !clean(account.currentSupplier);
}

function buildGapKeys(
  account: AccountLike,
  ownership: OwnershipAssessment,
  actionMeta: ActionMeta,
  signalMeta: SignalMeta,
  remediation: RemediationState,
): string[] {
  const gaps: string[] = [];
  if (ownership.ownerAlignment === "shared_aligned") gaps.push("shared_ownership");
  if (ownership.ownerAlignment === "unassigned") gaps.push("owner_gap");
  if (ownership.ownerAlignment === "mismatch") gaps.push("owner_mismatch");
  if (ownershipNeedsReview(account, ownership)) gaps.push("ownership_review");
  if (isChannelAccount(account) && !clean(account.channelOwner)) gaps.push("channel_owner_gap");
  if (!clean(account.installedBaseStatus) || clean(account.installedBaseStatus) === "unknown") gaps.push("unknown_installed_base");
  if (!clean(account.currentSupplier)) gaps.push("supplier_gap");
  if (!hasFinancialPotential(account)) gaps.push("financial_gap");
  if (!clean(account.nextAction) && actionMeta.openActionCount === 0) gaps.push("no_open_activity");
  if (signalMeta.liveSignalCount > 0) gaps.push("live_signal");

  const unmanaged = RENTAL_REMEDIATION_TYPES.some(type => remediationEligible(account, ownership, type) && !remediation[type].managed);
  if (unmanaged) gaps.push("unmanaged_remediation");
  return gaps;
}

function matchesSearch(row: RentalAccountRow, search?: string): boolean {
  const token = normalize(search);
  if (!token) return true;
  const haystack = normalize([
    row.canonicalName,
    row.displayName,
    row.parentGroup,
    row.state,
    row.region,
    row.subsegment,
    row.ownerName,
    row.channelOwner,
    row.expectedOwnerName,
    row.currentSupplier,
    row.latestSignalTitle,
    row.reviewReason,
    ...row.applicationPlays,
  ].filter(Boolean).join(" "));
  return haystack.includes(token);
}

function matchesView(row: RentalAccountRow, view: RentalHireView): boolean {
  if (view === "all") return true;
  if (view === "tier_a") return row.priorityTier === "tier_a";
  if (view === "push_now") return row.platformPushDecision === "push_now";
  return row.gapKeys.includes(view);
}

function priorityRank(value: string | null): number {
  return ({ tier_a: 0, tier_b: 1, tier_c: 2, tier_d: 3, unassigned: 4 } as Record<string, number>)[value ?? ""] ?? 5;
}

function focusSort(left: RentalAccountRow, right: RentalAccountRow): number {
  if (left.ownershipModel === "coates_national" && right.ownershipModel !== "coates_national") return -1;
  if (right.ownershipModel === "coates_national" && left.ownershipModel !== "coates_national") return 1;
  const tierDifference = priorityRank(left.priorityTier) - priorityRank(right.priorityTier);
  if (tierDifference !== 0) return tierDifference;
  const leftPush = left.platformPushDecision === "push_now" ? 0 : 1;
  const rightPush = right.platformPushDecision === "push_now" ? 0 : 1;
  if (leftPush !== rightPush) return leftPush - rightPush;
  const urgencyDifference = (URGENCY_RANK[left.highestLiveUrgency] ?? 3) - (URGENCY_RANK[right.highestLiveUrgency] ?? 3);
  if (urgencyDifference !== 0) return urgencyDifference;
  const reviewStates = new Set<OwnerAlignment>(["unassigned", "mismatch", "manual_review"]);
  const leftOwnership = reviewStates.has(left.ownerAlignment) ? 0 : 1;
  const rightOwnership = reviewStates.has(right.ownerAlignment) ? 0 : 1;
  if (leftOwnership !== rightOwnership) return leftOwnership - rightOwnership;
  const leftUnmanaged = left.gapKeys.includes("unmanaged_remediation") ? 0 : 1;
  const rightUnmanaged = right.gapKeys.includes("unmanaged_remediation") ? 0 : 1;
  if (leftUnmanaged !== rightUnmanaged) return leftUnmanaged - rightUnmanaged;
  const leftActivity = left.gapKeys.includes("no_open_activity") ? 0 : 1;
  const rightActivity = right.gapKeys.includes("no_open_activity") ? 0 : 1;
  if (leftActivity !== rightActivity) return leftActivity - rightActivity;
  if (left.remainingPotentialAud !== right.remainingPotentialAud) return right.remainingPotentialAud - left.remainingPotentialAud;
  return left.canonicalName.localeCompare(right.canonicalName);
}

type RentalAccountRow = ReturnType<typeof buildAccountRow>;

function buildAccountRow(account: AccountLike, actions: ActionMeta, signals: SignalMeta) {
  const ownership = assessRentalOwnership(account);
  const remediation = remediationState(actions);
  const gapKeys = buildGapKeys(account, ownership, actions, signals, remediation);
  const latestSignal = signals.latestSignal;
  const latestAction = actions.latestOpenAction;
  return {
    id: account.id,
    stableKey: clean(account.stableKey),
    canonicalName: clean(account.canonicalName),
    displayName: clean(account.displayName) || null,
    parentGroup: clean(account.parentGroup) || null,
    rowClass: clean(account.rowClass) || null,
    country: clean(account.country) || null,
    state: clean(account.state) || null,
    region: clean(account.region) || null,
    segment: clean(account.segment) || null,
    subsegment: clean(account.subsegment) || null,
    applicationPlays: arrayValue(account.applicationPlays),
    routeToMarket: clean(account.routeToMarket) || null,
    routeClass: routeClass(account.routeToMarket),
    ownerName: clean(account.ownerName) || null,
    channelOwner: clean(account.channelOwner) || null,
    expectedOwnerName: ownership.expectedOwnerName,
    expectedOwnerNames: ownership.expectedOwnerNames,
    actualOwnerNames: ownership.actualOwnerNames,
    ownerAlignment: ownership.ownerAlignment,
    ownershipModel: ownership.ownershipModel,
    ownershipStateCodes: ownership.stateCodes,
    specialRule: ownership.rule,
    reviewReason: ownership.reviewReason,
    fpStatus: clean(account.fpStatus) || null,
    priorityTier: clean(account.priorityTier) || null,
    platformPushDecision: clean(account.platformPushDecision) || null,
    currentRevenueAud: numberValue(account.currentRevenueAud),
    fullPotentialAud: numberValue(account.fullPotentialAud),
    target2026Aud: numberValue(account.target2026Aud),
    remainingPotentialAud: numberValue(account.remainingPotentialAud),
    currentSupplier: clean(account.currentSupplier) || null,
    installedBaseStatus: clean(account.installedBaseStatus) || null,
    c4cStatus: clean(account.c4cStatus) || null,
    nextAction: clean(account.nextAction) || null,
    nextActionDate: account.nextActionDate ? new Date(account.nextActionDate as Date | string).toISOString() : null,
    openActionCount: actions.openActionCount,
    latestOpenActionType: latestAction ? clean(latestAction.actionType) || null : null,
    latestOpenActionStatus: latestAction ? clean(latestAction.status) || null : null,
    latestOpenActionDueDate: latestAction?.dueDate ? new Date(latestAction.dueDate as Date | string).toISOString() : null,
    signalCount: signals.signalCount,
    liveSignalCount: signals.liveSignalCount,
    highestLiveUrgency: signals.highestLiveUrgency,
    latestSignalTitle: latestSignal ? clean(latestSignal.signalTitle) || null : null,
    latestSignalStatus: latestSignal ? clean(latestSignal.status) || null : null,
    latestSignalDate: latestSignal?.signalDate
      ? new Date(latestSignal.signalDate as Date | string).toISOString()
      : latestSignal?.createdAt
        ? new Date(latestSignal.createdAt as Date | string).toISOString()
        : null,
    remediation,
    managedRemediationCount: RENTAL_REMEDIATION_TYPES.filter(type => remediation[type].managed).length,
    gapKeys,
    reviewUrl: `/full-potential?search=${encodeURIComponent(clean(account.canonicalName))}`,
  };
}

function uniqueSorted(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));
}

function countBy<T extends string>(rows: RentalAccountRow[], valueFor: (row: RentalAccountRow) => T | null) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = valueFor(row) || "Unassigned";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function territorySummary(rows: RentalAccountRow[]) {
  const states = uniqueSorted(rows.map(row => row.state));
  if (rows.some(row => !row.state)) states.push("Unassigned");
  return states.map(state => {
    const group = rows.filter(row => (row.state || "Unassigned") === state);
    const expectedOwners = uniqueSorted(group.map(row => row.expectedOwnerName));
    return {
      state,
      count: group.length,
      expectedOwner: expectedOwners.length === 1 ? expectedOwners[0] : expectedOwners.length > 1 ? "Mixed" : "Manual review",
      aligned: group.filter(row => row.ownerAlignment === "aligned").length,
      sharedAligned: group.filter(row => row.ownerAlignment === "shared_aligned").length,
      mismatch: group.filter(row => row.ownerAlignment === "mismatch").length,
      unassigned: group.filter(row => row.ownerAlignment === "unassigned").length,
      manualReview: group.filter(row => row.ownerAlignment === "manual_review").length,
      ownershipReview: group.filter(row => row.gapKeys.includes("ownership_review")).length,
      direct: group.filter(row => row.routeClass === "direct").length,
      channel: group.filter(row => row.routeClass === "channel").length,
      tierA: group.filter(row => row.priorityTier === "tier_a").length,
      pushNow: group.filter(row => row.platformPushDecision === "push_now").length,
      unmanagedRemediation: group.filter(row => row.gapKeys.includes("unmanaged_remediation")).length,
    };
  }).sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));
}

function managedCount(rows: RentalAccountRow[], remediationType: RentalRemediationType): number {
  return rows.filter(row => remediationEligible(row as unknown as AccountLike, {
    expectedOwnerNames: row.expectedOwnerNames,
    expectedOwnerName: row.expectedOwnerName,
    stateCodes: row.ownershipStateCodes,
    ownershipModel: row.ownershipModel,
    rule: row.specialRule,
    actualOwnerNames: row.actualOwnerNames,
    ownerAlignment: row.ownerAlignment,
    reviewReason: row.reviewReason,
  }, remediationType) && row.remediation[remediationType].managed).length;
}

export function buildRentalHireWorkspace(
  accounts: AccountLike[],
  actions: ActionLike[],
  signals: SignalLike[],
  input: RentalHireWorkspaceInput = {},
) {
  const actionMeta = buildActionMeta(actions);
  const signalMeta = buildSignalMeta(signals);
  const rentalRows = accounts
    .filter(isRentalHireAccount)
    .map(account => buildAccountRow(
      account,
      actionMeta.get(account.id) ?? { openActionCount: 0, latestOpenAction: null, openActions: [] },
      signalMeta.get(account.id) ?? { signalCount: 0, liveSignalCount: 0, latestSignal: null, highestLiveUrgency: "unknown" },
    ));

  const filteredRows = rentalRows.filter(row =>
    matchesSearch(row, input.search)
    && (!input.state || row.state === input.state)
    && (!input.routeToMarket || row.routeToMarket === input.routeToMarket)
    && (!input.ownerName || row.ownerName === input.ownerName)
    && (!input.subsegment || row.subsegment === input.subsegment)
    && (!input.priorityTier || row.priorityTier === input.priorityTier)
    && (!input.rowClass || row.rowClass === input.rowClass)
  );

  const view = input.view ?? "all";
  const viewRows = filteredRows.filter(row => matchesView(row, view)).sort(focusSort);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);

  return {
    generatedAt: new Date().toISOString(),
    selectionRule: "Segment/subsegment/name contains rental or hire, plus Coates national strategic account",
    ownershipRules: [
      { rule: "Coates national strategic account", expectedOwnerName: RYAN },
      { rule: "WA territory", expectedOwnerName: RYAN },
      { rule: "QLD / NSW territory", expectedOwnerName: PAUL },
      { rule: "VIC / SA / TAS / NT / ACT and other markets", expectedOwnerName: DAN },
      { rule: "National or multi-state records", expectedOwnerName: "Shared by represented territories" },
    ],
    remediationCatalog: RENTAL_REMEDIATION_TYPES.map(type => ({ type, ...RENTAL_REMEDIATION_DEFINITIONS[type] })),
    summary: {
      totalRentalAccounts: filteredRows.length,
      tierA: filteredRows.filter(row => row.priorityTier === "tier_a").length,
      pushNow: filteredRows.filter(row => row.platformPushDecision === "push_now").length,
      directAccounts: filteredRows.filter(row => row.routeClass === "direct").length,
      channelAccounts: filteredRows.filter(row => row.routeClass === "channel").length,
      ownerAligned: filteredRows.filter(row => row.ownerAlignment === "aligned").length,
      ownerSharedAligned: filteredRows.filter(row => row.ownerAlignment === "shared_aligned").length,
      ownerMismatch: filteredRows.filter(row => row.ownerAlignment === "mismatch").length,
      ownerUnassigned: filteredRows.filter(row => row.ownerAlignment === "unassigned").length,
      ownerManualReview: filteredRows.filter(row => row.ownerAlignment === "manual_review").length,
      ownershipReviewGap: filteredRows.filter(row => row.gapKeys.includes("ownership_review")).length,
      channelOwnerGap: filteredRows.filter(row => row.gapKeys.includes("channel_owner_gap")).length,
      unknownInstalledBase: filteredRows.filter(row => row.gapKeys.includes("unknown_installed_base")).length,
      supplierGap: filteredRows.filter(row => row.gapKeys.includes("supplier_gap")).length,
      financialGap: filteredRows.filter(row => row.gapKeys.includes("financial_gap")).length,
      unmanagedRemediationAccounts: filteredRows.filter(row => row.gapKeys.includes("unmanaged_remediation")).length,
      noOpenActivity: filteredRows.filter(row => row.gapKeys.includes("no_open_activity")).length,
      liveSignalAccounts: filteredRows.filter(row => row.gapKeys.includes("live_signal")).length,
      managedOwnershipReview: managedCount(filteredRows, "ownership_review"),
      managedFinancialPotential: managedCount(filteredRows, "financial_potential"),
      managedInstalledBase: managedCount(filteredRows, "installed_base"),
      managedSupplierValidation: managedCount(filteredRows, "supplier_validation"),
      totalCurrentRevenueAud: filteredRows.reduce((sum, row) => sum + row.currentRevenueAud, 0),
      totalFullPotentialAud: filteredRows.reduce((sum, row) => sum + row.fullPotentialAud, 0),
      totalTarget2026Aud: filteredRows.reduce((sum, row) => sum + row.target2026Aud, 0),
      totalRemainingPotentialAud: filteredRows.reduce((sum, row) => sum + row.remainingPotentialAud, 0),
    },
    viewCounts: Object.fromEntries(RENTAL_HIRE_VIEW_KEYS.map(key => [key, filteredRows.filter(row => matchesView(row, key)).length])) as Record<RentalHireView, number>,
    territorySummary: territorySummary(filteredRows),
    ownerDistribution: countBy(filteredRows, row => row.ownerName),
    routeDistribution: countBy(filteredRows, row => row.routeToMarket),
    subsegmentDistribution: countBy(filteredRows, row => row.subsegment),
    filterOptions: {
      states: uniqueSorted(rentalRows.map(row => row.state)),
      routeToMarkets: uniqueSorted(rentalRows.map(row => row.routeToMarket)),
      ownerNames: uniqueSorted(rentalRows.map(row => row.ownerName)),
      subsegments: uniqueSorted(rentalRows.map(row => row.subsegment)),
      priorityTiers: uniqueSorted(rentalRows.map(row => row.priorityTier)),
      rowClasses: uniqueSorted(rentalRows.map(row => row.rowClass)),
    },
    appliedFilters: {
      search: input.search ?? null,
      state: input.state ?? null,
      routeToMarket: input.routeToMarket ?? null,
      ownerName: input.ownerName ?? null,
      subsegment: input.subsegment ?? null,
      priorityTier: input.priorityTier ?? null,
      rowClass: input.rowClass ?? null,
      view,
    },
    accounts: viewRows.slice(offset, offset + limit),
    total: viewRows.length,
    limit,
    offset,
  };
}

export function buildRentalRemediationPlan(
  accounts: AccountLike[],
  actions: ActionLike[],
  input: RentalRemediationPlanInput,
) {
  const uniqueAccountIds = unique(input.accountIds);
  const accountMap = new Map(accounts.map(account => [account.id, account]));
  const actionMeta = buildActionMeta(actions);
  const definition = RENTAL_REMEDIATION_DEFINITIONS[input.remediationType];

  const items = uniqueAccountIds.map(accountId => {
    const account = accountMap.get(accountId);
    if (!account) {
      return { accountId, canonicalName: null, status: "not_found" as const, reason: "Account not found", existingActionId: null };
    }
    if (!isRentalHireAccount(account)) {
      return { accountId, canonicalName: clean(account.canonicalName), status: "not_rental" as const, reason: "Account is outside the Rental Hire selection rule", existingActionId: null };
    }
    const ownership = assessRentalOwnership(account);
    if (!remediationEligible(account, ownership, input.remediationType)) {
      return { accountId, canonicalName: clean(account.canonicalName), status: "not_eligible" as const, reason: "The selected remediation gap is not present", existingActionId: null };
    }
    const existingAction = (actionMeta.get(accountId)?.openActions ?? []).find(action => actionMatchesRemediation(action, input.remediationType));
    if (existingAction) {
      return {
        accountId,
        canonicalName: clean(account.canonicalName),
        status: "already_managed" as const,
        reason: "A matching open remediation action already exists",
        existingActionId: existingAction.id ? Number(existingAction.id) : null,
      };
    }
    return { accountId, canonicalName: clean(account.canonicalName), status: "eligible" as const, reason: definition.description, existingActionId: null };
  });

  return {
    remediationType: input.remediationType,
    definition,
    requested: uniqueAccountIds.length,
    eligible: items.filter(item => item.status === "eligible").length,
    alreadyManaged: items.filter(item => item.status === "already_managed").length,
    notEligible: items.filter(item => item.status === "not_eligible").length,
    notRental: items.filter(item => item.status === "not_rental").length,
    notFound: items.filter(item => item.status === "not_found").length,
    items,
  };
}

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return clean(value[0]) || undefined;
  return clean(value) || undefined;
}

export async function handleFullPotentialRentalHire(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");

  try {
    await sdk.authenticateRequest(req);
  } catch {
    return res.status(401).json({ error: "Authentication required" });
  }

  const parsed = requestSchema.safeParse({
    search: firstQueryValue(req.query.search),
    state: firstQueryValue(req.query.state),
    routeToMarket: firstQueryValue(req.query.routeToMarket),
    ownerName: firstQueryValue(req.query.ownerName),
    subsegment: firstQueryValue(req.query.subsegment),
    priorityTier: firstQueryValue(req.query.priorityTier),
    rowClass: firstQueryValue(req.query.rowClass),
    view: firstQueryValue(req.query.view),
    limit: firstQueryValue(req.query.limit),
    offset: firstQueryValue(req.query.offset),
  });

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Rental Hire query", details: parsed.error.flatten() });
  }

  const db = await getDb();
  if (!db) return res.status(503).json({ error: "Database unavailable" });

  try {
    const [accounts, actions, signals] = await Promise.all([
      db.select().from(fullPotentialAccounts),
      db.select().from(fullPotentialActions),
      db.select().from(fullPotentialSignals),
    ]);
    return res.json(buildRentalHireWorkspace(accounts as AccountLike[], actions as ActionLike[], signals as SignalLike[], parsed.data));
  } catch (error) {
    console.error("[FullPotentialRentalHire] Failed to build workspace", error);
    return res.status(500).json({ error: "Failed to build Rental Hire workspace" });
  }
}

export async function handleFullPotentialRentalRemediation(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");

  let user: Awaited<ReturnType<typeof sdk.authenticateRequest>>;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    return res.status(401).json({ error: "Authentication required" });
  }

  const parsed = remediationRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Rental Hire remediation request", details: parsed.error.flatten() });
  }

  const dueDate = new Date(parsed.data.dueDate);
  if (Number.isNaN(dueDate.getTime())) return res.status(400).json({ error: "Invalid remediation due date" });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dueDate.getTime() < today.getTime()) return res.status(400).json({ error: "Remediation due date cannot be in the past" });

  const db = await getDb();
  if (!db) return res.status(503).json({ error: "Database unavailable" });

  try {
    const accountIds = unique(parsed.data.accountIds);
    const [accounts, actions] = await Promise.all([
      db.select().from(fullPotentialAccounts).where(inArray(fullPotentialAccounts.id, accountIds)),
      db.select().from(fullPotentialActions).where(inArray(fullPotentialActions.accountId, accountIds)),
    ]);
    const plan = buildRentalRemediationPlan(accounts as AccountLike[], actions as ActionLike[], {
      accountIds,
      remediationType: parsed.data.remediationType,
    });

    let created = 0;
    if (!parsed.data.dryRun) {
      const eligibleIds = plan.items.filter(item => item.status === "eligible").map(item => item.accountId);
      if (eligibleIds.length > 0) {
        const definition = RENTAL_REMEDIATION_DEFINITIONS[parsed.data.remediationType];
        const marker = `[rental_remediation:${parsed.data.remediationType}]`;
        const notes = parsed.data.notes ? `${marker} ${parsed.data.notes}` : marker;
        const ownerName = user.name || user.email || String(user.id);
        await db.insert(fullPotentialActions).values(eligibleIds.map(accountId => ({
          accountId,
          userId: user.id,
          ownerName,
          actionType: definition.actionType,
          recommendedAction: definition.recommendedAction,
          dueDate,
          status: "not_started" as const,
          notes,
        })) as any);
        created = eligibleIds.length;
      }
    }

    return res.json({
      dryRun: parsed.data.dryRun,
      dueDate: dueDate.toISOString(),
      created,
      ...plan,
    });
  } catch (error) {
    console.error("[FullPotentialRentalRemediation] Failed to manage remediation actions", error);
    return res.status(500).json({ error: "Failed to manage Rental Hire remediation actions" });
  }
}
