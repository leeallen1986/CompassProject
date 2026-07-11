import type { Request, Response } from "express";
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

export const RENTAL_HIRE_VIEW_KEYS = [
  "all",
  "tier_a",
  "push_now",
  "owner_gap",
  "owner_mismatch",
  "channel_owner_gap",
  "unknown_installed_base",
  "supplier_gap",
  "financial_gap",
  "no_open_activity",
  "live_signal",
] as const;

export type RentalHireView = typeof RENTAL_HIRE_VIEW_KEYS[number];
export type OwnerAlignment = "aligned" | "mismatch" | "unassigned" | "manual_review";

type AccountLike = Record<string, unknown> & { id: number };
type ActionLike = Record<string, unknown> & { accountId?: number | null; status?: string | null };
type SignalLike = Record<string, unknown> & { accountId?: number | null; status?: string | null; urgency?: string | null };

type ActionMeta = {
  openActionCount: number;
  latestOpenAction: ActionLike | null;
};

type SignalMeta = {
  signalCount: number;
  liveSignalCount: number;
  latestSignal: SignalLike | null;
  highestLiveUrgency: "hot" | "warm" | "cold" | "unknown";
};

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

function containsWord(value: unknown, words: Set<string>): boolean {
  const tokens = normalize(value).split(" ").filter(Boolean);
  return tokens.some(token => words.has(token));
}

export function isRentalHireAccount(account: AccountLike): boolean {
  const rentalWords = new Set(["rental", "rentals", "hire"]);
  if (containsWord(account.segment, rentalWords) || containsWord(account.subsegment, rentalWords)) return true;
  if (containsWord(account.canonicalName, rentalWords) || containsWord(account.displayName, rentalWords) || containsWord(account.parentGroup, rentalWords)) return true;

  // Coates is the strategic national rental account but its name does not contain rental/hire.
  const identity = normalize([account.canonicalName, account.displayName, account.parentGroup].filter(Boolean).join(" "));
  return identity.includes("coates");
}

function isCoates(account: AccountLike): boolean {
  const identity = normalize([account.canonicalName, account.displayName, account.parentGroup].filter(Boolean).join(" "));
  return identity.includes("coates");
}

export function expectedRentalOwner(account: AccountLike): { expectedOwnerName: string | null; rule: string } {
  if (isCoates(account)) return { expectedOwnerName: "Ryan Pemberton", rule: "Coates national strategic account" };

  const state = clean(account.state).toUpperCase();
  if (!state) return { expectedOwnerName: null, rule: "State required for territory ownership" };
  if (state === "WA") return { expectedOwnerName: "Ryan Pemberton", rule: "WA territory" };
  if (state === "QLD" || state === "NSW") return { expectedOwnerName: "Paul Lueth", rule: "QLD / NSW territory" };
  return { expectedOwnerName: "Dan Day", rule: "All other markets" };
}

function ownerAlignment(account: AccountLike, expectedOwnerName: string | null): OwnerAlignment {
  if (!expectedOwnerName) return "manual_review";
  const actualOwner = clean(account.ownerName);
  if (!actualOwner) return "unassigned";
  return normalize(actualOwner) === normalize(expectedOwnerName) ? "aligned" : "mismatch";
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
    const current = result.get(accountId) ?? { openActionCount: 0, latestOpenAction: null };
    current.openActionCount += 1;
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

function buildGapKeys(
  account: AccountLike,
  alignment: OwnerAlignment,
  actionMeta: ActionMeta,
  signalMeta: SignalMeta,
): string[] {
  const gaps: string[] = [];
  if (alignment === "unassigned") gaps.push("owner_gap");
  if (alignment === "mismatch") gaps.push("owner_mismatch");
  if (isChannelAccount(account) && !clean(account.channelOwner)) gaps.push("channel_owner_gap");
  if (!clean(account.installedBaseStatus) || clean(account.installedBaseStatus) === "unknown") gaps.push("unknown_installed_base");
  if (!clean(account.currentSupplier)) gaps.push("supplier_gap");
  if (!hasFinancialPotential(account)) gaps.push("financial_gap");
  if (!clean(account.nextAction) && actionMeta.openActionCount === 0) gaps.push("no_open_activity");
  if (signalMeta.liveSignalCount > 0) gaps.push("live_signal");
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
  if (left.specialRule === "Coates national strategic account" && right.specialRule !== "Coates national strategic account") return -1;
  if (right.specialRule === "Coates national strategic account" && left.specialRule !== "Coates national strategic account") return 1;
  const tierDifference = priorityRank(left.priorityTier) - priorityRank(right.priorityTier);
  if (tierDifference !== 0) return tierDifference;
  const leftPush = left.platformPushDecision === "push_now" ? 0 : 1;
  const rightPush = right.platformPushDecision === "push_now" ? 0 : 1;
  if (leftPush !== rightPush) return leftPush - rightPush;
  const urgencyDifference = (URGENCY_RANK[left.highestLiveUrgency] ?? 3) - (URGENCY_RANK[right.highestLiveUrgency] ?? 3);
  if (urgencyDifference !== 0) return urgencyDifference;
  const leftOwnership = left.ownerAlignment === "unassigned" || left.ownerAlignment === "mismatch" ? 0 : 1;
  const rightOwnership = right.ownerAlignment === "unassigned" || right.ownerAlignment === "mismatch" ? 0 : 1;
  if (leftOwnership !== rightOwnership) return leftOwnership - rightOwnership;
  const leftActivity = left.gapKeys.includes("no_open_activity") ? 0 : 1;
  const rightActivity = right.gapKeys.includes("no_open_activity") ? 0 : 1;
  if (leftActivity !== rightActivity) return leftActivity - rightActivity;
  if (left.remainingPotentialAud !== right.remainingPotentialAud) return right.remainingPotentialAud - left.remainingPotentialAud;
  return left.canonicalName.localeCompare(right.canonicalName);
}

type RentalAccountRow = ReturnType<typeof buildAccountRow>;

function buildAccountRow(account: AccountLike, actions: ActionMeta, signals: SignalMeta) {
  const expected = expectedRentalOwner(account);
  const alignment = ownerAlignment(account, expected.expectedOwnerName);
  const gapKeys = buildGapKeys(account, alignment, actions, signals);
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
    expectedOwnerName: expected.expectedOwnerName,
    ownerAlignment: alignment,
    specialRule: expected.rule,
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
      mismatch: group.filter(row => row.ownerAlignment === "mismatch").length,
      unassigned: group.filter(row => row.ownerAlignment === "unassigned").length,
      direct: group.filter(row => row.routeClass === "direct").length,
      channel: group.filter(row => row.routeClass === "channel").length,
      tierA: group.filter(row => row.priorityTier === "tier_a").length,
      pushNow: group.filter(row => row.platformPushDecision === "push_now").length,
    };
  }).sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));
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
      actionMeta.get(account.id) ?? { openActionCount: 0, latestOpenAction: null },
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
      { rule: "Coates national strategic account", expectedOwnerName: "Ryan Pemberton" },
      { rule: "WA territory", expectedOwnerName: "Ryan Pemberton" },
      { rule: "QLD / NSW territory", expectedOwnerName: "Paul Lueth" },
      { rule: "All other markets", expectedOwnerName: "Dan Day" },
    ],
    summary: {
      totalRentalAccounts: filteredRows.length,
      tierA: filteredRows.filter(row => row.priorityTier === "tier_a").length,
      pushNow: filteredRows.filter(row => row.platformPushDecision === "push_now").length,
      directAccounts: filteredRows.filter(row => row.routeClass === "direct").length,
      channelAccounts: filteredRows.filter(row => row.routeClass === "channel").length,
      ownerAligned: filteredRows.filter(row => row.ownerAlignment === "aligned").length,
      ownerMismatch: filteredRows.filter(row => row.ownerAlignment === "mismatch").length,
      ownerUnassigned: filteredRows.filter(row => row.ownerAlignment === "unassigned").length,
      channelOwnerGap: filteredRows.filter(row => row.gapKeys.includes("channel_owner_gap")).length,
      unknownInstalledBase: filteredRows.filter(row => row.gapKeys.includes("unknown_installed_base")).length,
      supplierGap: filteredRows.filter(row => row.gapKeys.includes("supplier_gap")).length,
      financialGap: filteredRows.filter(row => row.gapKeys.includes("financial_gap")).length,
      noOpenActivity: filteredRows.filter(row => row.gapKeys.includes("no_open_activity")).length,
      liveSignalAccounts: filteredRows.filter(row => row.gapKeys.includes("live_signal")).length,
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
