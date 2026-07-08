import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  fullPotentialAccounts,
  fullPotentialAccountAliases,
  fullPotentialImports,
} from "../../drizzle/schema";

const PREFERRED_SHEETS = [
  "Platform Import v2.4",
  "Platform Import",
  "Canonical Universe v2.4",
];

const MAX_ROW_ERRORS = 100;

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

const inputSchema = z.object({
  fileName: z.string().min(1).max(512),
  fileBase64: z.string().min(1),
  sheetName: z.string().min(1).max(128).optional(),
  dryRun: z.boolean().optional().default(true),
  sourceWorkbookVersion: z.string().max(32).optional(),
  clearBlankValues: z.boolean().optional().default(false),
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
  const cleaned = String(value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

function normalizeHeader(value: unknown): string {
  return (cleanString(value) ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeToken(value: unknown): string {
  return (cleanString(value) ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const parts = raw
    .split(/[;,|]/g)
    .map(p => cleanString(p))
    .filter((p): p is string => !!p);
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

  // Handle Excel serial date numbers (e.g. 46287 = 2026-09-01)
  // Excel epoch: 1899-12-30 (with Lotus 1-2-3 leap-year bug)
  const asNumber = Number(raw.replace(/[^0-9.]/g, ""));
  if (/^\d{4,6}$/.test(raw.trim()) && asNumber >= 1 && asNumber <= 99999) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const msPerDay = 86400000;
    const excelDate = new Date(excelEpoch.getTime() + asNumber * msPerDay);
    if (!Number.isNaN(excelDate.getTime())) return excelDate;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
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
  return [
    normalizeKeyPart(row.canonicalName),
    normalizeKeyPart(row.rowClass),
    normalizeKeyPart(row.country),
    normalizeKeyPart(row.state),
    normalizeKeyPart(row.routeToMarket),
  ].join("|");
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
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls") && !lower.endsWith(".csv")) {
    throw new Error("Unsupported file type. Use .xlsx, .xls or .csv");
  }

  const cleanBase64 = fileBase64.replace(/^data:.*?;base64,/, "");
  const buffer = Buffer.from(cleanBase64, "base64");
  if (!buffer.length) throw new Error("Uploaded file is empty");

  if (lower.endsWith(".csv")) {
    return XLSX.read(buffer.toString("utf8"), { type: "string" });
  }
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

function parseAccountRow(
  row: unknown[],
  headers: unknown[],
  headerMap: Map<FieldKey, number>,
  rowNumber: number,
  selectedSheet: string,
): { parsed?: ParsedAccountRow; error?: ImportRowError; blank?: boolean } {
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

async function importFullPotential(input: z.infer<typeof inputSchema>, user: { id: number; name?: string | null; email?: string | null }): Promise<ImportSummary> {
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
    const [existing] = await db
      .select()
      .from(fullPotentialAccounts)
      .where(eq(fullPotentialAccounts.stableKey, parsed.stableKey))
      .limit(1);

    const accountValues = buildAccountValues(parsed, input.sourceWorkbookVersion);
    const writeValues = clearBlankValues ? clearUndefinedValues(accountValues) : removeUndefinedValues(accountValues);

    let accountId = existing?.id;
    if (existing) {
      summary.updatedAccounts++;
      if (!dryRun) {
        await db
          .update(fullPotentialAccounts)
          .set(writeValues)
          .where(eq(fullPotentialAccounts.id, existing.id));
      }
    } else {
      summary.createdAccounts++;
      if (!dryRun) {
        await db.insert(fullPotentialAccounts).values(removeUndefinedValues(accountValues) as any);
        const [created] = await db
          .select({ id: fullPotentialAccounts.id })
          .from(fullPotentialAccounts)
          .where(eq(fullPotentialAccounts.stableKey, parsed.stableKey))
          .limit(1);
        accountId = created?.id;
      }
    }

    const uniqueAliases = Array.from(new Map(parsed.aliases.map(alias => [normalizeAlias(alias), alias])).values())
      .filter(alias => normalizeAlias(alias) && normalizeAlias(alias) !== normalizeAlias(parsed.canonicalName));

    if (uniqueAliases.length > 0) {
      const existingAliasSet = new Set<string>();
      if (existing?.id || accountId) {
        const aliasRows = await db
          .select({ aliasName: fullPotentialAccountAliases.aliasName })
          .from(fullPotentialAccountAliases)
          .where(eq(fullPotentialAccountAliases.accountId, (existing?.id ?? accountId)!));
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
        if (!dryRun && accountId) {
          await db.insert(fullPotentialAccountAliases).values({
            accountId,
            aliasName: alias,
            aliasType: "other",
            source: "full_potential_import",
            confidenceLevel: "unknown",
          });
        }
      }
    }

    summary.rowsProcessed++;
  }

  if (summary.rowsProcessed === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No usable Full Potential rows found in the selected sheet",
      cause: summary,
    });
  }

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
  import: adminProcedure
    .input(inputSchema)
    .mutation(async ({ ctx, input }) => {
      return importFullPotential(input, ctx.user);
    }),
});

export type FullPotentialImportSummary = ImportSummary;
