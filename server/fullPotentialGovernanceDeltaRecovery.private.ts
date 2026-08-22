import { createHash } from "node:crypto";
import type {
  FullPotentialReconciliationAccount,
  FullPotentialReconciliationAlias,
} from "../shared/fullPotentialAccountReconciliation";
import type { FullPotentialLookalikeAccountSnapshot } from "./fullPotentialLookalikeIdentityReconciliation";
import {
  GOVERNANCE_AUDIT_FILES,
  type GovernanceAuditFile,
  type GovernanceDeltaRecoveryProfile,
} from "./fullPotentialGovernanceDeltaRecovery.profile";

const ACCOUNT_HEADER = [
  "id", "stableKey", "canonicalName", "displayName", "parentAccountId",
  "mergedIntoAccountId", "rowClass", "relationshipType", "recordStatus",
  "countsTowardPotential", "country", "routeToMarket", "ownerName",
  "channelOwner", "fpStatus", "priorityTier", "platformPushDecision",
  "c4cStatus", "sourceWorkbookVersion", "sourceSheet", "sourceRowNumber",
  "financialValuesState",
] as const;
const ALIAS_HEADER = ["accountId", "aliasName", "aliasType", "source", "confidenceLevel"] as const;
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const ROW_CLASSES = new Set(["account", "site_context", "channel_managed", "competitor_watch", "cluster_signal"]);
const RECORD_STATUSES = new Set(["active", "under_review", "merged", "parked", "excluded"]);

type CsvRow = Record<string, string>;
export interface AuditAccount {
  id: number;
  stableKey: string;
  canonicalName: string;
  displayName: string | null;
  parentAccountId: number | null;
  mergedIntoAccountId: number | null;
  rowClass: FullPotentialReconciliationAccount["rowClass"];
  relationshipType: string | null;
  recordStatus: FullPotentialReconciliationAccount["recordStatus"];
  countsTowardPotential: boolean;
  country: string;
  routeToMarket: string;
}
export interface AuditAlias {
  accountId: number;
  aliasName: string;
  aliasType: string | null;
  confidenceLevel: string | null;
}

export interface VerifiedRecoveryEvidence {
  base: FullPotentialLookalikeAccountSnapshot;
  baseSnapshotRawSha256: string;
  baseSnapshotCanonicalSha256: string;
  artifactSha256: Record<GovernanceAuditFile, string>;
  accountsBefore: AuditAccount[];
  accountsAfter: AuditAccount[];
  aliasesBefore: AuditAlias[];
  aliasesAfter: AuditAlias[];
}

function text(value: string | Buffer): string {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}
function rawHash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
}
export function canonicalGovernanceJsonSha256(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function objectJson(value: string | Buffer, label: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(text(value)); } catch { throw new Error(`${label}_JSON_INVALID`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label}_OBJECT_REQUIRED`);
  return parsed as Record<string, unknown>;
}
function snapshotJson(value: string | Buffer): FullPotentialLookalikeAccountSnapshot {
  const parsed = objectJson(value, "RECOVERY_BASE_SNAPSHOT") as unknown as FullPotentialLookalikeAccountSnapshot;
  if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.aliases) || !parsed.snapshotRef || !parsed.capturedAt) {
    throw new Error("RECOVERY_BASE_SNAPSHOT_SHAPE_INVALID");
  }
  return parsed;
}
function csv(value: string | Buffer, label: string): { header: string[]; rows: CsvRow[] } {
  const input = text(value).replace(/^\uFEFF/, "");
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { if (field) throw new Error(`${label}_CSV_QUOTE_INVALID`); quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some(cell => cell.length > 0)) matrix.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (quoted) throw new Error(`${label}_CSV_UNCLOSED_QUOTE`);
  row.push(field);
  if (row.some(cell => cell.length > 0)) matrix.push(row);
  if (matrix.length === 0) throw new Error(`${label}_CSV_EMPTY`);
  const header = matrix[0].map(cell => cell.trim());
  if (new Set(header).size !== header.length) throw new Error(`${label}_CSV_DUPLICATE_HEADER`);
  const rows = matrix.slice(1).map((cells, index) => {
    if (cells.length !== header.length) throw new Error(`${label}_CSV_WIDTH_INVALID:${index + 2}`);
    return Object.fromEntries(header.map((name, cellIndex) => [name, cells[cellIndex]]));
  });
  return { header, rows };
}
function exactHeader(actual: string[], expected: readonly string[], label: string): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label}_HEADER_MISMATCH`);
  }
}
function required(value: string | undefined, label: string): string {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label}_REQUIRED`);
  return result;
}
function optional(value: string | undefined): string | null {
  const result = String(value ?? "").trim();
  return result && result.toLowerCase() !== "null" ? result : null;
}
function positiveInt(value: string | undefined, label: string): number {
  const result = required(value, label);
  if (!/^[1-9]\d*$/.test(result)) throw new Error(`${label}_POSITIVE_INTEGER_REQUIRED`);
  const parsed = Number(result);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label}_SAFE_INTEGER_REQUIRED`);
  return parsed;
}
function optionalInt(value: string | undefined, label: string): number | null {
  const result = optional(value);
  return result === null ? null : positiveInt(result, label);
}
function bool(value: string | undefined, label: string): boolean {
  const result = required(value, label).toLowerCase();
  if (result === "true" || result === "1") return true;
  if (result === "false" || result === "0") return false;
  throw new Error(`${label}_BOOLEAN_REQUIRED`);
}
function auditAccount(row: CsvRow, index: number): AuditAccount {
  const rowClass = required(row.rowClass, `ACCOUNT_${index}_ROW_CLASS`);
  const recordStatus = required(row.recordStatus, `ACCOUNT_${index}_RECORD_STATUS`);
  if (!ROW_CLASSES.has(rowClass)) throw new Error(`ACCOUNT_${index}_ROW_CLASS_INVALID`);
  if (!RECORD_STATUSES.has(recordStatus)) throw new Error(`ACCOUNT_${index}_RECORD_STATUS_INVALID`);
  const country = required(row.country, `ACCOUNT_${index}_COUNTRY`).toUpperCase();
  if (country !== "AU") throw new Error(`ACCOUNT_${index}_COUNTRY_NOT_AU`);
  return {
    id: positiveInt(row.id, `ACCOUNT_${index}_ID`),
    stableKey: required(row.stableKey, `ACCOUNT_${index}_STABLE_KEY`),
    canonicalName: required(row.canonicalName, `ACCOUNT_${index}_CANONICAL_NAME`),
    displayName: optional(row.displayName),
    parentAccountId: optionalInt(row.parentAccountId, `ACCOUNT_${index}_PARENT_ID`),
    mergedIntoAccountId: optionalInt(row.mergedIntoAccountId, `ACCOUNT_${index}_MERGED_ID`),
    rowClass: rowClass as AuditAccount["rowClass"],
    relationshipType: optional(row.relationshipType),
    recordStatus: recordStatus as AuditAccount["recordStatus"],
    countsTowardPotential: bool(row.countsTowardPotential, `ACCOUNT_${index}_COUNTS`),
    country,
    routeToMarket: required(row.routeToMarket, `ACCOUNT_${index}_ROUTE`),
  };
}
function auditAlias(row: CsvRow, index: number): AuditAlias {
  return {
    accountId: positiveInt(row.accountId, `ALIAS_${index}_ACCOUNT_ID`),
    aliasName: required(row.aliasName, `ALIAS_${index}_NAME`),
    aliasType: optional(row.aliasType),
    confidenceLevel: optional(row.confidenceLevel),
  };
}
export function normalizeGovernanceIdentity(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/&/g, " and ")
    .replace(/\bpty\b|\bltd\b|\blimited\b|\baustralia\b|\baustralian\b/g, " ")
    .replace(/\bgroup\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function zeroLike(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === 0) return true;
  if (typeof value === "string") return ["", "0", "false", "none", "null"].includes(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.length === 0 || value.every(zeroLike);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).every(zeroLike);
  return false;
}
function trueLike(value: unknown): boolean { return value === true || value === 1 || String(value).trim().toLowerCase() === "true"; }
function exactString(row: Record<string, unknown>, key: string, expected: string, label: string): void {
  if (row[key] !== expected) throw new Error(`${label}_MISMATCH`);
}
function exactNumber(row: Record<string, unknown>, key: string, expected: number, label: string): void {
  if (Number(row[key]) !== expected) throw new Error(`${label}_MISMATCH`);
}
function expectZero(value: unknown, label: string): void { if (!zeroLike(value)) throw new Error(`${label}_NOT_ZERO`); }
function outputCount(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function verifyAudit(profile: GovernanceDeltaRecoveryProfile, artifacts: Record<GovernanceAuditFile, string | Buffer>): void {
  const audit = objectJson(artifacts["audit-manifest.json"], "RECOVERY_AUDIT_MANIFEST");
  exactString(audit, "sourceSha", profile.governanceSourceSha, "AUDIT_SOURCE_SHA");
  exactString(audit, "approvedPackageSha256", profile.approvedPackageSha256, "AUDIT_APPROVED_PACKAGE");
  exactString(audit, "beforeManifestSha256", profile.beforeManifestSha256, "AUDIT_BEFORE_MANIFEST");
  exactString(audit, "afterManifestSha256", profile.afterManifestSha256, "AUDIT_AFTER_MANIFEST");
  exactNumber(audit, "changedAccountBeforeRows", profile.counts.accountBeforeRows, "AUDIT_ACCOUNT_BEFORE_ROWS");
  exactNumber(audit, "changedAccountAfterRows", profile.counts.accountAfterRows, "AUDIT_ACCOUNT_AFTER_ROWS");
  exactNumber(audit, "changedAliasBeforeRows", profile.counts.aliasBeforeRows, "AUDIT_ALIAS_BEFORE_ROWS");
  exactNumber(audit, "changedAliasAfterRows", profile.counts.aliasAfterRows, "AUDIT_ALIAS_AFTER_ROWS");
  expectZero(audit.financialValuesChanged, "AUDIT_FINANCIAL_CHANGE");
  expectZero(audit.crmC4cMutations, "AUDIT_CRM_CHANGE");
  expectZero(audit.pipelineProviderActivity, "AUDIT_PIPELINE_PROVIDER_ACTIVITY");

  const apply = objectJson(artifacts["apply-summary.json"], "RECOVERY_APPLY_SUMMARY");
  exactString(apply, "sourceSha", profile.governanceSourceSha, "APPLY_SOURCE_SHA");
  exactString(apply, "approvedPackageSha", profile.approvedPackageSha256, "APPLY_APPROVED_PACKAGE");
  expectZero(apply.financialValuesChanged, "APPLY_FINANCIAL_CHANGE");
  expectZero(apply.financialMutationFields, "APPLY_FINANCIAL_FIELDS");
  expectZero(apply.crmC4cMutations, "APPLY_CRM_CHANGE");
  expectZero(apply.crmC4cMutationFields, "APPLY_CRM_FIELDS");
  expectZero(apply.pipelineProviderActivity, "APPLY_PIPELINE_PROVIDER_ACTIVITY");
  expectZero(apply.actionsModelsEvidenceSignalsCreated, "APPLY_ACTION_MODEL_SIGNAL_EVIDENCE");
  exactNumber(apply, "runningCount", 0, "APPLY_RUNNING_COUNT");
  const createdIds = outputCount(apply.createdIds);
  if (createdIds !== null && createdIds !== profile.counts.accountCreated) throw new Error("APPLY_CREATED_IDS_COUNT_MISMATCH");
  const aliasesCreated = outputCount(apply.aliasesCreated);
  if (aliasesCreated !== null && aliasesCreated !== profile.counts.aliasAdded) throw new Error("APPLY_ALIASES_CREATED_COUNT_MISMATCH");

  const after = objectJson(artifacts["after-state-summary.json"], "RECOVERY_AFTER_STATE");
  exactString(after, "beforeManifestSha256", profile.beforeManifestSha256, "AFTER_BEFORE_MANIFEST");
  exactString(after, "afterManifestSha256", profile.afterManifestSha256, "AFTER_AFTER_MANIFEST");
  exactNumber(after, "afterAccountCount", profile.counts.auditScopeAfterAccounts, "AFTER_ACCOUNT_COUNT");
  exactNumber(after, "createdAccountCount", profile.counts.accountCreated, "AFTER_CREATED_ACCOUNT_COUNT");
  exactNumber(after, "aliasCount", profile.counts.aliasAdded, "AFTER_ALIAS_COUNT");
  if (!trueLike(after.createdFinancialsNull) || !trueLike(after.createdGovernanceValid)
      || !trueLike(after.financeInvariantExisting) || !trueLike(after.zeroSideEffects)) {
    throw new Error("AFTER_STATE_INVARIANT_INVALID");
  }
  expectZero(after.sideEffects, "AFTER_SIDE_EFFECTS");

  const before = objectJson(artifacts["before-state.json"], "RECOVERY_BEFORE_STATE");
  if (!Array.isArray(before.accountIds) || before.accountIds.length !== profile.counts.auditScopeBeforeAccounts) {
    throw new Error("BEFORE_ACCOUNT_IDS_COUNT_MISMATCH");
  }
  if (!Array.isArray(before.accounts) || before.accounts.length !== profile.counts.auditScopeBeforeAccounts) {
    throw new Error("BEFORE_ACCOUNTS_COUNT_MISMATCH");
  }
  if (!Array.isArray(before.aliases) || before.aliases.length !== profile.counts.aliasBeforeRows) {
    throw new Error("BEFORE_ALIASES_COUNT_MISMATCH");
  }
}
function verifyProfile(profile: GovernanceDeltaRecoveryProfile): void {
  if (profile.version !== 1 || !SHA40.test(profile.governanceSourceSha)) throw new Error("RECOVERY_PROFILE_INVALID");
  for (const hash of [profile.baseSnapshotRawSha256, profile.approvedPackageSha256,
    profile.beforeManifestSha256, profile.afterManifestSha256, ...Object.values(profile.artifactSha256)]) {
    if (!SHA64.test(hash)) throw new Error("RECOVERY_PROFILE_HASH_INVALID");
  }
}
function count(actual: number, expected: number, label: string): void {
  if (actual !== expected) throw new Error(`${label}_COUNT_MISMATCH`);
}

export function verifyRecoveryEvidence(
  profile: GovernanceDeltaRecoveryProfile,
  baseSnapshotRaw: string | Buffer,
  artifacts: Record<GovernanceAuditFile, string | Buffer>,
): VerifiedRecoveryEvidence {
  verifyProfile(profile);
  const baseSnapshotRawSha256 = rawHash(baseSnapshotRaw);
  if (baseSnapshotRawSha256 !== profile.baseSnapshotRawSha256) throw new Error("RECOVERY_BASE_RAW_HASH_MISMATCH");
  const artifactSha256 = Object.fromEntries(
    GOVERNANCE_AUDIT_FILES.map(name => [name, rawHash(artifacts[name])]),
  ) as Record<GovernanceAuditFile, string>;
  for (const name of GOVERNANCE_AUDIT_FILES) {
    if (artifactSha256[name] !== profile.artifactSha256[name]) throw new Error(`RECOVERY_${name}_HASH_MISMATCH`);
  }
  verifyAudit(profile, artifacts);

  const base = snapshotJson(baseSnapshotRaw);
  count(base.accounts.length, profile.counts.baseAccounts, "BASE_ACCOUNTS");
  count(base.aliases.length, profile.counts.baseAliases, "BASE_ALIASES");

  const accountsBeforeCsv = csv(artifacts["changed-accounts-before.csv"], "ACCOUNTS_BEFORE");
  const accountsAfterCsv = csv(artifacts["changed-accounts-after.csv"], "ACCOUNTS_AFTER");
  const aliasesBeforeCsv = csv(artifacts["changed-aliases-before.csv"], "ALIASES_BEFORE");
  const aliasesAfterCsv = csv(artifacts["changed-aliases-after.csv"], "ALIASES_AFTER");
  exactHeader(accountsBeforeCsv.header, ACCOUNT_HEADER, "ACCOUNTS_BEFORE");
  exactHeader(accountsAfterCsv.header, ACCOUNT_HEADER, "ACCOUNTS_AFTER");
  exactHeader(aliasesBeforeCsv.header, ALIAS_HEADER, "ALIASES_BEFORE");
  exactHeader(aliasesAfterCsv.header, ALIAS_HEADER, "ALIASES_AFTER");
  count(accountsBeforeCsv.rows.length, profile.counts.accountBeforeRows, "ACCOUNT_BEFORE_ROWS");
  count(accountsAfterCsv.rows.length, profile.counts.accountAfterRows, "ACCOUNT_AFTER_ROWS");
  count(aliasesBeforeCsv.rows.length, profile.counts.aliasBeforeRows, "ALIAS_BEFORE_ROWS");
  count(aliasesAfterCsv.rows.length, profile.counts.aliasAfterRows, "ALIAS_AFTER_ROWS");

  return {
    base,
    baseSnapshotRawSha256,
    baseSnapshotCanonicalSha256: canonicalGovernanceJsonSha256(base),
    artifactSha256,
    accountsBefore: accountsBeforeCsv.rows.map(auditAccount),
    accountsAfter: accountsAfterCsv.rows.map(auditAccount),
    aliasesBefore: aliasesBeforeCsv.rows.map(auditAlias),
    aliasesAfter: aliasesAfterCsv.rows.map(auditAlias),
  };
}
