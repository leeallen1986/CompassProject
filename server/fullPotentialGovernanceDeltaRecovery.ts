import { createHash } from "node:crypto";
import type {
  FullPotentialReconciliationAccount,
  FullPotentialReconciliationAlias,
} from "../shared/fullPotentialAccountReconciliation";
import {
  buildFullPotentialLookalikeIdentityReport,
  verifyFullPotentialLookalikeIdentityReport,
  type FullPotentialLookalikeAccountSnapshot,
  type FullPotentialLookalikeGovernanceDelta,
} from "./fullPotentialLookalikeIdentityReconciliation";
import { FP_LOOKALIKE_PUBLIC_CANDIDATES_V1 } from "./fullPotentialLookalikePublicPack";

export const FULL_POTENTIAL_GOVERNANCE_AUDIT_FILENAMES = [
  "changed-accounts-before.csv",
  "changed-accounts-after.csv",
  "changed-aliases-before.csv",
  "changed-aliases-after.csv",
  "audit-manifest.json",
  "apply-summary.json",
  "after-state-summary.json",
  "before-state.json",
  "SHA256SUMS.txt",
] as const;

export type FullPotentialGovernanceAuditFilename =
  typeof FULL_POTENTIAL_GOVERNANCE_AUDIT_FILENAMES[number];

export interface FullPotentialGovernanceDeltaRecoveryProfile {
  version: 1;
  profileRef: string;
  deltaRef: string;
  governanceSourceSha: string;
  baseSnapshotRawSha256: string;
  approvedPackageSha256: string;
  changedRowsBeforeManifestSha256: string;
  changedRowsAfterManifestSha256: string;
  artifactSha256: Record<FullPotentialGovernanceAuditFilename, string>;
  expectedCounts: {
    baseAccounts: number;
    baseAliases: number;
    changedAccountsBefore: number;
    changedAccountsAfter: number;
    changedAliasesBefore: number;
    changedAliasesAfter: number;
    accountCreated: number;
    accountReplaced: number;
    accountDeleted: 0;
    aliasAdded: number;
    aliasReplaced: 0;
    aliasDeleted: 0;
    auditScopeBeforeAccounts: number;
    auditScopeAfterAccounts: number;
  };
}

export const ISSUE145_GOVERNANCE_DELTA_RECOVERY_PROFILE: FullPotentialGovernanceDeltaRecoveryProfile = {
  version: 1,
  profileRef: "issue145-full-potential-governance-recovery-v1",
  deltaRef: "issue145-recovered-governance-delta-v1",
  governanceSourceSha: "9ecc06561ad6d081ee2f6f721d4c74b6b8d2b98a",
  baseSnapshotRawSha256: "34a3e1242542dcb9c9ced913638ea00b306a0f2534c85e8da2c31aa560c0dd24",
  approvedPackageSha256: "125e010edb5b5237731369e7caae270f927fbfd5f5f1819386347fef7597efb8",
  changedRowsBeforeManifestSha256: "29150bb32a5a06ebaae5db6c7f21d14334a00afdb94e93f696a6a7e613f893c2",
  changedRowsAfterManifestSha256: "d8e195adcd51e703ab8c15b2607a7b00ea707e52f13544fd4dc7d909b2e6a163",
  artifactSha256: {
    "changed-accounts-before.csv": "18516719612ee39e8a8f4d3cb8a6523db8bafff7d3ad4fcab0184968538e326c",
    "changed-accounts-after.csv": "8051a1154d1bd1f26cd92e4d093323f600d0158dd84b3db063ca59cd9182973e",
    "changed-aliases-before.csv": "3375655d7d26dab6384f58181e6c0af492377e021ff4127bbb30afb17563ea6f",
    "changed-aliases-after.csv": "e5e3d4d7dff2d6c3828e1cb40ec96234035041ed2d38d2efaa0c50e7950642f9",
    "audit-manifest.json": "48021f914ebb8335dbf974db9a6dd2e7b6fb549cd40272c1c2b15b46676321dd",
    "apply-summary.json": "35bec6fe6893a7b5edde382dea9e5f6c72e83e9df927d262524ae36aa8e568a3",
    "after-state-summary.json": "371bef30e432281512a2664914329a8b5886b2530b1ebbbf56ee404616811621",
    "before-state.json": "e6a0e85aea5a1bf0d5fde90dda713e4c23b2b6c6faa51833e655dc419327f7cf",
    "SHA256SUMS.txt": "8fadc942f699dcbd0fbc90720602c331ff910d0d416dbee700b65dcd5c02c2b2",
  },
  expectedCounts: {
    baseAccounts: 1_146,
    baseAliases: 157,
    changedAccountsBefore: 1,
    changedAccountsAfter: 17,
    changedAliasesBefore: 0,
    changedAliasesAfter: 3,
    accountCreated: 16,
    accountReplaced: 1,
    accountDeleted: 0,
    aliasAdded: 3,
    aliasReplaced: 0,
    aliasDeleted: 0,
    auditScopeBeforeAccounts: 14,
    auditScopeAfterAccounts: 24,
  },
};

export interface FullPotentialGovernanceDeltaRecoveryInputs {
  sourceSha: string;
  retainedPostApplyEvidenceAt: string;
  baseSnapshotRaw: string | Buffer;
  artifacts: Record<FullPotentialGovernanceAuditFilename, string | Buffer>;
  profile?: FullPotentialGovernanceDeltaRecoveryProfile;
}

export interface FullPotentialGovernanceDeltaRecoveryReport {
  version: 1;
  methodologyVersion: "fp-governance-delta-recovery-v1";
  sourceSha: string;
  profileRef: string;
  originalDeltaRecovered: false;
  recoveryBasis: "hash_locked_changed_row_audit";
  timestampEvidence: {
    retainedPostApplyEvidenceAt: string;
    exactTransactionTimeClaimed: false;
    explanation: string;
  };
  lineage: {
    governanceSourceSha: string;
    baseSnapshotRawSha256: string;
    baseSnapshotCanonicalSha256: string;
    approvedPackageSha256: string;
    changedRowsBeforeManifestSha256: string;
    changedRowsAfterManifestSha256: string;
    artifactSha256: Record<FullPotentialGovernanceAuditFilename, string>;
  };
  counts: {
    baseAccountCount: number;
    governedAccountCount: number;
    baseAliasCount: number;
    governedAliasCount: number;
    changedAccountBeforeRowCount: number;
    changedAccountAfterRowCount: number;
    changedAliasBeforeRowCount: number;
    changedAliasAfterRowCount: number;
    accountCreatedCount: number;
    accountReplacedCount: number;
    accountDeletedCount: 0;
    aliasAddedCount: number;
    aliasReplacedCount: 0;
    aliasDeletedCount: 0;
    orphanAliasTargetCount: 0;
    missingParentTargetCount: 0;
  };
  recoveredDelta: {
    deltaRef: string;
    recoveredDeltaSha256: string;
    accountRowCount: number;
    aliasRowCount: number;
  };
  issue143Validation: {
    governedSnapshotSha256: string;
    candidateCount: number;
    buyerCandidateCount: number;
    marketParticipantControlCount: number;
    weeklyRecommendationEligibleCount: 0;
    completeForCandidateCreation: false;
    manualReviewRequired: true;
    monetaryImpactAud: 0;
    durableActionsCreated: 0;
  };
  safety: {
    databaseConnections: 0;
    databaseReads: 0;
    databaseWrites: 0;
    fullPotentialAccountMutations: 0;
    fullPotentialMonetaryMutations: 0;
    crmC4cMutations: 0;
    contactEnrichmentMutations: 0;
    providerCalls: 0;
    pipelineInvocations: 0;
    durableActionsCreated: 0;
    deployments: 0;
  };
  reportSha256: string;
}

export interface FullPotentialGovernanceDeltaRecoveryResult {
  delta: FullPotentialLookalikeGovernanceDelta;
  report: FullPotentialGovernanceDeltaRecoveryReport;
}

const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ACCOUNT_AUDIT_HEADER = [
  "id",
  "stableKey",
  "canonicalName",
  "displayName",
  "parentAccountId",
  "mergedIntoAccountId",
  "rowClass",
  "relationshipType",
  "recordStatus",
  "countsTowardPotential",
  "country",
  "routeToMarket",
  "ownerName",
  "channelOwner",
  "fpStatus",
  "priorityTier",
  "platformPushDecision",
  "c4cStatus",
  "sourceWorkbookVersion",
  "sourceSheet",
  "sourceRowNumber",
  "financialValuesState",
] as const;
const ALIAS_AUDIT_HEADER = [
  "accountId",
  "aliasName",
  "aliasType",
  "source",
  "confidenceLevel",
] as const;
const ROW_CLASSES = new Set<FullPotentialReconciliationAccount["rowClass"]>([
  "account",
  "site_context",
  "channel_managed",
  "competitor_watch",
  "cluster_signal",
]);
const RECORD_STATUSES = new Set<FullPotentialReconciliationAccount["recordStatus"]>([
  "active",
  "under_review",
  "merged",
  "parked",
  "excluded",
]);

interface ParsedCsv {
  header: string[];
  rows: Array<Record<string, string>>;
}

interface AuditAccountRow {
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

interface AuditAliasRow {
  accountId: number;
  aliasName: string;
  aliasType: string | null;
  confidenceLevel: string | null;
}

function asText(value: string | Buffer): string {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

function rawSha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

export function canonicalFullPotentialJsonSha256(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function parseJsonObject(value: string | Buffer, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(asText(value));
  } catch {
    throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_JSON_INVALID`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_OBJECT_REQUIRED`);
  }
  return parsed as Record<string, unknown>;
}

function parseSnapshot(value: string | Buffer): FullPotentialLookalikeAccountSnapshot {
  const parsed = parseJsonObject(value, "BASE_SNAPSHOT") as unknown as FullPotentialLookalikeAccountSnapshot;
  if (
    typeof parsed.snapshotRef !== "string"
    || typeof parsed.capturedAt !== "string"
    || !Array.isArray(parsed.accounts)
    || !Array.isArray(parsed.aliases)
  ) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_BASE_SNAPSHOT_SHAPE_INVALID");
  }
  return parsed;
}

function parseCsv(value: string | Buffer, label: string): ParsedCsv {
  const text = asText(value).replace(/^\uFEFF/, "");
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (field.length > 0) throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_CSV_QUOTE_INVALID`);
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some(cell => cell.length > 0)) matrix.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (quoted) throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_CSV_UNCLOSED_QUOTE`);
  row.push(field);
  if (row.some(cell => cell.length > 0)) matrix.push(row);
  if (matrix.length < 1) throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_CSV_EMPTY`);

  const header = matrix[0].map(cell => cell.trim());
  if (new Set(header).size !== header.length) {
    throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_CSV_DUPLICATE_HEADER`);
  }
  const rows = matrix.slice(1).map((cells, rowIndex) => {
    if (cells.length !== header.length) {
      throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_CSV_WIDTH_INVALID:${rowIndex + 2}`);
    }
    return Object.fromEntries(header.map((key, columnIndex) => [key, cells[columnIndex]]));
  });
  return { header, rows };
}

function assertHeader(actual: string[], expected: readonly string[], label: string): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_HEADER_MISMATCH`);
  }
}

function positiveInteger(value: string, field: string): number {
  const text = value.trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`GOVERNANCE_DELTA_RECOVERY_${field}_POSITIVE_INTEGER_REQUIRED`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`GOVERNANCE_DELTA_RECOVERY_${field}_SAFE_INTEGER_REQUIRED`);
  }
  return parsed;
}

function nullablePositiveInteger(value: string, field: string): number | null {
  const text = value.trim();
  if (!text || /^null$/i.test(text)) return null;
  return positiveInteger(text, field);
}

function booleanValue(value: string, field: string): boolean {
  const text = value.trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  throw new Error(`GOVERNANCE_DELTA_RECOVERY_${field}_BOOLEAN_REQUIRED`);
}

function nullableText(value: string): string | null {
  const text = value.trim();
  return text && !/^null$/i.test(text) ? text : null;
}

function requiredText(value: string, field: string): string {
  const text = value.trim();
  if (!text) throw new Error(`GOVERNANCE_DELTA_RECOVERY_${field}_REQUIRED`);
  return text;
}

function accountAuditRow(row: Record<string, string>, index: number): AuditAccountRow {
  const rowClass = requiredText(row.rowClass ?? "", `ACCOUNT_${index}_ROW_CLASS`);
  if (!ROW_CLASSES.has(rowClass as FullPotentialReconciliationAccount["rowClass"])) {
    throw new Error(`GOVERNANCE_DELTA_RECOVERY_ACCOUNT_${index}_ROW_CLASS_INVALID`);
  }
  const recordStatus = requiredText(row.recordStatus ?? "", `ACCOUNT_${index}_RECORD_STATUS`);
  if (!RECORD_STATUSES.has(recordStatus as FullPotentialReconciliationAccount["recordStatus"])) {
    throw new Error(`GOVERNANCE_DELTA_RECOVERY_ACCOUNT_${index}_RECORD_STATUS_INVALID`);
  }
  const country = requiredText(row.country ?? "", `ACCOUNT_${index}_COUNTRY`).toUpperCase();
  if (country !== "AU") throw new Error(`GOVERNANCE_DELTA_RECOVERY_ACCOUNT_${index}_COUNTRY_NOT_AU`);
  return {
    id: positiveInteger(row.id ?? "", `ACCOUNT_${index}_ID`),
    stableKey: requiredText(row.stableKey ?? "", `ACCOUNT_${index}_STABLE_KEY`),
    canonicalName: requiredText(row.canonicalName ?? "", `ACCOUNT_${index}_CANONICAL_NAME`),
    displayName: nullableText(row.displayName ?? ""),
    parentAccountId: nullablePositiveInteger(row.parentAccountId ?? "", `ACCOUNT_${index}_PARENT_ID`),
    mergedIntoAccountId: nullablePositiveInteger(row.mergedIntoAccountId ?? "", `ACCOUNT_${index}_MERGED_ID`),
    rowClass: rowClass as FullPotentialReconciliationAccount["rowClass"],
    relationshipType: nullableText(row.relationshipType ?? ""),
    recordStatus: recordStatus as FullPotentialReconciliationAccount["recordStatus"],
    countsTowardPotential: booleanValue(row.countsTowardPotential ?? "", `ACCOUNT_${index}_COUNTS`),
    country,
    routeToMarket: requiredText(row.routeToMarket ?? "", `ACCOUNT_${index}_ROUTE`),
  };
}

function aliasAuditRow(row: Record<string, string>, index: number): AuditAliasRow {
  return {
    accountId: positiveInteger(row.accountId ?? "", `ALIAS_${index}_ACCOUNT_ID`),
    aliasName: requiredText(row.aliasName ?? "", `ALIAS_${index}_NAME`),
    aliasType: nullableText(row.aliasType ?? ""),
    confidenceLevel: nullableText(row.confidenceLevel ?? ""),
  };
}

function assertUniqueBy<T>(rows: T[], key: (row: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_DUPLICATE`);
    seen.add(value);
  }
}

function normalizeIdentity(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bpty\b|\bltd\b|\blimited\b|\baustralia\b|\baustralian\b/g, " ")
    .replace(/\bgroup\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function exactString(object: Record<string, unknown>, key: string, expected: string, label: string): void {
  if (object[key] !== expected) throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_MISMATCH`);
}

function exactNumber(object: Record<string, unknown>, key: string, expected: number, label: string): void {
  if (Number(object[key]) !== expected) throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_MISMATCH`);
}

function zeroLike(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0) return true;
  if (typeof value === "string") {
    return ["", "0", "false", "none", "null"].includes(value.trim().toLowerCase());
  }
  if (Array.isArray(value)) return value.length === 0 || value.every(zeroLike);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).every(zeroLike);
  return false;
}

function trueLike(value: unknown): boolean {
  return value === true || value === 1 || String(value).trim().toLowerCase() === "true";
}

function assertZeroLike(value: unknown, label: string): void {
  if (!zeroLike(value)) throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_NOT_ZERO`);
}

function parseChecksumManifest(
  value: string | Buffer,
  actualHashes: Record<FullPotentialGovernanceAuditFilename, string>,
): void {
  const entries = new Map<string, string>();
  for (const rawLine of asText(value).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line);
    if (!match) throw new Error("GOVERNANCE_DELTA_RECOVERY_CHECKSUM_MANIFEST_LINE_INVALID");
    const filename = match[2].split(/[\\/]/).at(-1) ?? match[2];
    if (entries.has(filename)) throw new Error("GOVERNANCE_DELTA_RECOVERY_CHECKSUM_MANIFEST_DUPLICATE");
    entries.set(filename, match[1]);
  }
  for (const filename of [
    "changed-accounts-before.csv",
    "changed-accounts-after.csv",
    "changed-aliases-before.csv",
    "changed-aliases-after.csv",
    "audit-manifest.json",
  ] as const) {
    if (entries.get(filename) !== actualHashes[filename]) {
      throw new Error(`GOVERNANCE_DELTA_RECOVERY_CHECKSUM_MANIFEST_${filename}_MISMATCH`);
    }
  }
  for (const [filename, hash] of entries) {
    if (filename in actualHashes && actualHashes[filename as FullPotentialGovernanceAuditFilename] !== hash) {
      throw new Error(`GOVERNANCE_DELTA_RECOVERY_CHECKSUM_MANIFEST_${filename}_MISMATCH`);
    }
  }
}

function verifyAuditJson(
  profile: FullPotentialGovernanceDeltaRecoveryProfile,
  artifacts: Record<FullPotentialGovernanceAuditFilename, string | Buffer>,
): void {
  const audit = parseJsonObject(artifacts["audit-manifest.json"], "AUDIT_MANIFEST");
  exactString(audit, "sourceSha", profile.governanceSourceSha, "AUDIT_SOURCE_SHA");
  exactString(audit, "approvedPackageSha256", profile.approvedPackageSha256, "AUDIT_APPROVED_PACKAGE");
  exactString(audit, "beforeManifestSha256", profile.changedRowsBeforeManifestSha256, "AUDIT_BEFORE_MANIFEST");
  exactString(audit, "afterManifestSha256", profile.changedRowsAfterManifestSha256, "AUDIT_AFTER_MANIFEST");
  exactNumber(audit, "changedAccountBeforeRows", profile.expectedCounts.changedAccountsBefore, "AUDIT_ACCOUNT_BEFORE_COUNT");
  exactNumber(audit, "changedAccountAfterRows", profile.expectedCounts.changedAccountsAfter, "AUDIT_ACCOUNT_AFTER_COUNT");
  exactNumber(audit, "changedAliasBeforeRows", profile.expectedCounts.changedAliasesBefore, "AUDIT_ALIAS_BEFORE_COUNT");
  exactNumber(audit, "changedAliasAfterRows", profile.expectedCounts.changedAliasesAfter, "AUDIT_ALIAS_AFTER_COUNT");
  assertZeroLike(audit.financialValuesChanged, "AUDIT_FINANCIAL_CHANGE");
  assertZeroLike(audit.crmC4cMutations, "AUDIT_CRM_CHANGE");
  assertZeroLike(audit.pipelineProviderActivity, "AUDIT_PIPELINE_PROVIDER_ACTIVITY");

  const apply = parseJsonObject(artifacts["apply-summary.json"], "APPLY_SUMMARY");
  exactString(apply, "sourceSha", profile.governanceSourceSha, "APPLY_SOURCE_SHA");
  exactString(apply, "approvedPackageSha", profile.approvedPackageSha256, "APPLY_APPROVED_PACKAGE");
  assertZeroLike(apply.financialValuesChanged, "APPLY_FINANCIAL_CHANGE");
  assertZeroLike(apply.financialMutationFields, "APPLY_FINANCIAL_MUTATION_FIELDS");
  assertZeroLike(apply.crmC4cMutations, "APPLY_CRM_CHANGE");
  assertZeroLike(apply.crmC4cMutationFields, "APPLY_CRM_MUTATION_FIELDS");
  assertZeroLike(apply.pipelineProviderActivity, "APPLY_PIPELINE_PROVIDER_ACTIVITY");
  assertZeroLike(apply.actionsModelsEvidenceSignalsCreated, "APPLY_ACTION_MODEL_EVIDENCE_SIGNAL");
  exactNumber(apply, "runningCount", 0, "APPLY_RUNNING_COUNT");
  if (Array.isArray(apply.createdIds) && apply.createdIds.length !== profile.expectedCounts.accountCreated) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_APPLY_CREATED_IDS_COUNT_MISMATCH");
  }
  if (apply.aliasesCreated !== undefined) {
    const aliasesCreated = Array.isArray(apply.aliasesCreated)
      ? apply.aliasesCreated.length
      : Number(apply.aliasesCreated);
    if (aliasesCreated !== profile.expectedCounts.aliasAdded) {
      throw new Error("GOVERNANCE_DELTA_RECOVERY_APPLY_ALIAS_COUNT_MISMATCH");
    }
  }

  const after = parseJsonObject(artifacts["after-state-summary.json"], "AFTER_STATE_SUMMARY");
  exactString(after, "beforeManifestSha256", profile.changedRowsBeforeManifestSha256, "AFTER_STATE_BEFORE_MANIFEST");
  exactString(after, "afterManifestSha256", profile.changedRowsAfterManifestSha256, "AFTER_STATE_AFTER_MANIFEST");
  exactNumber(after, "afterAccountCount", profile.expectedCounts.auditScopeAfterAccounts, "AFTER_STATE_ACCOUNT_COUNT");
  exactNumber(after, "createdAccountCount", profile.expectedCounts.accountCreated, "AFTER_STATE_CREATED_COUNT");
  exactNumber(after, "aliasCount", profile.expectedCounts.aliasAdded, "AFTER_STATE_ALIAS_COUNT");
  if (!trueLike(after.createdFinancialsNull)) throw new Error("GOVERNANCE_DELTA_RECOVERY_AFTER_STATE_CREATED_FINANCIALS_NOT_NULL");
  if (!trueLike(after.createdGovernanceValid)) throw new Error("GOVERNANCE_DELTA_RECOVERY_AFTER_STATE_GOVERNANCE_INVALID");
  if (!trueLike(after.financeInvariantExisting)) throw new Error("GOVERNANCE_DELTA_RECOVERY_AFTER_STATE_FINANCE_INVARIANT_INVALID");
  if (!trueLike(after.zeroSideEffects)) throw new Error("GOVERNANCE_DELTA_RECOVERY_AFTER_STATE_SIDE_EFFECT_FLAG_INVALID");
  assertZeroLike(after.sideEffects, "AFTER_STATE_SIDE_EFFECTS");

  const before = parseJsonObject(artifacts["before-state.json"], "BEFORE_STATE");
  if (!Array.isArray(before.accountIds) || before.accountIds.length !== profile.expectedCounts.auditScopeBeforeAccounts) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_BEFORE_STATE_ACCOUNT_IDS_COUNT_MISMATCH");
  }
  if (!Array.isArray(before.accounts) || before.accounts.length !== profile.expectedCounts.auditScopeBeforeAccounts) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_BEFORE_STATE_ACCOUNTS_COUNT_MISMATCH");
  }
  if (!Array.isArray(before.aliases) || before.aliases.length !== profile.expectedCounts.changedAliasesBefore) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_BEFORE_STATE_ALIASES_COUNT_MISMATCH");
  }
}

function verifyProfile(profile: FullPotentialGovernanceDeltaRecoveryProfile): void {
  if (profile.version !== 1 || !profile.profileRef || !profile.deltaRef) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_PROFILE_INVALID");
  }
  if (!SOURCE_SHA_PATTERN.test(profile.governanceSourceSha)) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_PROFILE_SOURCE_SHA_INVALID");
  }
  for (const hash of [
    profile.baseSnapshotRawSha256,
    profile.approvedPackageSha256,
    profile.changedRowsBeforeManifestSha256,
    profile.changedRowsAfterManifestSha256,
    ...Object.values(profile.artifactSha256),
  ]) {
    if (!SHA256_PATTERN.test(hash)) throw new Error("GOVERNANCE_DELTA_RECOVERY_PROFILE_SHA_INVALID");
  }
}

function assertExpectedCount(actual: number, expected: number, label: string): void {
  if (actual !== expected) throw new Error(`GOVERNANCE_DELTA_RECOVERY_${label}_COUNT_MISMATCH`);
}

export function recoverFullPotentialGovernanceDelta(
  input: FullPotentialGovernanceDeltaRecoveryInputs,
): FullPotentialGovernanceDeltaRecoveryResult {
  const profile = input.profile ?? ISSUE145_GOVERNANCE_DELTA_RECOVERY_PROFILE;
  verifyProfile(profile);
  if (!SOURCE_SHA_PATTERN.test(input.sourceSha)) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_SOURCE_SHA_INVALID");
  }
  if (Number.isNaN(Date.parse(input.retainedPostApplyEvidenceAt))) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_EVIDENCE_TIMESTAMP_INVALID");
  }
  const retainedPostApplyEvidenceAt = new Date(input.retainedPostApplyEvidenceAt).toISOString();

  const baseRawHash = rawSha256(input.baseSnapshotRaw);
  if (baseRawHash !== profile.baseSnapshotRawSha256) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_BASE_RAW_SHA256_MISMATCH");
  }
  const actualArtifactHashes = Object.fromEntries(
    FULL_POTENTIAL_GOVERNANCE_AUDIT_FILENAMES.map(filename => [
      filename,
      rawSha256(input.artifacts[filename]),
    ]),
  ) as Record<FullPotentialGovernanceAuditFilename, string>;
  for (const filename of FULL_POTENTIAL_GOVERNANCE_AUDIT_FILENAMES) {
    if (actualArtifactHashes[filename] !== profile.artifactSha256[filename]) {
      throw new Error(`GOVERNANCE_DELTA_RECOVERY_${filename}_SHA256_MISMATCH`);
    }
  }
  parseChecksumManifest(input.artifacts["SHA256SUMS.txt"], actualArtifactHashes);
  verifyAuditJson(profile, input.artifacts);

  const baseSnapshot = parseSnapshot(input.baseSnapshotRaw);
  assertExpectedCount(baseSnapshot.accounts.length, profile.expectedCounts.baseAccounts, "BASE_ACCOUNT");
  assertExpectedCount(baseSnapshot.aliases.length, profile.expectedCounts.baseAliases, "BASE_ALIAS");
  const baseCanonicalHash = canonicalFullPotentialJsonSha256(baseSnapshot);

  const accountBeforeCsv = parseCsv(input.artifacts["changed-accounts-before.csv"], "ACCOUNT_BEFORE");
  const accountAfterCsv = parseCsv(input.artifacts["changed-accounts-after.csv"], "ACCOUNT_AFTER");
  const aliasBeforeCsv = parseCsv(input.artifacts["changed-aliases-before.csv"], "ALIAS_BEFORE");
  const aliasAfterCsv = parseCsv(input.artifacts["changed-aliases-after.csv"], "ALIAS_AFTER");
  assertHeader(accountBeforeCsv.header, ACCOUNT_AUDIT_HEADER, "ACCOUNT_BEFORE");
  assertHeader(accountAfterCsv.header, ACCOUNT_AUDIT_HEADER, "ACCOUNT_AFTER");
  assertHeader(aliasBeforeCsv.header, ALIAS_AUDIT_HEADER, "ALIAS_BEFORE");
  assertHeader(aliasAfterCsv.header, ALIAS_AUDIT_HEADER, "ALIAS_AFTER");
  assertExpectedCount(accountBeforeCsv.rows.length, profile.expectedCounts.changedAccountsBefore, "CHANGED_ACCOUNT_BEFORE");
  assertExpectedCount(accountAfterCsv.rows.length, profile.expectedCounts.changedAccountsAfter, "CHANGED_ACCOUNT_AFTER");
  assertExpectedCount(aliasBeforeCsv.rows.length, profile.expectedCounts.changedAliasesBefore, "CHANGED_ALIAS_BEFORE");
  assertExpectedCount(aliasAfterCsv.rows.length, profile.expectedCounts.changedAliasesAfter, "CHANGED_ALIAS_AFTER");

  const accountBefore = accountBeforeCsv.rows.map((row, index) => accountAuditRow(row, index));
  const accountAfter = accountAfterCsv.rows.map((row, index) => accountAuditRow(row, index));
  const aliasBefore = aliasBeforeCsv.rows.map((row, index) => aliasAuditRow(row, index));
  const aliasAfter = aliasAfterCsv.rows.map((row, index) => aliasAuditRow(row, index));
  assertUniqueBy(accountBefore, row => String(row.id), "ACCOUNT_BEFORE_ID");
  assertUniqueBy(accountAfter, row => String(row.id), "ACCOUNT_AFTER_ID");
  assertUniqueBy(accountAfter, row => row.stableKey, "ACCOUNT_AFTER_STABLE_KEY");
  assertUniqueBy(aliasBefore, row => `${row.accountId}:${normalizeIdentity(row.aliasName)}`, "ALIAS_BEFORE_KEY");
  assertUniqueBy(aliasAfter, row => `${row.accountId}:${normalizeIdentity(row.aliasName)}`, "ALIAS_AFTER_KEY");

  const beforeAccountIds = new Set(accountBefore.map(row => row.id));
  const afterAccountIds = new Set(accountAfter.map(row => row.id));
  const accountCreatedCount = accountAfter.filter(row => !beforeAccountIds.has(row.id)).length;
  const accountReplacedCount = accountAfter.filter(row => beforeAccountIds.has(row.id)).length;
  const accountDeletedCount = accountBefore.filter(row => !afterAccountIds.has(row.id)).length;
  assertExpectedCount(accountCreatedCount, profile.expectedCounts.accountCreated, "ACCOUNT_CREATED");
  assertExpectedCount(accountReplacedCount, profile.expectedCounts.accountReplaced, "ACCOUNT_REPLACED");
  assertExpectedCount(accountDeletedCount, profile.expectedCounts.accountDeleted, "ACCOUNT_DELETED");

  const aliasKey = (row: AuditAliasRow) => `${row.accountId}:${normalizeIdentity(row.aliasName)}`;
  const beforeAliasByKey = new Map(aliasBefore.map(row => [aliasKey(row), row]));
  const afterAliasByKey = new Map(aliasAfter.map(row => [aliasKey(row), row]));
  const aliasAddedCount = aliasAfter.filter(row => !beforeAliasByKey.has(aliasKey(row))).length;
  const aliasReplacedCount = aliasAfter.filter(row => beforeAliasByKey.has(aliasKey(row))).length;
  const aliasDeletedCount = aliasBefore.filter(row => !afterAliasByKey.has(aliasKey(row))).length;
  assertExpectedCount(aliasAddedCount, profile.expectedCounts.aliasAdded, "ALIAS_ADDED");
  assertExpectedCount(aliasReplacedCount, profile.expectedCounts.aliasReplaced, "ALIAS_REPLACED");
  assertExpectedCount(aliasDeletedCount, profile.expectedCounts.aliasDeleted, "ALIAS_DELETED");

  const baseById = new Map<number, FullPotentialReconciliationAccount>();
  for (const account of baseSnapshot.accounts) {
    if (!Number.isSafeInteger(account.id) || account.id <= 0) {
      throw new Error("GOVERNANCE_DELTA_RECOVERY_BASE_ACCOUNT_ID_INVALID");
    }
    if (baseById.has(account.id)) throw new Error("GOVERNANCE_DELTA_RECOVERY_BASE_ACCOUNT_ID_DUPLICATE");
    baseById.set(account.id, account);
  }
  const governedNameById = new Map<number, string>(
    baseSnapshot.accounts.map(account => [account.id, account.canonicalName]),
  );
  for (const row of accountAfter) governedNameById.set(row.id, row.canonicalName);

  let missingParentTargetCount = 0;
  const deltaAccounts: FullPotentialReconciliationAccount[] = accountAfter.map(row => {
    let parentGroup: string | null = null;
    if (row.parentAccountId !== null) {
      if (row.parentAccountId === row.id) {
        throw new Error("GOVERNANCE_DELTA_RECOVERY_ACCOUNT_PARENT_SELF_REFERENCE");
      }
      parentGroup = governedNameById.get(row.parentAccountId) ?? null;
      if (!parentGroup) missingParentTargetCount += 1;
    }
    return {
      id: row.id,
      stableKey: row.stableKey,
      canonicalName: row.canonicalName,
      displayName: row.displayName,
      parentGroup,
      rowClass: row.rowClass,
      relationshipType: row.relationshipType,
      recordStatus: row.recordStatus,
      countsTowardPotential: row.countsTowardPotential,
      mergedIntoAccountId: row.mergedIntoAccountId,
      country: row.country,
      routeToMarket: row.routeToMarket,
    };
  }).sort((left, right) => left.id - right.id);
  if (missingParentTargetCount > 0) {
    throw new Error(`GOVERNANCE_DELTA_RECOVERY_MISSING_PARENT_TARGETS:${missingParentTargetCount}`);
  }

  const governedById = new Map(baseById);
  for (const account of deltaAccounts) governedById.set(account.id, account);
  const governedStableKeys = new Map<string, number>();
  for (const account of governedById.values()) {
    const existing = governedStableKeys.get(account.stableKey);
    if (existing !== undefined && existing !== account.id) {
      throw new Error("GOVERNANCE_DELTA_RECOVERY_GOVERNED_STABLE_KEY_COLLISION");
    }
    governedStableKeys.set(account.stableKey, account.id);
    if (account.mergedIntoAccountId !== null && account.mergedIntoAccountId !== undefined) {
      if (!governedById.has(account.mergedIntoAccountId)) {
        throw new Error("GOVERNANCE_DELTA_RECOVERY_MERGED_TARGET_MISSING");
      }
    }
  }

  let orphanAliasTargetCount = 0;
  const deltaAliases: FullPotentialReconciliationAlias[] = aliasAfter.map(row => {
    if (!governedById.has(row.accountId)) orphanAliasTargetCount += 1;
    return {
      accountId: row.accountId,
      aliasName: row.aliasName,
      aliasType: row.aliasType,
      confidenceLevel: row.confidenceLevel,
    };
  }).sort((left, right) => left.accountId - right.accountId || left.aliasName.localeCompare(right.aliasName));
  if (orphanAliasTargetCount > 0) {
    throw new Error(`GOVERNANCE_DELTA_RECOVERY_ORPHAN_ALIAS_TARGETS:${orphanAliasTargetCount}`);
  }

  const delta: FullPotentialLookalikeGovernanceDelta = {
    version: 1,
    deltaRef: profile.deltaRef,
    appliedAt: retainedPostApplyEvidenceAt,
    baseSnapshotSha256: baseCanonicalHash,
    accounts: deltaAccounts,
    aliases: deltaAliases,
  };
  const recoveredDeltaSha256 = canonicalFullPotentialJsonSha256(delta);

  const issue143Report = buildFullPotentialLookalikeIdentityReport({
    sourceSha: input.sourceSha,
    candidates: FP_LOOKALIKE_PUBLIC_CANDIDATES_V1,
    baseSnapshot,
    governanceDelta: delta,
  });
  verifyFullPotentialLookalikeIdentityReport(issue143Report);
  if (
    issue143Report.governedSnapshot.baseSnapshotSha256 !== baseCanonicalHash
    || issue143Report.governedSnapshot.governanceDeltaSha256 !== recoveredDeltaSha256
    || issue143Report.governedSnapshot.beforeAccountCount !== baseSnapshot.accounts.length
    || issue143Report.governedSnapshot.afterAccountCount
      !== baseSnapshot.accounts.length + profile.expectedCounts.accountCreated
    || issue143Report.governedSnapshot.beforeAliasCount !== baseSnapshot.aliases.length
    || issue143Report.governedSnapshot.afterAliasCount
      !== baseSnapshot.aliases.length + profile.expectedCounts.aliasAdded
    || issue143Report.governedSnapshot.createdAccountCount !== profile.expectedCounts.accountCreated
    || issue143Report.governedSnapshot.replacedAccountCount !== profile.expectedCounts.accountReplaced
    || issue143Report.governedSnapshot.addedAliasCount !== profile.expectedCounts.aliasAdded
  ) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_ISSUE143_MATERIALISATION_COUNT_MISMATCH");
  }
  if (
    issue143Report.counts.weeklyRecommendationEligibleCount !== 0
    || issue143Report.completeForCandidateCreation !== false
    || issue143Report.manualReviewRequired !== true
    || issue143Report.safety.durableActionsCreated !== 0
    || issue143Report.safety.fullPotentialMonetaryMutations !== 0
  ) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_ISSUE143_SAFETY_MISMATCH");
  }

  const artifactSha256 = { ...actualArtifactHashes };
  const unsigned = {
    version: 1 as const,
    methodologyVersion: "fp-governance-delta-recovery-v1" as const,
    sourceSha: input.sourceSha,
    profileRef: profile.profileRef,
    originalDeltaRecovered: false as const,
    recoveryBasis: "hash_locked_changed_row_audit" as const,
    timestampEvidence: {
      retainedPostApplyEvidenceAt,
      exactTransactionTimeClaimed: false as const,
      explanation: "The retained package did not preserve the exact transaction timestamp. This controller-approved post-apply evidence timestamp is used only for deterministic recovered-delta materialisation.",
    },
    lineage: {
      governanceSourceSha: profile.governanceSourceSha,
      baseSnapshotRawSha256: baseRawHash,
      baseSnapshotCanonicalSha256: baseCanonicalHash,
      approvedPackageSha256: profile.approvedPackageSha256,
      changedRowsBeforeManifestSha256: profile.changedRowsBeforeManifestSha256,
      changedRowsAfterManifestSha256: profile.changedRowsAfterManifestSha256,
      artifactSha256,
    },
    counts: {
      baseAccountCount: baseSnapshot.accounts.length,
      governedAccountCount: issue143Report.governedSnapshot.afterAccountCount,
      baseAliasCount: baseSnapshot.aliases.length,
      governedAliasCount: issue143Report.governedSnapshot.afterAliasCount,
      changedAccountBeforeRowCount: accountBefore.length,
      changedAccountAfterRowCount: accountAfter.length,
      changedAliasBeforeRowCount: aliasBefore.length,
      changedAliasAfterRowCount: aliasAfter.length,
      accountCreatedCount,
      accountReplacedCount,
      accountDeletedCount: 0 as const,
      aliasAddedCount,
      aliasReplacedCount: 0 as const,
      aliasDeletedCount: 0 as const,
      orphanAliasTargetCount: 0 as const,
      missingParentTargetCount: 0 as const,
    },
    recoveredDelta: {
      deltaRef: delta.deltaRef,
      recoveredDeltaSha256,
      accountRowCount: delta.accounts.length,
      aliasRowCount: delta.aliases.length,
    },
    issue143Validation: {
      governedSnapshotSha256: issue143Report.governedSnapshot.governedSnapshotSha256,
      candidateCount: issue143Report.counts.candidateCount,
      buyerCandidateCount: issue143Report.counts.buyerCandidateCount,
      marketParticipantControlCount: issue143Report.counts.marketParticipantControlCount,
      weeklyRecommendationEligibleCount: 0 as const,
      completeForCandidateCreation: false as const,
      manualReviewRequired: true as const,
      monetaryImpactAud: 0 as const,
      durableActionsCreated: 0 as const,
    },
    safety: {
      databaseConnections: 0 as const,
      databaseReads: 0 as const,
      databaseWrites: 0 as const,
      fullPotentialAccountMutations: 0 as const,
      fullPotentialMonetaryMutations: 0 as const,
      crmC4cMutations: 0 as const,
      contactEnrichmentMutations: 0 as const,
      providerCalls: 0 as const,
      pipelineInvocations: 0 as const,
      durableActionsCreated: 0 as const,
      deployments: 0 as const,
    },
  };
  const report: FullPotentialGovernanceDeltaRecoveryReport = {
    ...unsigned,
    reportSha256: canonicalFullPotentialJsonSha256(unsigned),
  };
  verifyFullPotentialGovernanceDeltaRecoveryReport(report);
  return { delta, report };
}

export function verifyFullPotentialGovernanceDeltaRecoveryReport(
  report: FullPotentialGovernanceDeltaRecoveryReport,
): void {
  const { reportSha256, ...unsigned } = report;
  if (!SHA256_PATTERN.test(reportSha256) || canonicalFullPotentialJsonSha256(unsigned) !== reportSha256) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_REPORT_SHA256_MISMATCH");
  }
  if (report.originalDeltaRecovered !== false || report.timestampEvidence.exactTransactionTimeClaimed !== false) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_PROVENANCE_CLAIM_INVALID");
  }
  if (
    report.counts.accountDeletedCount !== 0
    || report.counts.aliasDeletedCount !== 0
    || report.counts.orphanAliasTargetCount !== 0
    || report.counts.missingParentTargetCount !== 0
  ) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_FAIL_CLOSED_COUNT_INVALID");
  }
  if (
    report.issue143Validation.weeklyRecommendationEligibleCount !== 0
    || report.issue143Validation.completeForCandidateCreation !== false
    || report.issue143Validation.monetaryImpactAud !== 0
    || report.issue143Validation.durableActionsCreated !== 0
  ) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_SALES_ACTIVATION_BOUNDARY_INVALID");
  }
  if (Object.values(report.safety).some(value => value !== 0)) {
    throw new Error("GOVERNANCE_DELTA_RECOVERY_SAFETY_BOUNDARY_INVALID");
  }
}
