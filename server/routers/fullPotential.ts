import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { desc, eq, or, and, sql, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  fullPotentialAccounts,
  fullPotentialAccountAliases,
  fullPotentialActions,
  fullPotentialImports,
  fullPotentialSignals,
  projects,
} from "../../drizzle/schema";

const PREFERRED_SHEETS = ["Platform Import v2.4", "Platform Import", "Canonical Universe v2.4"];
const MAX_ROW_ERRORS = 100;

const actionTypeValues = [
  "account_review",
  "contact_discovery",
  "customer_call",
  "site_visit",
  "channel_handover",
  "installed_base_validation",
  "c4c_create_update",
  "proposal_followup",
  "manager_review",
  "other",
] as const;

const actionStatusValues = [
  "not_started",
  "in_progress",
  "contacted",
  "meeting_booked",
  "quoted",
  "won",
  "lost",
  "deferred",
  "not_relevant",
  "completed",
] as const;

const openActionStatuses = new Set(["not_started", "in_progress", "contacted", "meeting_booked", "quoted"]);

type RowClass = "account" | "site_context" | "channel_managed" | "competitor_watch" | "cluster_signal";
type RouteToMarket =
  | "direct_ape"
  | "cea"
  | "cp_aps"
  | "cp_blastone"
  | "cp_pneumatic_engineering"
  | "cp_more_air"
  | "nz_distributor"
  | "png_oceania"
  | "hybrid_strategic"
  | "product_support"
  | "manual_review"
  | "exclude";
type FpStatus = "active_target" | "develop" | "watch" | "qualify" | "park" | "exclude";
type PriorityTier = "tier_a" | "tier_b" | "tier_c" | "tier_d" | "unassigned";
type PlatformPushDecision = "push_now" | "push_context" | "channel_view" | "qualify_first" | "park_do_not_push";
type ConfidenceLevel = "high" | "medium" | "low" | "unknown";
type InstalledBaseStatus = "known" | "partial" | "unknown" | "not_applicable";
type C4cStatus = "not_in_c4c" | "lead" | "prospect" | "opportunity" | "quote" | "won" | "lost" | "unknown";

type FieldKey =
  | "stableKey"
  | "canonicalName"
  | "displayName"
  | "parentGroup"
  | "rowClass"
  | "country"
  | "state"
  | "region"
  | "segment"
  | "subsegment"
  | "applicationPlays"
  | "routeToMarket"
  | "ownerName"
  | "channelOwner"
  | "fpStatus"
  | "priorityTier"
  | "platformPushDecision"
  | "currentRevenueAud"
  | "fullPotentialAud"
  | "target2026Aud"
  | "remainingPotentialAud"
  | "evidenceSources"
  | "confidenceLevel"
  | "currentSupplier"
  | "installedBaseStatus"
  | "installedBaseNotes"
  | "c4cStatus"
  | "nextAction"
  | "nextActionDate"
  | "aliases"
  | "sourceSheet"
  | "sourceRowNumber";

interface ImportRowError {
  rowNumber: number;
  reason: string;
  raw?: Record<string, unknown>;
}

interface ImportSummary {
  dryRun: boolean;
  fileName: string;
  selectedSheet: string;
  workbookVersion?: string;
  rowsParsed: number;
  rowsProcessed: number;
  createdAccounts: number;
  updatedAccounts: number;
  aliasesCreated: number;
  aliasesSkippedDuplicate: number;
  skippedRows: number;
  errorCount: number;
  errors: ImportRowError[];
}

interface ParsedAccountRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  stableKey: string;
  canonicalName: string;
  displayName?: string;
  parentGroup?: string;
  rowClass: RowClass;
  country: string;
  state?: string;
  region?: string;
  segment?: string;
  subsegment?: string;
  applicationPlays?: string[];
  routeToMarket: RouteToMarket;
  ownerName?: string;
  channelOwner?: string;
  fpStatus: FpStatus;
  priorityTier: PriorityTier;
  platformPushDecision: PlatformPushDecision;
  currentRevenueAud?: string;
  fullPotentialAud?: string;
  target2026Aud?: string;
  remainingPotentialAud?: string;
  evidenceSources?: string[];
  confidenceLevel: ConfidenceLevel;
  currentSupplier?: string;
  installedBaseStatus: InstalledBaseStatus;
  installedBaseNotes?: string;
  c4cStatus: C4cStatus;
  nextAction?: string;
  nextActionDate?: Date;
  aliases: string[];
  sourceSheet: string;
  sourceRowNumber: number;
}

// ── Signal import types ──────────────────────────────────────────────────────

type SignalFieldKey =
  | "accountId"
  | "stableKey"
  | "accountName"
  | "canonicalName"
  | "displayName"
  | "aliasName"
  | "signalTitle"
  | "signalSummary"
  | "signalType"
  | "sourceName"
  | "sourceUrl"
  | "state"
  | "signalDate"
  | "confidenceLevel"
  | "urgency"
  | "suggestedAction"
  | "status";

const SIGNAL_HEADER_ALIASES: Record<string, SignalFieldKey> = {
  // accountId
  accountid: "accountId",
  // stableKey
  stablekey: "stableKey",
  importkey: "stableKey",
  // accountName / canonicalName / displayName / aliasName
  accountname: "accountName",
  account: "accountName",
  canonicalname: "canonicalName",
  canonical: "canonicalName",
  displayname: "displayName",
  aliasname: "aliasName",
  alias: "aliasName",
  // signalTitle
  signaltitle: "signalTitle",
  title: "signalTitle",
  signal: "signalTitle",
  signalname: "signalTitle",
  name: "signalTitle",
  // signalSummary
  signalsummary: "signalSummary",
  summary: "signalSummary",
  description: "signalSummary",
  notes: "signalSummary",
  // signalType
  signaltype: "signalType",
  type: "signalType",
  category: "signalType",
  // sourceName
  sourcename: "sourceName",
  source: "sourceName",
  publication: "sourceName",
  // sourceUrl
  sourceurl: "sourceUrl",
  url: "sourceUrl",
  link: "sourceUrl",
  // state
  state: "state",
  territory: "state",
  // signalDate
  signaldate: "signalDate",
  date: "signalDate",
  publisheddate: "signalDate",
  published: "signalDate",
  // confidenceLevel
  confidencelevel: "confidenceLevel",
  confidence: "confidenceLevel",
  // urgency
  urgency: "urgency",
  priority: "urgency",
  heat: "urgency",
  // suggestedAction
  suggestedaction: "suggestedAction",
  action: "suggestedAction",
  recommendation: "suggestedAction",
  // status
  status: "status",
  signalstatus: "status",
  reviewstatus: "status",
};

interface ParsedSignalRow {
  rowNumber: number;
  accountId?: number;
  stableKey?: string;
  accountName?: string;
  canonicalName?: string;
  displayName?: string;
  aliasName?: string;
  signalTitle: string;
  signalSummary?: string;
  signalType: string;
  sourceName?: string;
  sourceUrl?: string;
  state?: string;
  signalDate?: Date;
  confidenceLevel: string;
  urgency: string;
  suggestedAction?: string;
  status: string;
}

interface SignalImportRowError {
  rowNumber: number;
  field?: string;
  message: string;
}

interface SignalImportPreviewRow {
  rowNumber: number;
  signalTitle: string;
  accountId: number | null;
  accountMatchReason: string | null;
  signalDate: string | null;
  confidenceLevel: string | null;
  urgency: string | null;
  status: string | null;
}

interface SignalImportSummary {
  dryRun: boolean;
  workbookVersion: string | null;
  rowsParsed: number;
  rowsValid: number;
  createdSignals: number;
  skippedDuplicates: number;
  linkedAccounts: number;
  unlinkedSignals: number;
  errors: SignalImportRowError[];
  preview: SignalImportPreviewRow[];
}

const importSignalsInputSchema = z.object({
  fileName: z.string().min(1).max(512),
  fileBase64: z.string().min(1),
  dryRun: z.boolean().optional().default(true),
  workbookVersion: z.string().max(32).optional(),
  sheetName: z.string().min(1).max(128).optional(),
});

const SIGNAL_TYPE_VALUES = new Set([
  "drilling_campaign",
  "awarded_project",
  "live_tender",
  "shutdown_turnaround",
  "pipeline_commissioning",
  "mine_site_activity",
  "civil_application",
  "rental_fleet_signal",
  "competitor_channel_signal",
  "installed_base_signal",
  "contact_discovery_signal",
  "manual",
  "other",
]);

const SIGNAL_CONFIDENCE_VALUES = new Set(["high", "medium", "low", "unknown"]);
const SIGNAL_URGENCY_VALUES = new Set(["hot", "warm", "cold", "unknown"]);
const SIGNAL_STATUS_VALUES = new Set(["new", "reviewed", "promoted", "dismissed", "archived"]);

function buildSignalHeaderMap(headers: unknown[]): Map<SignalFieldKey, number> {
  const map = new Map<SignalFieldKey, number>();
  headers.forEach((header, index) => {
    const field = SIGNAL_HEADER_ALIASES[normalizeHeader(header)];
    if (field && !map.has(field)) map.set(field, index);
  });
  return map;
}

function signalRowValue(row: unknown[], headerMap: Map<SignalFieldKey, number>, field: SignalFieldKey): unknown {
  const index = headerMap.get(field);
  if (index === undefined) return undefined;
  return row[index];
}

function mapSignalType(value: unknown): string {
  const token = normalizeToken(value);
  if (!token) return "other";
  if (token.includes("drill")) return "drilling_campaign";
  if (token.includes("award")) return "awarded_project";
  if (token.includes("tender") || token.includes("live tender")) return "live_tender";
  if (token.includes("shutdown") || token.includes("turnaround")) return "shutdown_turnaround";
  if (token.includes("pipeline") || token.includes("commission")) return "pipeline_commissioning";
  if (token.includes("mine site") || token.includes("minesite") || token.includes("mine activity")) return "mine_site_activity";
  if (token.includes("civil")) return "civil_application";
  if (token.includes("rental") || token.includes("fleet")) return "rental_fleet_signal";
  if (token.includes("competitor") || token.includes("channel signal")) return "competitor_channel_signal";
  if (token.includes("installed base")) return "installed_base_signal";
  if (token.includes("contact") || token.includes("discovery")) return "contact_discovery_signal";
  if (token === "manual") return "manual";
  if (SIGNAL_TYPE_VALUES.has(token)) return token;
  return "other";
}

function parseSignalRow(
  row: unknown[],
  headers: unknown[],
  headerMap: Map<SignalFieldKey, number>,
  rowNumber: number,
): { parsed?: ParsedSignalRow; error?: SignalImportRowError; blank?: boolean } {
  if (!row || row.every(cell => !cleanString(cell))) return { blank: true };
  const signalTitle = cleanString(signalRowValue(row, headerMap, "signalTitle"));
  if (!signalTitle) return { error: { rowNumber, field: "signalTitle", message: "Missing or blank signalTitle" } };

  const rawAccountId = cleanString(signalRowValue(row, headerMap, "accountId"));
  const parsedAccountId = rawAccountId ? parseInteger(rawAccountId) : undefined;

  const rawDate = signalRowValue(row, headerMap, "signalDate");
  let signalDate: Date | undefined;
  if (rawDate !== undefined && cleanString(rawDate)) {
    signalDate = parseDate(rawDate);
    if (!signalDate) return { error: { rowNumber, field: "signalDate", message: `Invalid signalDate: ${cleanString(rawDate)}` } };
  }

  const rawConfidence = cleanString(signalRowValue(row, headerMap, "confidenceLevel"));
  const confidenceLevel = rawConfidence && SIGNAL_CONFIDENCE_VALUES.has(normalizeToken(rawConfidence))
    ? normalizeToken(rawConfidence)
    : "unknown";

  const rawUrgency = cleanString(signalRowValue(row, headerMap, "urgency"));
  const urgency = rawUrgency && SIGNAL_URGENCY_VALUES.has(normalizeToken(rawUrgency))
    ? normalizeToken(rawUrgency)
    : "unknown";

  const rawStatus = cleanString(signalRowValue(row, headerMap, "status"));
  const status = rawStatus && SIGNAL_STATUS_VALUES.has(normalizeToken(rawStatus))
    ? normalizeToken(rawStatus)
    : "new";

  const parsed: ParsedSignalRow = {
    rowNumber,
    accountId: parsedAccountId,
    stableKey: cleanString(signalRowValue(row, headerMap, "stableKey")),
    accountName: cleanString(signalRowValue(row, headerMap, "accountName")),
    canonicalName: cleanString(signalRowValue(row, headerMap, "canonicalName")),
    displayName: cleanString(signalRowValue(row, headerMap, "displayName")),
    aliasName: cleanString(signalRowValue(row, headerMap, "aliasName")),
    signalTitle,
    signalSummary: cleanString(signalRowValue(row, headerMap, "signalSummary")),
    signalType: mapSignalType(signalRowValue(row, headerMap, "signalType")),
    sourceName: cleanString(signalRowValue(row, headerMap, "sourceName")),
    sourceUrl: cleanString(signalRowValue(row, headerMap, "sourceUrl")),
    state: cleanString(signalRowValue(row, headerMap, "state")),
    signalDate,
    confidenceLevel,
    urgency,
    suggestedAction: cleanString(signalRowValue(row, headerMap, "suggestedAction")),
    status,
  };
  return { parsed };
}

function buildSignalDuplicateKey(
  accountId: number | null,
  signalTitle: string,
  sourceUrl: string | undefined,
  sourceName: string | undefined,
  signalDate: Date | undefined,
): string {
  const accountPart = accountId !== null && accountId !== undefined ? String(accountId) : "unlinked";
  const titlePart = normalizeToken(signalTitle);
  const sourcePart = sourceUrl ? normalizeToken(sourceUrl) : sourceName ? normalizeToken(sourceName) : "no-source";
  const datePart = signalDate ? signalDate.toISOString().slice(0, 10) : "no-date";
  return `${accountPart}::${titlePart}::${sourcePart}::${datePart}`;
}

async function resolveSignalAccountId(
  db: Awaited<ReturnType<typeof getDb>>,
  parsed: ParsedSignalRow,
): Promise<{ accountId: number | null; matchReason: string | null }> {
  if (!db) return { accountId: null, matchReason: null };

  // Rule 1: explicit accountId
  if (parsed.accountId !== undefined) {
    const [row] = await db.select({ id: fullPotentialAccounts.id }).from(fullPotentialAccounts)
      .where(eq(fullPotentialAccounts.id, parsed.accountId)).limit(1);
    if (row) return { accountId: row.id, matchReason: "account_id" };
  }

  // Rule 2: stableKey
  if (parsed.stableKey) {
    const [row] = await db.select({ id: fullPotentialAccounts.id }).from(fullPotentialAccounts)
      .where(eq(fullPotentialAccounts.stableKey, parsed.stableKey)).limit(1);
    if (row) return { accountId: row.id, matchReason: "stable_key" };
  }

  // Rule 3: canonicalName / accountName / displayName (normalised match)
  // Both sides are normalised using the same logic as normalizeToken():
  //   uploaded candidate: normalizeToken(candidate)  → strips [^a-z0-9]+ to spaces, lowercases
  //   DB side: REGEXP_REPLACE(LOWER(col), '[^a-z0-9]+', ' ') → same transformation in MySQL
  // This ensures punctuation, hyphens, ampersands, and extra whitespace differences do not
  // cause false negatives (e.g. "BHP Iron-Ore" matches "BHP Iron Ore").
  const nameCandidates = [parsed.canonicalName, parsed.accountName, parsed.displayName].filter((v): v is string => !!v);
  for (const candidate of nameCandidates) {
    const normCandidate = normalizeToken(candidate);
    const [row] = await db.select({ id: fullPotentialAccounts.id, canonicalName: fullPotentialAccounts.canonicalName, displayName: fullPotentialAccounts.displayName })
      .from(fullPotentialAccounts)
      .where(
        or(
          sql`TRIM(REGEXP_REPLACE(LOWER(${fullPotentialAccounts.canonicalName}), '[^a-z0-9]+', ' ')) = ${normCandidate}`,
          sql`TRIM(REGEXP_REPLACE(LOWER(${fullPotentialAccounts.displayName}), '[^a-z0-9]+', ' ')) = ${normCandidate}`,
        )
      ).limit(1);
    if (row) {
      const reason = normalizeToken(row.canonicalName) === normCandidate ? "canonical_name" : "display_name";
      return { accountId: row.id, matchReason: reason };
    }
  }

  // Rule 4: aliasName (normalised match — same REGEXP_REPLACE approach)
  if (parsed.aliasName) {
    const normAlias = normalizeToken(parsed.aliasName);
    const [aliasRow] = await db.select({ accountId: fullPotentialAccountAliases.accountId })
      .from(fullPotentialAccountAliases)
      .where(sql`TRIM(REGEXP_REPLACE(LOWER(${fullPotentialAccountAliases.aliasName}), '[^a-z0-9]+', ' ')) = ${normAlias}`)
      .limit(1);
    if (aliasRow) return { accountId: aliasRow.accountId, matchReason: "alias" };
  }

  return { accountId: null, matchReason: "unlinked" };
}

async function importSignals(input: z.infer<typeof importSignalsInputSchema>, user: { id: number; name?: string | null; email?: string | null }): Promise<SignalImportSummary> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const dryRun = input.dryRun ?? true;
  let workbook: XLSX.WorkBook;
  try {
    workbook = decodeWorkbook(input.fileName, input.fileBase64);
  } catch (error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message });
  }
  let selectedSheet: string;
  let sheet: XLSX.WorkSheet;
  try {
    ({ selectedSheet, sheet } = selectWorkbookSheet(workbook, input.sheetName));
  } catch (error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message });
  }
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false, raw: false });
  if (allRows.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Selected sheet is empty" });

  // Detect header row by looking for signalTitle alias
  let headerRowIndex = 0;
  const maxScan = Math.min(allRows.length, 15);
  for (let i = 0; i < maxScan; i++) {
    const normalized = (allRows[i] ?? []).map(normalizeHeader);
    if (normalized.some(h => SIGNAL_HEADER_ALIASES[h] === "signalTitle")) {
      headerRowIndex = i;
      break;
    }
  }

  const headers = allRows[headerRowIndex] ?? [];
  const headerMap = buildSignalHeaderMap(headers);
  const dataRows = allRows.slice(headerRowIndex + 1);

  const summary: SignalImportSummary = {
    dryRun,
    workbookVersion: input.workbookVersion ?? null,
    rowsParsed: dataRows.length,
    rowsValid: 0,
    createdSignals: 0,
    skippedDuplicates: 0,
    linkedAccounts: 0,
    unlinkedSignals: 0,
    errors: [],
    preview: [],
  };

  // Track duplicate keys seen within this upload
  const seenDuplicateKeys = new Set<string>();

  // Pre-load existing signal duplicate keys from DB for fast lookup
  const existingSignals = await db.select({
    accountId: fullPotentialSignals.accountId,
    signalTitle: fullPotentialSignals.signalTitle,
    sourceUrl: fullPotentialSignals.sourceUrl,
    sourceName: fullPotentialSignals.sourceName,
    signalDate: fullPotentialSignals.signalDate,
  }).from(fullPotentialSignals);

  const existingDuplicateKeys = new Set<string>(
    existingSignals.map(s =>
      buildSignalDuplicateKey(
        s.accountId ?? null,
        s.signalTitle,
        s.sourceUrl ?? undefined,
        s.sourceName ?? undefined,
        s.signalDate ? new Date(s.signalDate) : undefined,
      )
    )
  );

  for (let index = 0; index < dataRows.length; index++) {
    const rowNumber = headerRowIndex + index + 2;
    const result = parseSignalRow(dataRows[index], headers, headerMap, rowNumber);
    if (result.blank) continue;
    if (result.error || !result.parsed) {
      if (summary.errors.length < MAX_ROW_ERRORS && result.error) summary.errors.push(result.error);
      continue;
    }
    const parsed = result.parsed;

    // Resolve account linkage
    const { accountId: resolvedAccountId, matchReason } = await resolveSignalAccountId(db, parsed);

    // Build duplicate key
    const dupKey = buildSignalDuplicateKey(
      resolvedAccountId,
      parsed.signalTitle,
      parsed.sourceUrl,
      parsed.sourceName,
      parsed.signalDate,
    );

    // Check for within-upload duplicate
    if (seenDuplicateKeys.has(dupKey)) {
      summary.skippedDuplicates++;
      continue;
    }
    seenDuplicateKeys.add(dupKey);

    // Check for DB duplicate
    if (existingDuplicateKeys.has(dupKey)) {
      summary.skippedDuplicates++;
      continue;
    }

    summary.rowsValid++;
    if (resolvedAccountId !== null) {
      summary.linkedAccounts++;
    } else {
      summary.unlinkedSignals++;
    }

    // Add to preview (capped at 20)
    if (summary.preview.length < 20) {
      summary.preview.push({
        rowNumber,
        signalTitle: parsed.signalTitle,
        accountId: resolvedAccountId,
        accountMatchReason: matchReason,
        signalDate: parsed.signalDate ? parsed.signalDate.toISOString() : null,
        confidenceLevel: parsed.confidenceLevel,
        urgency: parsed.urgency,
        status: parsed.status,
      });
    }

    if (!dryRun) {
      await db.insert(fullPotentialSignals).values({
        accountId: resolvedAccountId ?? undefined,
        signalType: parsed.signalType as any,
        signalTitle: parsed.signalTitle,
        signalSummary: parsed.signalSummary ?? null,
        sourceName: parsed.sourceName ?? null,
        sourceUrl: parsed.sourceUrl ?? null,
        signalDate: parsed.signalDate ?? null,
        state: parsed.state ?? null,
        confidenceLevel: parsed.confidenceLevel as any,
        urgency: parsed.urgency as any,
        suggestedAction: parsed.suggestedAction ?? null,
        status: parsed.status as any,
      } as any);
      summary.createdSignals++;
    }
  }

  if (summary.rowsValid === 0 && summary.errors.length === 0 && summary.skippedDuplicates === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No usable signal rows found in the selected sheet" });
  }

  return summary;
}

const importInputSchema = z.object({
  fileName: z.string().min(1).max(512),
  fileBase64: z.string().min(1),
  sheetName: z.string().min(1).max(128).optional(),
  dryRun: z.boolean().optional().default(true),
  sourceWorkbookVersion: z.string().max(32).optional(),
  clearBlankValues: z.boolean().optional().default(false),
});

const listInputSchema = z.object({
  search: z.string().max(200).optional(),
  fpStatus: z.string().max(64).optional(),
  platformPushDecision: z.string().max(64).optional(),
  routeToMarket: z.string().max(128).optional(),
  ownerName: z.string().max(256).optional(),
  segment: z.string().max(128).optional(),
  state: z.string().max(64).optional(),
  priorityTier: z.string().max(64).optional(),
  rowClass: z.string().max(64).optional(),
  limit: z.number().int().min(1).max(500).optional().default(100),
  offset: z.number().int().min(0).optional().default(0),
});

const importHistoryInputSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(10),
});

const createActionInputSchema = z.object({
  accountId: z.number().int().positive(),
  actionType: z.enum(actionTypeValues).optional().default("account_review"),
  recommendedAction: z.string().min(1).max(512),
  dueDate: z.string().max(64).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const updateActionStatusInputSchema = z.object({
  actionId: z.number().int().positive(),
  status: z.enum(actionStatusValues),
  notes: z.string().max(2000).nullable().optional(),
});

const HEADER_ALIASES: Record<string, FieldKey> = {
  stablekey: "stableKey",
  importkey: "stableKey",
  account: "canonicalName",
  accountname: "canonicalName",
  canonicalname: "canonicalName",
  customer: "canonicalName",
  customername: "canonicalName",
  company: "canonicalName",
  companyname: "canonicalName",
  displayname: "displayName",
  parentgroup: "parentGroup",
  group: "parentGroup",
  rowclass: "rowClass",
  recordclass: "rowClass",
  country: "country",
  state: "state",
  territory: "state",
  region: "region",
  segment: "segment",
  subsegment: "subsegment",
  subsegmentapplication: "subsegment",
  application: "applicationPlays",
  applications: "applicationPlays",
  applicationplay: "applicationPlays",
  applicationplays: "applicationPlays",
  route: "routeToMarket",
  routetomarket: "routeToMarket",
  rtm: "routeToMarket",
  owner: "ownerName",
  ownername: "ownerName",
  assignedto: "ownerName",
  salesowner: "ownerName",
  channelowner: "channelOwner",
  fpstatus: "fpStatus",
  status: "fpStatus",
  accountstatus: "fpStatus",
  prioritytier: "priorityTier",
  tier: "priorityTier",
  platformpushdecision: "platformPushDecision",
  pushdecision: "platformPushDecision",
  platformdecision: "platformPushDecision",
  currentrevenue: "currentRevenueAud",
  currentrevenueaud: "currentRevenueAud",
  fullpotential: "fullPotentialAud",
  fullpotentialaud: "fullPotentialAud",
  potential: "fullPotentialAud",
  target2026: "target2026Aud",
  target2026aud: "target2026Aud",
  twentytwentysixtarget: "target2026Aud",
  remainingpotential: "remainingPotentialAud",
  remainingpotentialaud: "remainingPotentialAud",
  evidencesource: "evidenceSources",
  evidencesources: "evidenceSources",
  evidence: "evidenceSources",
  confidence: "confidenceLevel",
  confidencelevel: "confidenceLevel",
  currentsupplier: "currentSupplier",
  incumbent: "currentSupplier",
  installedbasestatus: "installedBaseStatus",
  installedbase: "installedBaseStatus",
  installedbasenotes: "installedBaseNotes",
  c4cstatus: "c4cStatus",
  crmstatus: "c4cStatus",
  nextaction: "nextAction",
  nextactiondate: "nextActionDate",
  aliases: "aliases",
  alias: "aliases",
  sourcerow: "sourceRowNumber",
  sourcerownumber: "sourceRowNumber",
  sourcesheet: "sourceSheet",
};

function cleanString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const cleaned = String(value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function normalizeHeader(value: unknown): string {
  return (cleanString(value) ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "").trim();
}

function normalizeToken(value: unknown): string {
  return (cleanString(value) ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeKeyPart(value: unknown): string {
  return normalizeToken(value).replace(/\s+/g, "_") || "unknown";
}

function normalizeAlias(value: string): string {
  return normalizeToken(value).replace(/\s+/g, " ");
}

function splitList(value: unknown): string[] | undefined {
  const raw = cleanString(value);
  if (!raw) return undefined;
  const parts = raw.split(/[;,|]/g).map(p => cleanString(p)).filter((p): p is string => !!p);
  const unique = Array.from(new Set(parts));
  return unique.length ? unique : undefined;
}

function parseMoney(value: unknown): string | undefined {
  const raw = cleanString(value);
  if (!raw) return undefined;
  const numeric = raw.replace(/[^0-9.-]/g, "");
  if (!numeric || numeric === "-" || numeric === ".") return undefined;
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed.toFixed(2);
}

function parseInteger(value: unknown): number | undefined {
  const raw = cleanString(value);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDate(value: unknown): Date | undefined {
  const raw = cleanString(value);
  if (!raw) return undefined;
  const asNumber = Number(raw.replace(/[^0-9.]/g, ""));
  if (/^\d{4,6}$/.test(raw.trim()) && asNumber >= 1 && asNumber <= 99999) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const excelDate = new Date(excelEpoch.getTime() + asNumber * 86400000);
    if (!Number.isNaN(excelDate.getTime())) return excelDate;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function parseOptionalDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function mapRowClass(value: unknown): RowClass | undefined {
  const token = normalizeToken(value);
  if (!token) return undefined;
  if (["account", "customer", "company"].includes(token)) return "account";
  if (["site", "site context", "sitecontext", "mine site", "minesite", "project site"].includes(token)) return "site_context";
  if (["channel", "channel managed", "channelmanaged", "distributor", "distributor managed"].includes(token)) return "channel_managed";
  if (["competitor", "competitor watch", "competitorwatch", "watch competitor"].includes(token)) return "competitor_watch";
  if (["cluster", "cluster signal", "clustersignal", "signal source", "signalsource", "cluster source"].includes(token)) return "cluster_signal";
  return undefined;
}

function mapRoute(value: unknown): RouteToMarket | undefined {
  const token = normalizeToken(value);
  if (!token) return undefined;
  if (token.includes("exclude")) return "exclude";
  if (token.includes("manual")) return "manual_review";
  if (token.includes("product support")) return "product_support";
  if (token.includes("hybrid")) return "hybrid_strategic";
  if (token.includes("png") || token.includes("oceania")) return "png_oceania";
  if (token.includes("nz") || token.includes("new zealand")) return "nz_distributor";
  if (token.includes("more air")) return "cp_more_air";
  if (token.includes("pneumatic")) return "cp_pneumatic_engineering";
  if (token.includes("blastone") || token.includes("blast one")) return "cp_blastone";
  if (token === "aps" || token.includes("cp aps") || token.includes("atlas portable solutions")) return "cp_aps";
  if (token.includes("cea")) return "cea";
  if (token.includes("direct") || token.includes("ape") || token.includes("ryan") || token.includes("paul") || token.includes("dan")) return "direct_ape";
  return undefined;
}

function mapFpStatus(value: unknown): FpStatus | undefined {
  const token = normalizeToken(value);
  if (!token) return undefined;
  if (["active target", "activetarget", "target", "2026 target", "in target"].includes(token)) return "active_target";
  if (["develop", "development", "develop account", "in progress"].includes(token)) return "develop";
  if (["watch", "watchlist", "monitor"].includes(token)) return "watch";
  if (["qualify", "qualification", "qualify first", "suspect"].includes(token)) return "qualify";
  if (["park", "parked"].includes(token)) return "park";
  if (["exclude", "excluded", "not relevant"].includes(token)) return "exclude";
  return undefined;
}

function mapPriorityTier(value: unknown): PriorityTier {
  const token = normalizeToken(value);
  if (!token) return "unassigned";
  if (["a", "tier a", "tiera", "tier 1", "tier1", "priority a", "prioritya"].includes(token)) return "tier_a";
  if (["b", "tier b", "tierb", "tier 2", "tier2", "priority b", "priorityb"].includes(token)) return "tier_b";
  if (["c", "tier c", "tierc", "tier 3", "tier3", "priority c", "priorityc"].includes(token)) return "tier_c";
  if (["d", "tier d", "tierd", "tier 4", "tier4", "priority d", "priorityd"].includes(token)) return "tier_d";
  return "unassigned";
}

function mapPlatformPushDecision(value: unknown): PlatformPushDecision | undefined {
  const token = normalizeToken(value);
  if (!token) return undefined;
  if (["push now", "pushnow", "yes", "y", "platform push", "platformpush"].includes(token)) return "push_now";
  if (["push context", "pushcontext", "context", "site context"].includes(token)) return "push_context";
  if (["channel view", "channelview", "channel", "distributor view"].includes(token)) return "channel_view";
  if (["qualify first", "qualifyfirst", "qualify", "validate", "validation"].includes(token)) return "qualify_first";
  if (["park do not push", "parkdonotpush", "do not push", "donotpush", "park", "no", "n"].includes(token)) return "park_do_not_push";
  return undefined;
}

function mapConfidence(value: unknown): ConfidenceLevel {
  const token = normalizeToken(value);
  if (token === "high") return "high";
  if (token === "medium" || token === "med") return "medium";
  if (token === "low") return "low";
  return "unknown";
}

function mapInstalledBaseStatus(value: unknown): InstalledBaseStatus {
  const token = normalizeToken(value);
  if (["known", "yes", "y"].includes(token)) return "known";
  if (["partial", "partially known", "some"].includes(token)) return "partial";
  if (["not applicable", "notapplicable", "na", "n a"].includes(token)) return "not_applicable";
  return "unknown";
}

function mapC4cStatus(value: unknown): C4cStatus {
  const token = normalizeToken(value);
  if (["not in c4c", "notinc4c", "not in crm", "notincrm"].includes(token)) return "not_in_c4c";
  if (token === "lead") return "lead";
  if (token === "prospect") return "prospect";
  if (token === "opportunity") return "opportunity";
  if (token === "quote" || token === "quoted") return "quote";
  if (token === "won") return "won";
  if (token === "lost") return "lost";
  return "unknown";
}

function generateStableKey(row: Pick<ParsedAccountRow, "canonicalName" | "rowClass" | "country" | "state" | "routeToMarket">): string {
  return [normalizeKeyPart(row.canonicalName), normalizeKeyPart(row.rowClass), normalizeKeyPart(row.country), normalizeKeyPart(row.state), normalizeKeyPart(row.routeToMarket)].join("|");
}

function selectWorkbookSheet(workbook: XLSX.WorkBook, requested?: string): { selectedSheet: string; sheet: XLSX.WorkSheet } {
  if (requested) {
    const requestedMatch = workbook.SheetNames.find(name => name.toLowerCase() === requested.toLowerCase());
    if (!requestedMatch) throw new Error(`Sheet "${requested}" not found`);
    return { selectedSheet: requestedMatch, sheet: workbook.Sheets[requestedMatch] };
  }
  for (const preferred of PREFERRED_SHEETS) {
    const match = workbook.SheetNames.find(name => name.toLowerCase() === preferred.toLowerCase());
    if (match) return { selectedSheet: match, sheet: workbook.Sheets[match] };
  }
  const first = workbook.SheetNames[0];
  if (!first) throw new Error("Workbook has no sheets");
  return { selectedSheet: first, sheet: workbook.Sheets[first] };
}

function decodeWorkbook(fileName: string, fileBase64: string): XLSX.WorkBook {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls") && !lower.endsWith(".csv")) throw new Error("Unsupported file type. Use .xlsx, .xls or .csv");
  const cleanBase64 = fileBase64.replace(/^data:.*?;base64,/, "");
  const buffer = Buffer.from(cleanBase64, "base64");
  if (!buffer.length) throw new Error("Uploaded file is empty");
  if (lower.endsWith(".csv")) return XLSX.read(buffer.toString("utf8"), { type: "string" });
  return XLSX.read(buffer, { type: "buffer" });
}

function detectHeaderRow(rows: unknown[][]): number {
  const maxScan = Math.min(rows.length, 15);
  for (let i = 0; i < maxScan; i++) {
    const normalized = (rows[i] ?? []).map(normalizeHeader);
    const mapped = normalized.map(header => HEADER_ALIASES[header]);
    if (mapped.includes("canonicalName")) return i;
  }
  return 0;
}

function buildHeaderMap(headers: unknown[]): Map<FieldKey, number> {
  const map = new Map<FieldKey, number>();
  headers.forEach((header, index) => {
    const field = HEADER_ALIASES[normalizeHeader(header)];
    if (field && !map.has(field)) map.set(field, index);
  });
  return map;
}

function rowValue(row: unknown[], headerMap: Map<FieldKey, number>, field: FieldKey): unknown {
  const index = headerMap.get(field);
  if (index === undefined) return undefined;
  return row[index];
}

function buildRawRecord(headers: unknown[], row: unknown[]): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  headers.forEach((header, index) => {
    const key = cleanString(header) ?? `Column ${index + 1}`;
    raw[key] = row[index] ?? "";
  });
  return raw;
}

function parseAccountRow(row: unknown[], headers: unknown[], headerMap: Map<FieldKey, number>, rowNumber: number, selectedSheet: string): { parsed?: ParsedAccountRow; error?: ImportRowError; blank?: boolean } {
  if (!row || row.every(cell => !cleanString(cell))) return { blank: true };
  const raw = buildRawRecord(headers, row);
  const canonicalName = cleanString(rowValue(row, headerMap, "canonicalName"));
  if (!canonicalName) return { error: { rowNumber, reason: "Missing canonicalName", raw } };
  const rowClass = mapRowClass(rowValue(row, headerMap, "rowClass"));
  if (!rowClass) return { error: { rowNumber, reason: "Missing or unmapped rowClass", raw } };
  const routeToMarket = mapRoute(rowValue(row, headerMap, "routeToMarket"));
  if (!routeToMarket) return { error: { rowNumber, reason: "Missing or unmapped routeToMarket", raw } };
  const fpStatus = mapFpStatus(rowValue(row, headerMap, "fpStatus"));
  if (!fpStatus) return { error: { rowNumber, reason: "Missing or unmapped fpStatus", raw } };
  const platformPushDecision = mapPlatformPushDecision(rowValue(row, headerMap, "platformPushDecision"));
  if (!platformPushDecision) return { error: { rowNumber, reason: "Missing or unmapped platformPushDecision", raw } };
  const country = cleanString(rowValue(row, headerMap, "country")) ?? "AU";
  const parsed: ParsedAccountRow = {
    rowNumber,
    raw,
    stableKey: cleanString(rowValue(row, headerMap, "stableKey")) ?? "",
    canonicalName,
    displayName: cleanString(rowValue(row, headerMap, "displayName")),
    parentGroup: cleanString(rowValue(row, headerMap, "parentGroup")),
    rowClass,
    country,
    state: cleanString(rowValue(row, headerMap, "state")),
    region: cleanString(rowValue(row, headerMap, "region")),
    segment: cleanString(rowValue(row, headerMap, "segment")),
    subsegment: cleanString(rowValue(row, headerMap, "subsegment")),
    applicationPlays: splitList(rowValue(row, headerMap, "applicationPlays")),
    routeToMarket,
    ownerName: cleanString(rowValue(row, headerMap, "ownerName")),
    channelOwner: cleanString(rowValue(row, headerMap, "channelOwner")),
    fpStatus,
    priorityTier: mapPriorityTier(rowValue(row, headerMap, "priorityTier")),
    platformPushDecision,
    currentRevenueAud: parseMoney(rowValue(row, headerMap, "currentRevenueAud")),
    fullPotentialAud: parseMoney(rowValue(row, headerMap, "fullPotentialAud")),
    target2026Aud: parseMoney(rowValue(row, headerMap, "target2026Aud")),
    remainingPotentialAud: parseMoney(rowValue(row, headerMap, "remainingPotentialAud")),
    evidenceSources: splitList(rowValue(row, headerMap, "evidenceSources")),
    confidenceLevel: mapConfidence(rowValue(row, headerMap, "confidenceLevel")),
    currentSupplier: cleanString(rowValue(row, headerMap, "currentSupplier")),
    installedBaseStatus: mapInstalledBaseStatus(rowValue(row, headerMap, "installedBaseStatus")),
    installedBaseNotes: cleanString(rowValue(row, headerMap, "installedBaseNotes")),
    c4cStatus: mapC4cStatus(rowValue(row, headerMap, "c4cStatus")),
    nextAction: cleanString(rowValue(row, headerMap, "nextAction")),
    nextActionDate: parseDate(rowValue(row, headerMap, "nextActionDate")),
    aliases: splitList(rowValue(row, headerMap, "aliases")) ?? [],
    sourceSheet: cleanString(rowValue(row, headerMap, "sourceSheet")) ?? selectedSheet,
    sourceRowNumber: parseInteger(rowValue(row, headerMap, "sourceRowNumber")) ?? rowNumber,
  };
  parsed.stableKey = parsed.stableKey || generateStableKey(parsed);
  return { parsed };
}

function buildAccountValues(row: ParsedAccountRow, sourceWorkbookVersion?: string): Record<string, unknown> {
  return {
    stableKey: row.stableKey,
    canonicalName: row.canonicalName,
    displayName: row.displayName,
    parentGroup: row.parentGroup,
    rowClass: row.rowClass,
    country: row.country,
    state: row.state,
    region: row.region,
    segment: row.segment,
    subsegment: row.subsegment,
    applicationPlays: row.applicationPlays,
    routeToMarket: row.routeToMarket,
    ownerName: row.ownerName,
    channelOwner: row.channelOwner,
    fpStatus: row.fpStatus,
    priorityTier: row.priorityTier,
    platformPushDecision: row.platformPushDecision,
    currentRevenueAud: row.currentRevenueAud,
    fullPotentialAud: row.fullPotentialAud,
    target2026Aud: row.target2026Aud,
    remainingPotentialAud: row.remainingPotentialAud,
    evidenceSources: row.evidenceSources,
    confidenceLevel: row.confidenceLevel,
    currentSupplier: row.currentSupplier,
    installedBaseStatus: row.installedBaseStatus,
    installedBaseNotes: row.installedBaseNotes,
    c4cStatus: row.c4cStatus,
    nextAction: row.nextAction,
    nextActionDate: row.nextActionDate,
    sourceWorkbookVersion,
    sourceSheet: row.sourceSheet,
    sourceRowNumber: row.sourceRowNumber,
    rawSourceJson: row.raw,
  };
}

function removeUndefinedValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function clearUndefinedValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === undefined ? null : value]));
}

function numberValue(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addCount(map: Record<string, number>, key: unknown) {
  const normalized = cleanString(key) ?? "unknown";
  map[normalized] = (map[normalized] ?? 0) + 1;
}

function uniqueSorted(values: unknown[]): string[] {
  return Array.from(new Set(values.map(cleanString).filter((value): value is string => !!value))).sort((a, b) => a.localeCompare(b));
}

function matchesFilter(value: unknown, filter?: string): boolean {
  if (!filter || filter === "all") return true;
  return (cleanString(value) ?? "") === filter;
}

function accountMatchesSearch(account: any, search?: string): boolean {
  const token = normalizeToken(search);
  if (!token) return true;
  const haystack = normalizeToken([
    account.canonicalName,
    account.displayName,
    account.parentGroup,
    account.state,
    account.segment,
    account.subsegment,
    account.ownerName,
    account.channelOwner,
    account.currentSupplier,
    ...(Array.isArray(account.applicationPlays) ? account.applicationPlays : []),
  ].filter(Boolean).join(" "));
  return haystack.includes(token);
}

function toClientAccount(account: any) {
  return {
    ...account,
    fullPotentialAud: numberValue(account.fullPotentialAud),
    currentRevenueAud: numberValue(account.currentRevenueAud),
    target2026Aud: numberValue(account.target2026Aud),
    remainingPotentialAud: numberValue(account.remainingPotentialAud),
    signalCount: 0,
  };
}

function toClientAction(action: any) {
  return {
    ...action,
    dueDate: action.dueDate ? new Date(action.dueDate).toISOString() : null,
    createdAt: action.createdAt ? new Date(action.createdAt).toISOString() : null,
    updatedAt: action.updatedAt ? new Date(action.updatedAt).toISOString() : null,
    completedAt: action.completedAt ? new Date(action.completedAt).toISOString() : null,
  };
}

function toClientActionWithAccount(action: any, account: any) {
  return {
    ...toClientAction(action),
    account: {
      id: account.id,
      canonicalName: account.canonicalName,
      displayName: account.displayName,
      parentGroup: account.parentGroup,
      state: account.state,
      segment: account.segment,
      routeToMarket: account.routeToMarket,
      ownerName: account.ownerName,
      channelOwner: account.channelOwner,
      fpStatus: account.fpStatus,
      priorityTier: account.priorityTier,
      platformPushDecision: account.platformPushDecision,
      fullPotentialAud: numberValue(account.fullPotentialAud),
      target2026Aud: numberValue(account.target2026Aud),
    },
  };
}

function sortByDueDateAsc(a: any, b: any) {
  const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
  const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
  return aTime - bTime;
}

async function importFullPotential(input: z.infer<typeof importInputSchema>, user: { id: number; name?: string | null; email?: string | null }): Promise<ImportSummary> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const dryRun = input.dryRun ?? true;
  const clearBlankValues = input.clearBlankValues ?? false;
  let workbook: XLSX.WorkBook;
  try {
    workbook = decodeWorkbook(input.fileName, input.fileBase64);
  } catch (error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message });
  }
  let selectedSheet: string;
  let sheet: XLSX.WorkSheet;
  try {
    ({ selectedSheet, sheet } = selectWorkbookSheet(workbook, input.sheetName));
  } catch (error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message });
  }
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false, raw: false });
  if (allRows.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Selected sheet is empty" });
  const headerRowIndex = detectHeaderRow(allRows);
  const headers = allRows[headerRowIndex] ?? [];
  const headerMap = buildHeaderMap(headers);
  const dataRows = allRows.slice(headerRowIndex + 1);
  const summary: ImportSummary = {
    dryRun,
    fileName: input.fileName,
    selectedSheet,
    workbookVersion: input.sourceWorkbookVersion,
    rowsParsed: dataRows.length,
    rowsProcessed: 0,
    createdAccounts: 0,
    updatedAccounts: 0,
    aliasesCreated: 0,
    aliasesSkippedDuplicate: 0,
    skippedRows: 0,
    errorCount: 0,
    errors: [],
  };
  for (let index = 0; index < dataRows.length; index++) {
    const rowNumber = headerRowIndex + index + 2;
    const result = parseAccountRow(dataRows[index], headers, headerMap, rowNumber, selectedSheet);
    if (result.blank) {
      summary.skippedRows++;
      continue;
    }
    if (result.error || !result.parsed) {
      summary.skippedRows++;
      summary.errorCount++;
      if (summary.errors.length < MAX_ROW_ERRORS && result.error) summary.errors.push(result.error);
      continue;
    }
    const parsed = result.parsed;
    const [existing] = await db.select().from(fullPotentialAccounts).where(eq(fullPotentialAccounts.stableKey, parsed.stableKey)).limit(1);
    const accountValues = buildAccountValues(parsed, input.sourceWorkbookVersion);
    const writeValues = clearBlankValues ? clearUndefinedValues(accountValues) : removeUndefinedValues(accountValues);
    let accountId = existing?.id;
    if (existing) {
      summary.updatedAccounts++;
      if (!dryRun) await db.update(fullPotentialAccounts).set(writeValues).where(eq(fullPotentialAccounts.id, existing.id));
    } else {
      summary.createdAccounts++;
      if (!dryRun) {
        await db.insert(fullPotentialAccounts).values(removeUndefinedValues(accountValues) as any);
        const [created] = await db.select({ id: fullPotentialAccounts.id }).from(fullPotentialAccounts).where(eq(fullPotentialAccounts.stableKey, parsed.stableKey)).limit(1);
        accountId = created?.id;
      }
    }
    const uniqueAliases = Array.from(new Map(parsed.aliases.map(alias => [normalizeAlias(alias), alias])).values()).filter(alias => normalizeAlias(alias) && normalizeAlias(alias) !== normalizeAlias(parsed.canonicalName));
    if (uniqueAliases.length > 0) {
      const existingAliasSet = new Set<string>();
      if (existing?.id || accountId) {
        const aliasRows = await db.select({ aliasName: fullPotentialAccountAliases.aliasName }).from(fullPotentialAccountAliases).where(eq(fullPotentialAccountAliases.accountId, (existing?.id ?? accountId)!));
        aliasRows.forEach(aliasRow => existingAliasSet.add(normalizeAlias(aliasRow.aliasName)));
      }
      for (const alias of uniqueAliases) {
        const normalized = normalizeAlias(alias);
        if (existingAliasSet.has(normalized)) {
          summary.aliasesSkippedDuplicate++;
          continue;
        }
        summary.aliasesCreated++;
        existingAliasSet.add(normalized);
        if (!dryRun && accountId) await db.insert(fullPotentialAccountAliases).values({ accountId, aliasName: alias, aliasType: "other", source: "full_potential_import", confidenceLevel: "unknown" });
      }
    }
    summary.rowsProcessed++;
  }
  if (summary.rowsProcessed === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No usable Full Potential rows found in the selected sheet", cause: summary });
  if (!dryRun) {
    await db.insert(fullPotentialImports).values({
      workbookVersion: input.sourceWorkbookVersion ?? "unknown",
      sourceFileName: input.fileName,
      importedBy: user.id,
      importedByName: user.name || user.email || String(user.id),
      rowCount: summary.rowsProcessed,
      createdCount: summary.createdAccounts,
      updatedCount: summary.updatedAccounts,
      skippedCount: summary.skippedRows,
      errorCount: summary.errorCount,
      importSummary: summary as unknown as Record<string, unknown>,
    });
  }
  return summary;
}

export const fullPotentialRouter = router({
  import: adminProcedure.input(importInputSchema).mutation(async ({ ctx, input }) => importFullPotential(input, ctx.user)),

  importSignals: adminProcedure.input(importSignalsInputSchema).mutation(async ({ ctx, input }) => importSignals(input, ctx.user)),

  list: protectedProcedure.input(listInputSchema).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const allAccounts = await db.select().from(fullPotentialAccounts);
    const filtered = allAccounts.filter(account =>
      accountMatchesSearch(account, input.search)
      && matchesFilter(account.fpStatus, input.fpStatus)
      && matchesFilter(account.platformPushDecision, input.platformPushDecision)
      && matchesFilter(account.routeToMarket, input.routeToMarket)
      && matchesFilter(account.ownerName, input.ownerName)
      && matchesFilter(account.segment, input.segment)
      && matchesFilter(account.state, input.state)
      && matchesFilter(account.priorityTier, input.priorityTier)
      && matchesFilter(account.rowClass, input.rowClass)
    );
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const page = filtered.sort((a, b) => {
      const tierOrder: Record<string, number> = { tier_a: 0, tier_b: 1, tier_c: 2, tier_d: 3, unassigned: 4 };
      const aTier = tierOrder[a.priorityTier ?? "unassigned"] ?? 4;
      const bTier = tierOrder[b.priorityTier ?? "unassigned"] ?? 4;
      if (aTier !== bTier) return aTier - bTier;
      return String(a.canonicalName).localeCompare(String(b.canonicalName));
    }).slice(offset, offset + limit).map(toClientAccount);
    return { accounts: page, total: filtered.length, limit, offset };
  }),

  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const accounts = await db.select().from(fullPotentialAccounts);
    const byFpStatus: Record<string, number> = {};
    const byPlatformPushDecision: Record<string, number> = {};
    const byRouteToMarket: Record<string, number> = {};
    const byPriorityTier: Record<string, number> = {};
    const byRowClass: Record<string, number> = {};
    let totalFullPotentialAud = 0;
    let totalTarget2026Aud = 0;
    let totalRemainingPotentialAud = 0;
    for (const account of accounts) {
      addCount(byFpStatus, account.fpStatus);
      addCount(byPlatformPushDecision, account.platformPushDecision);
      addCount(byRouteToMarket, account.routeToMarket);
      addCount(byPriorityTier, account.priorityTier);
      addCount(byRowClass, account.rowClass);
      totalFullPotentialAud += numberValue(account.fullPotentialAud);
      totalTarget2026Aud += numberValue(account.target2026Aud);
      totalRemainingPotentialAud += numberValue(account.remainingPotentialAud);
    }
    return { totalAccounts: accounts.length, byFpStatus, byPlatformPushDecision, byRouteToMarket, byPriorityTier, byRowClass, totalFullPotentialAud, totalTarget2026Aud, totalRemainingPotentialAud };
  }),

  filterOptions: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const accounts = await db.select().from(fullPotentialAccounts);
    return {
      fpStatuses: uniqueSorted(accounts.map(account => account.fpStatus)),
      platformPushDecisions: uniqueSorted(accounts.map(account => account.platformPushDecision)),
      routeToMarkets: uniqueSorted(accounts.map(account => account.routeToMarket)),
      ownerNames: uniqueSorted(accounts.map(account => account.ownerName)),
      segments: uniqueSorted(accounts.map(account => account.segment)),
      states: uniqueSorted(accounts.map(account => account.state)),
      priorityTiers: uniqueSorted(accounts.map(account => account.priorityTier)),
      rowClasses: uniqueSorted(accounts.map(account => account.rowClass)),
    };
  }),

  importHistory: protectedProcedure.input(importHistoryInputSchema.optional().default({ limit: 10 })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    return db.select().from(fullPotentialImports).orderBy(desc(fullPotentialImports.importedAt)).limit(input.limit ?? 10);
  }),

  actionsForAccount: protectedProcedure.input(z.object({ accountId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const actions = await db.select().from(fullPotentialActions).where(eq(fullPotentialActions.accountId, input.accountId)).orderBy(desc(fullPotentialActions.createdAt));
    return actions.map(toClientAction);
  }),

  createAction: protectedProcedure.input(createActionInputSchema).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [account] = await db.select({ id: fullPotentialAccounts.id }).from(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, input.accountId)).limit(1);
    if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Full Potential account not found" });
    const ownerName = ctx.user.name || ctx.user.email || String(ctx.user.id);
    const dueDate = parseOptionalDate(input.dueDate);
    await db.insert(fullPotentialActions).values({
      accountId: input.accountId,
      userId: ctx.user.id,
      ownerName,
      actionType: input.actionType,
      recommendedAction: input.recommendedAction,
      dueDate,
      status: "not_started",
      notes: input.notes ?? null,
    } as any);
    const [created] = await db.select().from(fullPotentialActions).where(eq(fullPotentialActions.accountId, input.accountId)).orderBy(desc(fullPotentialActions.createdAt)).limit(1);
    return created ? toClientAction(created) : { success: true };
  }),

  updateActionStatus: protectedProcedure.input(updateActionStatusInputSchema).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [existing] = await db.select().from(fullPotentialActions).where(eq(fullPotentialActions.id, input.actionId)).limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Full Potential action not found" });
    const isClosed = ["completed", "won", "lost", "not_relevant", "deferred"].includes(input.status);
    await db.update(fullPotentialActions).set({
      status: input.status,
      notes: input.notes ?? existing.notes,
      completedAt: isClosed ? new Date() : null,
    } as any).where(eq(fullPotentialActions.id, input.actionId));
    const [updated] = await db.select().from(fullPotentialActions).where(eq(fullPotentialActions.id, input.actionId)).limit(1);
    return updated ? toClientAction(updated) : { success: true };
  }),

  updateAccountFields: adminProcedure.input(z.object({
    accountId: z.number().int().positive(),
    // Allowed editable fields — financial, stableKey, canonicalName, rowClass and C4C fields are intentionally excluded
    ownerName: z.string().max(256).nullable().optional(),
    channelOwner: z.string().max(256).nullable().optional(),
    fpStatus: z.enum(["active_target", "develop", "watch", "qualify", "park", "exclude"]).nullable().optional(),
    priorityTier: z.enum(["tier_a", "tier_b", "tier_c", "tier_d", "unassigned"]).nullable().optional(),
    platformPushDecision: z.enum(["push_now", "push_context", "channel_view", "qualify_first", "park_do_not_push"]).nullable().optional(),
    installedBaseStatus: z.enum(["known", "partial", "unknown", "not_applicable"]).nullable().optional(),
    installedBaseNotes: z.string().max(4000).nullable().optional(),
    currentSupplier: z.string().max(256).nullable().optional(),
    nextAction: z.string().max(512).nullable().optional(),
    nextActionDate: z.string().max(64).nullable().optional(),
    // Optionally mark a related manager_review action as completed
    resolveActionId: z.number().int().positive().nullable().optional(),
  })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [existing] = await db.select().from(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, input.accountId)).limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Full Potential account not found" });

    // Build the update payload — only include fields that were explicitly provided
    const patch: Record<string, unknown> = {};
    if (input.ownerName !== undefined) patch.ownerName = input.ownerName ?? null;
    if (input.channelOwner !== undefined) patch.channelOwner = input.channelOwner ?? null;
    if (input.fpStatus !== undefined) patch.fpStatus = input.fpStatus ?? existing.fpStatus;
    if (input.priorityTier !== undefined) patch.priorityTier = input.priorityTier ?? existing.priorityTier;
    if (input.platformPushDecision !== undefined) patch.platformPushDecision = input.platformPushDecision ?? existing.platformPushDecision;
    if (input.installedBaseStatus !== undefined) patch.installedBaseStatus = input.installedBaseStatus ?? existing.installedBaseStatus;
    if (input.installedBaseNotes !== undefined) patch.installedBaseNotes = input.installedBaseNotes ?? null;
    if (input.currentSupplier !== undefined) patch.currentSupplier = input.currentSupplier ?? null;
    if (input.nextAction !== undefined) patch.nextAction = input.nextAction ?? null;
    if (input.nextActionDate !== undefined) patch.nextActionDate = parseOptionalDate(input.nextActionDate);

    if (Object.keys(patch).length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No allowed fields provided to update" });

    await db.update(fullPotentialAccounts).set(patch as any).where(eq(fullPotentialAccounts.id, input.accountId));

    // Optionally mark the related manager_review action as completed
    if (input.resolveActionId) {
      const [actionRow] = await db.select().from(fullPotentialActions).where(eq(fullPotentialActions.id, input.resolveActionId)).limit(1);
      if (actionRow) {
        await db.update(fullPotentialActions).set({
          status: "completed",
          completedAt: new Date(),
        } as any).where(eq(fullPotentialActions.id, input.resolveActionId));
      }
    }

    const [updated] = await db.select().from(fullPotentialAccounts).where(eq(fullPotentialAccounts.id, input.accountId)).limit(1);
    return updated ? toClientAccount(updated) : { success: true };
  }),

  matchedSignalsForAccount: protectedProcedure
    .input(z.object({ accountId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // ── 1. Load account + aliases ──────────────────────────────────────────
      const [account] = await db
        .select()
        .from(fullPotentialAccounts)
        .where(eq(fullPotentialAccounts.id, input.accountId))
        .limit(1);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });

      const aliasRows = await db
        .select({ aliasName: fullPotentialAccountAliases.aliasName })
        .from(fullPotentialAccountAliases)
        .where(eq(fullPotentialAccountAliases.accountId, input.accountId));

      // ── 2. Build normalised match terms ────────────────────────────────────
      // Strip common corporate suffixes before comparing to reduce false positives.
      const SUFFIX_STRIP = /\b(pty\s+ltd|pty|ltd|limited|group|australia|aust|holdings|holding|inc|corp|corporation|co)\b/gi;
      function normName(raw: unknown): string {
        return normalizeToken(raw).replace(SUFFIX_STRIP, "").replace(/\s+/g, " ").trim();
      }

      const primaryTerms = [
        account.canonicalName,
        account.displayName,
        account.parentGroup,
      ]
        .filter((v): v is string => !!v && v.length > 2)
        .map(normName)
        .filter(Boolean);

      const aliasTerms = aliasRows
        .map(r => normName(r.aliasName))
        .filter(Boolean);

      const allTerms = Array.from(new Set([...primaryTerms, ...aliasTerms])).filter(t => t.length >= 3);
      if (allTerms.length === 0) return { account: { id: account.id, canonicalName: account.canonicalName }, matches: [] };

      // ── 3. Confidence scoring helpers ─────────────────────────────────────
      type Confidence = "high" | "medium" | "low";

      function scoreMatch(
        targetNorm: string,
        accountState: string | null | undefined,
        signalState: string | null | undefined,
      ): { confidence: Confidence; matchReason: string } | null {
        if (!targetNorm) return null;
        // High: exact normalised match against a primary or alias term
        if (primaryTerms.some(t => t === targetNorm) || aliasTerms.some(t => t === targetNorm)) {
          return { confidence: "high", matchReason: "Exact name match" };
        }
        // Medium: contained match + same state
        const stateMatch = accountState && signalState &&
          normalizeToken(accountState) === normalizeToken(signalState);
        const containedByPrimary = primaryTerms.some(t => t.includes(targetNorm) || targetNorm.includes(t));
        const containedByAlias = aliasTerms.some(t => t.includes(targetNorm) || targetNorm.includes(t));
        if ((containedByPrimary || containedByAlias) && stateMatch) {
          return { confidence: "medium", matchReason: "Name contained + same state" };
        }
        // Low: weak contained match only
        if (containedByPrimary || containedByAlias) {
          return { confidence: "low", matchReason: "Partial name match" };
        }
        return null;
      }

      const OPEN_STATUSES = new Set(["not_started", "in_progress", "contacted", "meeting_booked", "quoted"]);
      const CLOSED_STATUSES = new Set(["completed", "won", "lost", "deferred", "not_relevant"]);

      type ActionState = {
        hasOpenAction: boolean;
        hasClosedAction: boolean;
        openActionId?: number;
        openActionStatus?: string;
        openActionDueDate?: string | null;
        closedActionId?: number;
        closedActionStatus?: string;
        closedActionCompletedAt?: string | null;
      };

      type MatchedSignalBase = {
        sourceType: string;
        sourceId: number;
        title: string;
        summary: string | null;
        sourceName: string | null;
        sourceUrl: string | null;
        signalDate: string | null;
        state: string | null;
        confidence: Confidence;
        matchReason: string;
        suggestedAction: string | null;
      };

      type MatchedSignal = MatchedSignalBase & { actionState: ActionState };

      const matches: MatchedSignalBase[] = [];

      // ── 4a. Direct fullPotentialSignals (accountId already linked) ─────────
      const directSignals = await db
        .select()
        .from(fullPotentialSignals)
        .where(eq(fullPotentialSignals.accountId, input.accountId))
        .orderBy(desc(fullPotentialSignals.signalDate));

      for (const sig of directSignals) {
        const conf = (sig.confidenceLevel === "high" || sig.confidenceLevel === "medium" || sig.confidenceLevel === "low")
          ? (sig.confidenceLevel as Confidence)
          : "medium";
        matches.push({
          sourceType: "fp_signal",
          sourceId: sig.id,
          title: sig.signalTitle,
          summary: sig.signalSummary ?? null,
          sourceName: sig.sourceName ?? null,
          sourceUrl: sig.sourceUrl ?? null,
          signalDate: sig.signalDate ? new Date(sig.signalDate).toISOString() : null,
          state: sig.state ?? null,
          confidence: conf,
          matchReason: "Directly linked signal",
          suggestedAction: sig.suggestedAction ?? null,
        });
      }

      // ── 4b. Name-matched fullPotentialSignals (unlinked) ──────────────────
      const unlinkedSignals = await db
        .select()
        .from(fullPotentialSignals)
        .where(
          and(
            or(eq(fullPotentialSignals.accountId, -1), sql`${fullPotentialSignals.accountId} IS NULL`),
            or(
              ...allTerms.map(t =>
                sql`LOWER(${fullPotentialSignals.signalTitle}) LIKE ${`%${t}%`}`
              )
            )
          )
        )
        .orderBy(desc(fullPotentialSignals.signalDate))
        .limit(50);

      for (const sig of unlinkedSignals) {
        const titleNorm = normName(sig.signalTitle);
        const scored = scoreMatch(titleNorm, account.state, sig.state);
        if (!scored) continue;
        matches.push({
          sourceType: "fp_signal",
          sourceId: sig.id,
          title: sig.signalTitle,
          summary: sig.signalSummary ?? null,
          sourceName: sig.sourceName ?? null,
          sourceUrl: sig.sourceUrl ?? null,
          signalDate: sig.signalDate ? new Date(sig.signalDate).toISOString() : null,
          state: sig.state ?? null,
          confidence: scored.confidence,
          matchReason: scored.matchReason,
          suggestedAction: sig.suggestedAction ?? null,
        });
      }

      // ── 4c. Name-matched projects (cross-reference) ────────────────────────
      const matchedProjects = await db
        .select()
        .from(projects)
        .where(
          and(
            sql`${projects.suppressed} = 0`,
            or(
              ...allTerms.map(t =>
                sql`LOWER(${projects.owner}) LIKE ${`%${t}%`}`
              )
            )
          )
        )
        .orderBy(desc(projects.lastActivityAt))
        .limit(50);

      for (const proj of matchedProjects) {
        const ownerNorm = normName(proj.owner);
        const scored = scoreMatch(ownerNorm, account.state, proj.projectState);
        if (!scored) continue;
        // Derive a source URL from the first source entry if available
        const firstSource = Array.isArray(proj.sources) && proj.sources.length > 0 ? proj.sources[0] : null;
        const sourceUrl = firstSource ? (firstSource as any).url ?? null : null;
        const sourceName = firstSource ? (firstSource as any).label ?? null : null;
        const signalDate = proj.lastActivityAt ? new Date(proj.lastActivityAt).toISOString() : null;
        matches.push({
          sourceType: "project",
          sourceId: proj.id,
          title: proj.name,
          summary: proj.overview ?? null,
          sourceName,
          sourceUrl,
          signalDate,
          state: proj.projectState ?? null,
          confidence: scored.confidence,
          matchReason: `${scored.matchReason} (project owner: ${proj.owner})`,
          suggestedAction: null,
        });
      }

      // ── 4d. Attach empty actionState placeholder (will be filled in step 6) ──
      const matchesWithState = matches.map(m => ({
        ...m,
        actionState: {
          hasOpenAction: false,
          hasClosedAction: false,
        } as ActionState,
      }));

      // ── 5. De-duplicate, sort, cap ─────────────────────────────────────────
      const seen = new Set<string>();
      const deduped = matchesWithState.filter(m => {
        const key = `${m.sourceType}:${m.sourceId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const CONF_ORDER: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
      deduped.sort((a, b) => {
        const cDiff = CONF_ORDER[a.confidence] - CONF_ORDER[b.confidence];
        if (cDiff !== 0) return cDiff;
        const aDate = a.signalDate ? new Date(a.signalDate).getTime() : 0;
        const bDate = b.signalDate ? new Date(b.signalDate).getTime() : 0;
        return bDate - aDate;
      });

      const capped = deduped.slice(0, 10);

      // ── 6. Bulk-load action state for capped matches ───────────────────────
      const signalIds = capped.filter(m => m.sourceType === "fp_signal").map(m => m.sourceId);
      const projectIds = capped.filter(m => m.sourceType === "project").map(m => m.sourceId);

      if (signalIds.length > 0 || projectIds.length > 0) {
        const actionConditions = [];
        if (signalIds.length > 0) {
          actionConditions.push(
            and(
              eq(fullPotentialActions.accountId, input.accountId),
              inArray(fullPotentialActions.signalId, signalIds)
            )
          );
        }
        if (projectIds.length > 0) {
          actionConditions.push(
            and(
              eq(fullPotentialActions.accountId, input.accountId),
              inArray(fullPotentialActions.projectId, projectIds)
            )
          );
        }

        const relatedActions = await db
          .select({
            id: fullPotentialActions.id,
            status: fullPotentialActions.status,
            signalId: fullPotentialActions.signalId,
            projectId: fullPotentialActions.projectId,
            dueDate: fullPotentialActions.dueDate,
            completedAt: fullPotentialActions.completedAt,
            createdAt: fullPotentialActions.createdAt,
          })
          .from(fullPotentialActions)
          .where(or(...actionConditions))
          .orderBy(desc(fullPotentialActions.createdAt));

        for (const match of capped) {
          const matchActions = relatedActions.filter(a =>
            match.sourceType === "fp_signal"
              ? a.signalId === match.sourceId
              : a.projectId === match.sourceId
          );

          const openAction = matchActions.find(a => OPEN_STATUSES.has(a.status ?? ""));
          const closedAction = matchActions.find(a => CLOSED_STATUSES.has(a.status ?? ""));

          match.actionState = {
            hasOpenAction: !!openAction,
            hasClosedAction: !!closedAction,
            openActionId: openAction?.id,
            openActionStatus: openAction?.status ?? undefined,
            openActionDueDate: openAction?.dueDate ? new Date(openAction.dueDate).toISOString() : null,
            closedActionId: closedAction?.id,
            closedActionStatus: closedAction?.status ?? undefined,
            closedActionCompletedAt: closedAction?.completedAt ? new Date(closedAction.completedAt).toISOString() : null,
          };
        }
      }

      return {
        account: {
          id: account.id,
          canonicalName: account.canonicalName,
          displayName: account.displayName,
          state: account.state,
        },
        matches: capped,
      };
    }),

  /**
   * Promote a matched signal or project cross-reference into a Full Potential action.
   * Creates a fullPotentialAction with signalId or projectId set.
   *
   * Guards:
   * - Source must be genuinely matched to the account (direct link OR name/state match).
   * - Duplicate open action blocks; closed duplicate does not block.
   */
  promoteMatchedSignalToAction: protectedProcedure
    .input(z.object({
      accountId: z.number().int().positive(),
      sourceType: z.enum(["fp_signal", "project"]),
      sourceId: z.number().int().positive(),
      actionType: z.enum(actionTypeValues).optional().default("account_review"),
      recommendedAction: z.string().max(512).optional(),
      dueDate: z.string().optional().nullable(),
      notes: z.string().max(4000).optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // ── 1. Load account + aliases (needed for match validation) ────────────
      const [account] = await db
        .select()
        .from(fullPotentialAccounts)
        .where(eq(fullPotentialAccounts.id, input.accountId))
        .limit(1);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Full Potential account not found" });

      const aliasRows = await db
        .select({ aliasName: fullPotentialAccountAliases.aliasName })
        .from(fullPotentialAccountAliases)
        .where(eq(fullPotentialAccountAliases.accountId, input.accountId));

      // ── 2. Shared name-matching helpers (mirrors matchedSignalsForAccount) ──
      const SUFFIX_STRIP_PROMOTE = /\b(pty\s+ltd|pty|ltd|limited|group|australia|aust|holdings|holding|inc|corp|corporation|co)\b/gi;
      function normNamePromote(raw: unknown): string {
        return normalizeToken(raw).replace(SUFFIX_STRIP_PROMOTE, "").replace(/\s+/g, " ").trim();
      }
      const primaryTerms = [
        account.canonicalName,
        account.displayName,
        account.parentGroup,
      ]
        .filter((v): v is string => !!v && v.length > 2)
        .map(normNamePromote)
        .filter(Boolean);
      const aliasTerms = aliasRows.map(r => normNamePromote(r.aliasName)).filter(Boolean);
      const allTerms = Array.from(new Set([...primaryTerms, ...aliasTerms])).filter(t => t.length >= 3);

      function isNameMatched(targetNorm: string, targetState: string | null | undefined): boolean {
        if (!targetNorm) return false;
        const exact = primaryTerms.some(t => t === targetNorm) || aliasTerms.some(t => t === targetNorm);
        if (exact) return true;
        const stateMatch = account.state && targetState &&
          normalizeToken(account.state) === normalizeToken(targetState);
        const contained = primaryTerms.some(t => t.includes(targetNorm) || targetNorm.includes(t)) ||
          aliasTerms.some(t => t.includes(targetNorm) || targetNorm.includes(t));
        return contained && !!stateMatch;
      }

      // ── 3. Validate source and build notes ─────────────────────────────────
      let signalId: number | null = null;
      let projectId: number | null = null;
      let autoNotes = "";
      let derivedRecommendedAction = "";

      if (input.sourceType === "fp_signal") {
        const [sig] = await db
          .select()
          .from(fullPotentialSignals)
          .where(eq(fullPotentialSignals.id, input.sourceId))
          .limit(1);
        if (!sig) throw new TRPCError({ code: "NOT_FOUND", message: "Signal not found" });

        // Source-match guard: must be directly linked OR name/state matched
        const directlyLinked = sig.accountId === input.accountId;
        const unlinked = sig.accountId === null || sig.accountId === undefined;
        if (!directlyLinked) {
          if (!unlinked) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Matched signal is not associated with this account." });
          }
          // Unlinked: must pass name/state matching
          const titleNorm = normNamePromote(sig.signalTitle);
          if (allTerms.length === 0 || !isNameMatched(titleNorm, sig.state)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Matched signal is not associated with this account." });
          }
        }

        signalId = sig.id;
        derivedRecommendedAction =
          input.recommendedAction ||
          sig.suggestedAction ||
          `Follow up matched signal: ${sig.signalTitle}`;

        autoNotes = [
          `Created from matched signal`,
          `Signal: ${sig.signalTitle}`,
          sig.confidenceLevel ? `Confidence: ${sig.confidenceLevel}` : null,
          sig.sourceName ? `Source: ${sig.sourceName}` : null,
          sig.sourceUrl ? `URL: ${sig.sourceUrl}` : null,
          sig.suggestedAction ? `Suggested: ${sig.suggestedAction}` : null,
          sig.signalSummary ? `\n${sig.signalSummary}` : null,
        ].filter(Boolean).join(" | ");
      } else {
        const [proj] = await db
          .select()
          .from(projects)
          .where(eq(projects.id, input.sourceId))
          .limit(1);
        if (!proj) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

        // Source-match guard: project owner must pass name/state matching
        const ownerNorm = normNamePromote(proj.owner);
        if (allTerms.length === 0 || !isNameMatched(ownerNorm, proj.projectState)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Matched signal is not associated with this account." });
        }

        projectId = proj.id;
        derivedRecommendedAction =
          input.recommendedAction ||
          `Review matched project signal: ${proj.name}`;

        const firstSource = Array.isArray(proj.sources) && proj.sources.length > 0 ? proj.sources[0] : null;
        const sourceUrl = firstSource ? (firstSource as any).url ?? null : null;
        autoNotes = [
          `Created from matched project signal`,
          `Project: ${proj.name}`,
          proj.owner ? `Owner: ${proj.owner}` : null,
          proj.projectState ? `State: ${proj.projectState}` : null,
          sourceUrl ? `URL: ${sourceUrl}` : null,
          proj.overview ? `\n${proj.overview}` : null,
        ].filter(Boolean).join(" | ");
      }

      // ── 4. Duplicate guard (open only — closed does not block) ─────────────
      const existingActions = await db
        .select({ id: fullPotentialActions.id, status: fullPotentialActions.status, signalId: fullPotentialActions.signalId, projectId: fullPotentialActions.projectId })
        .from(fullPotentialActions)
        .where(eq(fullPotentialActions.accountId, input.accountId));

      const hasDuplicate = existingActions.some(a => {
        if (!openActionStatuses.has(a.status ?? "")) return false;
        if (signalId !== null && a.signalId === signalId) return true;
        if (projectId !== null && a.projectId === projectId) return true;
        return false;
      });
      if (hasDuplicate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An open action already exists for this account and signal/project",
        });
      }

      // ── 5. Create action ───────────────────────────────────────────────────
      const ownerName = ctx.user.name || ctx.user.email || String(ctx.user.id);
      const dueDate = parseOptionalDate(input.dueDate ?? undefined);
      const combinedNotes = [autoNotes, input.notes].filter(Boolean).join("\n\n");

      await db.insert(fullPotentialActions).values({
        accountId: input.accountId,
        userId: ctx.user.id,
        ownerName,
        actionType: input.actionType,
        recommendedAction: derivedRecommendedAction,
        dueDate,
        status: "not_started",
        notes: combinedNotes || null,
        signalId: signalId ?? undefined,
        projectId: projectId ?? undefined,
      } as any);

      // Deterministic fetch: match by accountId + signalId/projectId, newest first
      const whereClause = signalId !== null
        ? and(eq(fullPotentialActions.accountId, input.accountId), eq(fullPotentialActions.signalId, signalId))
        : and(eq(fullPotentialActions.accountId, input.accountId), eq(fullPotentialActions.projectId, projectId!));

      const [created] = await db
        .select()
        .from(fullPotentialActions)
        .where(whereClause)
        .orderBy(desc(fullPotentialActions.createdAt))
        .limit(1);
      return created ? toClientAction(created) : { success: true };
    }),

  myWeekActions: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const actions = await db.select().from(fullPotentialActions).orderBy(desc(fullPotentialActions.createdAt));
    const accounts = await db.select().from(fullPotentialAccounts);
    const accountById = new Map(accounts.map(account => [account.id, account]));
    const today = startOfDay(new Date());
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const openActions = actions
      .filter(action => openActionStatuses.has(String(action.status)))
      .map(action => {
        const account = accountById.get(action.accountId);
        return account ? toClientActionWithAccount(action, account) : null;
      })
      .filter((action): action is NonNullable<typeof action> => !!action && !!action.dueDate);
    const overdueActions = openActions
      .filter(action => startOfDay(new Date(action.dueDate)) < today)
      .sort(sortByDueDateAsc);
    const dueActions = openActions
      .filter(action => {
        const due = startOfDay(new Date(action.dueDate));
        return due >= today && due <= nextWeek;
      })
      .sort(sortByDueDateAsc);
    const upcomingActions = openActions
      .filter(action => startOfDay(new Date(action.dueDate)) > nextWeek)
      .sort(sortByDueDateAsc)
      .slice(0, 10);
    return {
      overdueActions,
      dueActions,
      upcomingActions,
      stats: {
        overdue: overdueActions.length,
        dueThisWeek: dueActions.length,
        upcoming: upcomingActions.length,
      },
    };
  }),
});

export type FullPotentialImportSummary = ImportSummary;
