import type { Request, Response } from "express";
import { z } from "zod";
import { getDb } from "./db";
import { sdk } from "./_core/sdk";
import { fullPotentialAccounts, fullPotentialActions } from "../drizzle/schema";

export const FULL_POTENTIAL_QUALITY_ISSUE_KEYS = [
  "missing_owner",
  "channel_owner_missing",
  "tier_a_no_next_action",
  "push_now_no_activity",
  "installed_base_unknown",
  "supplier_missing",
  "financial_potential_missing",
  "evidence_missing",
  "confidence_unknown",
  "c4c_unknown",
  "priority_unassigned",
  "segment_missing",
  "state_missing",
] as const;

export type FullPotentialQualityIssueKey = typeof FULL_POTENTIAL_QUALITY_ISSUE_KEYS[number];

export const FULL_POTENTIAL_QUALITY_ISSUES: ReadonlyArray<{
  key: FullPotentialQualityIssueKey;
  label: string;
  description: string;
  severity: "critical" | "warning" | "info";
}> = [
  {
    key: "missing_owner",
    label: "No responsible owner",
    description: "Neither a sales owner nor channel owner is assigned.",
    severity: "critical",
  },
  {
    key: "channel_owner_missing",
    label: "Channel account without channel owner",
    description: "A channel-managed account has no named channel owner.",
    severity: "critical",
  },
  {
    key: "tier_a_no_next_action",
    label: "Tier A without next action",
    description: "Tier A account has neither a recorded next action nor an open workflow action.",
    severity: "critical",
  },
  {
    key: "push_now_no_activity",
    label: "Push Now without activity",
    description: "Push Now account has neither a recorded next action nor an open workflow action.",
    severity: "critical",
  },
  {
    key: "installed_base_unknown",
    label: "Installed base unknown",
    description: "Installed-base status is blank or unknown.",
    severity: "warning",
  },
  {
    key: "supplier_missing",
    label: "Current supplier missing",
    description: "No current compressor or solution supplier is recorded.",
    severity: "warning",
  },
  {
    key: "financial_potential_missing",
    label: "Financial potential missing",
    description: "Full Potential, 2026 target and remaining potential are all blank or zero.",
    severity: "warning",
  },
  {
    key: "evidence_missing",
    label: "Evidence missing",
    description: "No evidence source is attached to the account record.",
    severity: "warning",
  },
  {
    key: "confidence_unknown",
    label: "Confidence unknown",
    description: "Evidence confidence has not been assessed.",
    severity: "info",
  },
  {
    key: "c4c_unknown",
    label: "C4C status unknown",
    description: "The account's current C4C position has not been confirmed.",
    severity: "warning",
  },
  {
    key: "priority_unassigned",
    label: "Priority unassigned",
    description: "The account has not been placed into a priority tier.",
    severity: "warning",
  },
  {
    key: "segment_missing",
    label: "Segment missing",
    description: "No market segment is recorded.",
    severity: "info",
  },
  {
    key: "state_missing",
    label: "State missing",
    description: "No state or territory is recorded.",
    severity: "info",
  },
] as const;

const OPEN_ACTION_STATUSES = new Set([
  "not_started",
  "in_progress",
  "contacted",
  "meeting_booked",
  "quoted",
]);

const CHANNEL_ROUTES = new Set([
  "cea",
  "cp_aps",
  "cp_blastone",
  "cp_pneumatic_engineering",
  "cp_more_air",
  "nz_distributor",
  "png_oceania",
]);

const QUALITY_FIELD_DEFINITIONS = [
  { key: "routeResolved", label: "Route resolved" },
  { key: "segment", label: "Segment" },
  { key: "subsegment", label: "Subsegment" },
  { key: "state", label: "State / territory" },
  { key: "responsibleOwner", label: "Responsible owner" },
  { key: "channelOwner", label: "Channel owner", conditional: true },
  { key: "priorityTier", label: "Priority tier" },
  { key: "applicationPlays", label: "Application plays" },
  { key: "currentSupplier", label: "Current supplier" },
  { key: "installedBase", label: "Installed-base status" },
  { key: "currentRevenue", label: "Current revenue" },
  { key: "financialPotential", label: "Financial potential" },
  { key: "c4c", label: "C4C status" },
  { key: "nextActivity", label: "Next activity" },
  { key: "nextActivityDate", label: "Next activity date" },
  { key: "evidenceSources", label: "Evidence sources" },
  { key: "confidenceLevel", label: "Evidence confidence" },
] as const;

type QualityFieldKey = typeof QUALITY_FIELD_DEFINITIONS[number]["key"];

type AccountLike = Record<string, unknown> & { id: number };
type ActionLike = Record<string, unknown> & { accountId?: number | null; status?: string | null };

type ActionCoverage = {
  hasOpenAction: boolean;
  hasDatedOpenAction: boolean;
};

type AccountQuality = {
  account: AccountLike;
  responsibleOwner: string;
  isChannelManaged: boolean;
  score: number;
  fields: Record<QualityFieldKey, { applicable: boolean; complete: boolean }>;
  issues: FullPotentialQualityIssueKey[];
};

export type FullPotentialDataQualityInput = {
  segment?: string;
  state?: string;
  routeToMarket?: string;
  ownerName?: string;
  priorityTier?: string;
  rowClass?: string;
  issue?: FullPotentialQualityIssueKey;
  limit?: number;
  offset?: number;
};

const requestSchema = z.object({
  segment: z.string().max(256).optional(),
  state: z.string().max(64).optional(),
  routeToMarket: z.string().max(128).optional(),
  ownerName: z.string().max(256).optional(),
  priorityTier: z.string().max(64).optional(),
  rowClass: z.string().max(64).optional(),
  issue: z.enum(FULL_POTENTIAL_QUALITY_ISSUE_KEYS).optional().default("missing_owner"),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function numberValue(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasNumericValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function hasListValue(value: unknown): boolean {
  return Array.isArray(value) && value.some(item => clean(item));
}

function isChannelManaged(account: AccountLike): boolean {
  return clean(account.rowClass) === "channel_managed" || CHANNEL_ROUTES.has(clean(account.routeToMarket));
}

function responsibleOwner(account: AccountLike): string {
  return clean(account.ownerName) || clean(account.channelOwner) || "Unassigned";
}

function buildActionCoverage(actions: ActionLike[]): Map<number, ActionCoverage> {
  const coverage = new Map<number, ActionCoverage>();
  for (const action of actions) {
    const accountId = Number(action.accountId);
    if (!Number.isFinite(accountId) || !OPEN_ACTION_STATUSES.has(clean(action.status))) continue;
    const current = coverage.get(accountId) ?? { hasOpenAction: false, hasDatedOpenAction: false };
    current.hasOpenAction = true;
    if (action.dueDate) current.hasDatedOpenAction = true;
    coverage.set(accountId, current);
  }
  return coverage;
}

function accountFields(account: AccountLike, actionCoverage: ActionCoverage): AccountQuality["fields"] {
  const channelManaged = isChannelManaged(account);
  const financialPotential = numberValue(account.fullPotentialAud) > 0
    || numberValue(account.target2026Aud) > 0
    || numberValue(account.remainingPotentialAud) > 0;
  const nextActivity = Boolean(clean(account.nextAction)) || actionCoverage.hasOpenAction;
  const nextActivityDate = Boolean(account.nextActionDate) || actionCoverage.hasDatedOpenAction;

  return {
    routeResolved: { applicable: true, complete: clean(account.routeToMarket) !== "manual_review" },
    segment: { applicable: true, complete: Boolean(clean(account.segment)) },
    subsegment: { applicable: true, complete: Boolean(clean(account.subsegment)) },
    state: { applicable: true, complete: Boolean(clean(account.state)) },
    responsibleOwner: { applicable: true, complete: responsibleOwner(account) !== "Unassigned" },
    channelOwner: { applicable: channelManaged, complete: !channelManaged || Boolean(clean(account.channelOwner)) },
    priorityTier: { applicable: true, complete: Boolean(clean(account.priorityTier)) && clean(account.priorityTier) !== "unassigned" },
    applicationPlays: { applicable: true, complete: hasListValue(account.applicationPlays) },
    currentSupplier: { applicable: true, complete: Boolean(clean(account.currentSupplier)) },
    installedBase: { applicable: true, complete: Boolean(clean(account.installedBaseStatus)) && clean(account.installedBaseStatus) !== "unknown" },
    currentRevenue: { applicable: true, complete: hasNumericValue(account.currentRevenueAud) },
    financialPotential: { applicable: true, complete: financialPotential },
    c4c: { applicable: true, complete: Boolean(clean(account.c4cStatus)) && clean(account.c4cStatus) !== "unknown" },
    nextActivity: { applicable: true, complete: nextActivity },
    nextActivityDate: { applicable: true, complete: nextActivityDate },
    evidenceSources: { applicable: true, complete: hasListValue(account.evidenceSources) },
    confidenceLevel: { applicable: true, complete: Boolean(clean(account.confidenceLevel)) && clean(account.confidenceLevel) !== "unknown" },
  };
}

function qualityIssues(
  account: AccountLike,
  fields: AccountQuality["fields"],
): FullPotentialQualityIssueKey[] {
  const issues: FullPotentialQualityIssueKey[] = [];
  if (!fields.responsibleOwner.complete) issues.push("missing_owner");
  if (fields.channelOwner.applicable && !fields.channelOwner.complete) issues.push("channel_owner_missing");
  if (clean(account.priorityTier) === "tier_a" && !fields.nextActivity.complete) issues.push("tier_a_no_next_action");
  if (clean(account.platformPushDecision) === "push_now" && !fields.nextActivity.complete) issues.push("push_now_no_activity");
  if (!fields.installedBase.complete) issues.push("installed_base_unknown");
  if (!fields.currentSupplier.complete) issues.push("supplier_missing");
  if (!fields.financialPotential.complete) issues.push("financial_potential_missing");
  if (!fields.evidenceSources.complete) issues.push("evidence_missing");
  if (!fields.confidenceLevel.complete) issues.push("confidence_unknown");
  if (!fields.c4c.complete) issues.push("c4c_unknown");
  if (!fields.priorityTier.complete) issues.push("priority_unassigned");
  if (!fields.segment.complete) issues.push("segment_missing");
  if (!fields.state.complete) issues.push("state_missing");
  return issues;
}

function scoreFields(fields: AccountQuality["fields"]): number {
  const applicable = Object.values(fields).filter(field => field.applicable);
  if (applicable.length === 0) return 0;
  const complete = applicable.filter(field => field.complete).length;
  return Math.round((complete / applicable.length) * 100);
}

function qualityForAccount(account: AccountLike, actionCoverage: ActionCoverage): AccountQuality {
  const fields = accountFields(account, actionCoverage);
  return {
    account,
    responsibleOwner: responsibleOwner(account),
    isChannelManaged: isChannelManaged(account),
    score: scoreFields(fields),
    fields,
    issues: qualityIssues(account, fields),
  };
}

function matchesFilter(value: string, filter: string | undefined): boolean {
  return !filter || value === filter;
}

function filterQualityRows(rows: AccountQuality[], input: FullPotentialDataQualityInput): AccountQuality[] {
  return rows.filter(row =>
    matchesFilter(clean(row.account.segment), input.segment)
    && matchesFilter(clean(row.account.state), input.state)
    && matchesFilter(clean(row.account.routeToMarket), input.routeToMarket)
    && matchesFilter(row.responsibleOwner, input.ownerName)
    && matchesFilter(clean(row.account.priorityTier), input.priorityTier)
    && matchesFilter(clean(row.account.rowClass), input.rowClass)
  );
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function accountSummary(row: AccountQuality) {
  const account = row.account;
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
    routeToMarket: clean(account.routeToMarket) || null,
    ownerName: clean(account.ownerName) || null,
    channelOwner: clean(account.channelOwner) || null,
    responsibleOwner: row.responsibleOwner,
    fpStatus: clean(account.fpStatus) || null,
    priorityTier: clean(account.priorityTier) || null,
    platformPushDecision: clean(account.platformPushDecision) || null,
    currentSupplier: clean(account.currentSupplier) || null,
    installedBaseStatus: clean(account.installedBaseStatus) || null,
    c4cStatus: clean(account.c4cStatus) || null,
    nextAction: clean(account.nextAction) || null,
    nextActionDate: account.nextActionDate ? new Date(account.nextActionDate as any).toISOString() : null,
    currentRevenueAud: numberValue(account.currentRevenueAud),
    fullPotentialAud: numberValue(account.fullPotentialAud),
    target2026Aud: numberValue(account.target2026Aud),
    remainingPotentialAud: numberValue(account.remainingPotentialAud),
    qualityScore: row.score,
    issueKeys: row.issues,
    missingFields: QUALITY_FIELD_DEFINITIONS
      .filter(definition => row.fields[definition.key].applicable && !row.fields[definition.key].complete)
      .map(definition => definition.label),
    reviewUrl: `/full-potential?search=${encodeURIComponent(clean(account.canonicalName))}`,
  };
}

function priorityRank(value: unknown): number {
  return ({ tier_a: 0, tier_b: 1, tier_c: 2, tier_d: 3, unassigned: 4 } as Record<string, number>)[clean(value)] ?? 5;
}

function sortIssueRows(left: AccountQuality, right: AccountQuality): number {
  const leftPush = clean(left.account.platformPushDecision) === "push_now" ? 0 : 1;
  const rightPush = clean(right.account.platformPushDecision) === "push_now" ? 0 : 1;
  if (leftPush !== rightPush) return leftPush - rightPush;
  const tierDifference = priorityRank(left.account.priorityTier) - priorityRank(right.account.priorityTier);
  if (tierDifference !== 0) return tierDifference;
  if (left.score !== right.score) return left.score - right.score;
  return clean(left.account.canonicalName).localeCompare(clean(right.account.canonicalName));
}

function buildDimension(rows: AccountQuality[], valueFor: (row: AccountQuality) => string) {
  const groups = new Map<string, AccountQuality[]>();
  for (const row of rows) {
    const value = valueFor(row) || "Unassigned";
    const group = groups.get(value) ?? [];
    group.push(row);
    groups.set(value, group);
  }

  return Array.from(groups.entries()).map(([value, group]) => {
    const criticalIssueAccounts = group.filter(row => row.issues.some(issue => {
      const definition = FULL_POTENTIAL_QUALITY_ISSUES.find(item => item.key === issue);
      return definition?.severity === "critical";
    })).length;
    return {
      value,
      count: group.length,
      averageCompletenessPct: Math.round(group.reduce((sum, row) => sum + row.score, 0) / group.length),
      criticalIssueAccounts,
      missingOwner: group.filter(row => row.issues.includes("missing_owner")).length,
      missingNextActivity: group.filter(row => row.issues.includes("tier_a_no_next_action") || row.issues.includes("push_now_no_activity")).length,
      unknownInstalledBase: group.filter(row => row.issues.includes("installed_base_unknown")).length,
      missingSupplier: group.filter(row => row.issues.includes("supplier_missing")).length,
      missingFinancialPotential: group.filter(row => row.issues.includes("financial_potential_missing")).length,
    };
  }).sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

export function buildFullPotentialDataQuality(
  accounts: AccountLike[],
  actions: ActionLike[],
  input: FullPotentialDataQualityInput = {},
) {
  const issue = input.issue ?? "missing_owner";
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const actionCoverage = buildActionCoverage(actions);
  const allRows = accounts.map(account => qualityForAccount(account, actionCoverage.get(account.id) ?? {
    hasOpenAction: false,
    hasDatedOpenAction: false,
  }));
  const rows = filterQualityRows(allRows, input);

  const fieldCoverage = QUALITY_FIELD_DEFINITIONS.map(definition => {
    const applicableRows = rows.filter(row => row.fields[definition.key].applicable);
    const complete = applicableRows.filter(row => row.fields[definition.key].complete).length;
    const applicable = applicableRows.length;
    return {
      key: definition.key,
      label: definition.label,
      complete,
      incomplete: applicable - complete,
      applicable,
      completenessPct: applicable > 0 ? Math.round((complete / applicable) * 100) : 100,
    };
  });

  const issueDefinitions = FULL_POTENTIAL_QUALITY_ISSUES.map(definition => {
    const affected = rows.filter(row => row.issues.includes(definition.key)).sort(sortIssueRows);
    return {
      ...definition,
      count: affected.length,
      sampleAccounts: affected.slice(0, 6).map(accountSummary),
    };
  });

  const selectedIssueRows = rows.filter(row => row.issues.includes(issue)).sort(sortIssueRows);
  const issueAccounts = selectedIssueRows.slice(offset, offset + limit).map(accountSummary);
  const averageCompletenessPct = rows.length > 0
    ? Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length)
    : 0;
  const criticalKeys = new Set(FULL_POTENTIAL_QUALITY_ISSUES
    .filter(definition => definition.severity === "critical")
    .map(definition => definition.key));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalAccounts: rows.length,
      averageCompletenessPct,
      accountsAtLeast80Pct: rows.filter(row => row.score >= 80).length,
      accountsAtLeast90Pct: rows.filter(row => row.score >= 90).length,
      criticalGapAccounts: rows.filter(row => row.issues.some(issueKey => criticalKeys.has(issueKey))).length,
      accountsWithOpenActions: rows.filter(row => actionCoverage.get(row.account.id)?.hasOpenAction).length,
      totalFullPotentialAud: rows.reduce((sum, row) => sum + numberValue(row.account.fullPotentialAud), 0),
    },
    fieldCoverage,
    issues: issueDefinitions,
    selectedIssue: issue,
    issueAccounts,
    issueAccountTotal: selectedIssueRows.length,
    limit,
    offset,
    dimensions: {
      segment: buildDimension(rows, row => clean(row.account.segment) || "Unassigned"),
      subsegment: buildDimension(rows, row => clean(row.account.subsegment) || "Unassigned"),
      state: buildDimension(rows, row => clean(row.account.state) || "Unassigned"),
      routeToMarket: buildDimension(rows, row => clean(row.account.routeToMarket) || "Unassigned"),
      owner: buildDimension(rows, row => row.responsibleOwner),
      priorityTier: buildDimension(rows, row => clean(row.account.priorityTier) || "Unassigned"),
    },
    filterOptions: {
      segments: uniqueSorted(allRows.map(row => clean(row.account.segment))),
      states: uniqueSorted(allRows.map(row => clean(row.account.state))),
      routeToMarkets: uniqueSorted(allRows.map(row => clean(row.account.routeToMarket))),
      ownerNames: uniqueSorted(allRows.map(row => row.responsibleOwner).filter(value => value !== "Unassigned")),
      priorityTiers: uniqueSorted(allRows.map(row => clean(row.account.priorityTier))),
      rowClasses: uniqueSorted(allRows.map(row => clean(row.account.rowClass))),
    },
    appliedFilters: {
      segment: input.segment ?? null,
      state: input.state ?? null,
      routeToMarket: input.routeToMarket ?? null,
      ownerName: input.ownerName ?? null,
      priorityTier: input.priorityTier ?? null,
      rowClass: input.rowClass ?? null,
    },
  };
}

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return clean(value[0]) || undefined;
  return clean(value) || undefined;
}

export async function handleFullPotentialDataQuality(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");

  try {
    const user = await sdk.authenticateRequest(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });
  } catch {
    return res.status(401).json({ error: "Authentication required" });
  }

  const parsed = requestSchema.safeParse({
    segment: firstQueryValue(req.query.segment),
    state: firstQueryValue(req.query.state),
    routeToMarket: firstQueryValue(req.query.routeToMarket),
    ownerName: firstQueryValue(req.query.ownerName),
    priorityTier: firstQueryValue(req.query.priorityTier),
    rowClass: firstQueryValue(req.query.rowClass),
    issue: firstQueryValue(req.query.issue),
    limit: firstQueryValue(req.query.limit),
    offset: firstQueryValue(req.query.offset),
  });

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid data-quality query", details: parsed.error.flatten() });
  }

  const db = await getDb();
  if (!db) return res.status(503).json({ error: "Database unavailable" });

  try {
    const [accounts, actions] = await Promise.all([
      db.select().from(fullPotentialAccounts),
      db.select({
        accountId: fullPotentialActions.accountId,
        status: fullPotentialActions.status,
        dueDate: fullPotentialActions.dueDate,
      }).from(fullPotentialActions),
    ]);
    return res.json(buildFullPotentialDataQuality(accounts as AccountLike[], actions as ActionLike[], parsed.data));
  } catch (error) {
    console.error("[FullPotentialDataQuality] Failed to build dashboard", error);
    return res.status(500).json({ error: "Failed to build Full Potential data-quality dashboard" });
  }
}
