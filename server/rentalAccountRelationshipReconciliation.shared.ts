import { createHash } from "node:crypto";

export const RENTAL_RELATIONSHIP_MANIFEST_VERSION = 1 as const;
export const RENTAL_RELATIONSHIP_CANARY_ACCOUNT_IDS = [328, 334] as const;
export const RENTAL_RELATIONSHIP_PARENT_ACCOUNT_IDS = [269, 415] as const;
export const RENTAL_RELATIONSHIP_TYPE = "strategic_context" as const;

export const RENTAL_RELATIONSHIP_CANARY_SPECS = [
  {
    accountId: 328,
    expectedAccountName: "Coates Hire National Fleet",
    parentAccountId: 269,
    expectedParentIdentityToken: "coates",
  },
  {
    accountId: 334,
    expectedAccountName: "Onsite Rental Strategic Channel",
    parentAccountId: 415,
    expectedParentIdentityToken: "onsite rental",
  },
] as const;

export type RentalRelationshipDisposition =
  | "safe_attach_context"
  | "already_attached"
  | "manual_review";

export interface RentalRelationshipAccountSnapshot {
  id: number;
  stableKey: string | null;
  canonicalName: string;
  displayName: string | null;
  country: string | null;
  state: string | null;
  region: string | null;
  rowClass: string | null;
  parentAccountId: number | null;
  mergedIntoAccountId: number | null;
  relationshipType: string | null;
  recordStatus: string | null;
  countsTowardPotential: boolean;
  routeToMarket: string | null;
  ownerName: string | null;
  priorityTier: string | null;
  platformPushDecision: string | null;
  currentRevenueAud: string | null;
  fullPotentialAud: string | null;
  target2026Aud: string | null;
  remainingPotentialAud: string | null;
  updatedAt: string | null;
  fullImmutableStateHash: string;
}

export interface RentalRelationshipExpectedState {
  parentAccountId: number;
  mergedIntoAccountId: null;
  relationshipType: typeof RENTAL_RELATIONSHIP_TYPE;
  recordStatus: string | null;
  countsTowardPotential: false;
}

export interface RentalRelationshipManifestRow {
  accountId: number;
  parentAccountId: number;
  approved: boolean;
  disposition: RentalRelationshipDisposition;
  reason: string;
  reviewFlags: string[];
  before: RentalRelationshipAccountSnapshot | null;
  parent: RentalRelationshipAccountSnapshot | null;
  expectedAfter: RentalRelationshipExpectedState;
  immutableStateHash: string | null;
  recordHash: string;
}

export interface RentalRelationshipWorkspaceSummary {
  totalRentalRows: number;
  totalRentalAccounts: number;
  tierA: number;
  pushNow: number;
  directAccounts: number;
  channelAccounts: number;
  nonCountingContextRecords: number;
  attachedContextRecords: number;
  unattachedContextRecords: number;
  routeDistribution: Record<string, number>;
  topLevelAccountIds: number[];
  parentContextAccountIds: Record<string, number[]>;
}

export interface RentalRelationshipManifestSummary {
  targetRows: number;
  safeAttachContext: number;
  alreadyAttached: number;
  manualReview: number;
  approvedRows: number;
  preApplyWorkspaceChecksPassed: boolean;
  preApplyWorkspaceFailures: string[];
  workspaceBefore: RentalRelationshipWorkspaceSummary;
}

export interface RentalRelationshipManifestDraft {
  schemaVersion: typeof RENTAL_RELATIONSHIP_MANIFEST_VERSION;
  generatedAt: string;
  databaseIdentity: string;
  databaseFingerprint: string;
  sealed: false;
  summary: RentalRelationshipManifestSummary;
  rows: RentalRelationshipManifestRow[];
}

export interface RentalRelationshipManifestSealed
  extends Omit<RentalRelationshipManifestDraft, "sealed"> {
  sealed: true;
  sealedAt: string;
  manifestHash: string;
}

export interface RentalRelationshipApplySnapshot {
  accountId: number;
  parentAccountId: number | null;
  mergedIntoAccountId: number | null;
  relationshipType: string | null;
  recordStatus: string | null;
  countsTowardPotential: boolean;
  immutableStateHash: string;
}

function normaliseScalar(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normaliseScalar);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normaliseScalar(nested)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normaliseScalar(value));
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function normaliseIdentity(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Hash every persisted account field except the three explicitly authorised
 * relationship fields and the database-managed updatedAt timestamp.
 */
export function immutableAccountRecordHash(
  record: Record<string, unknown>,
): string {
  const {
    parentAccountId: _parentAccountId,
    relationshipType: _relationshipType,
    countsTowardPotential: _countsTowardPotential,
    updatedAt: _updatedAt,
    ...immutable
  } = record;
  return sha256(immutable);
}

export function immutableAccountStateHash(
  snapshot: RentalRelationshipAccountSnapshot,
): string {
  return snapshot.fullImmutableStateHash;
}

function expectedAfter(
  account: RentalRelationshipAccountSnapshot | null,
  parentAccountId: number,
): RentalRelationshipExpectedState {
  return {
    parentAccountId,
    mergedIntoAccountId: null,
    relationshipType: RENTAL_RELATIONSHIP_TYPE,
    recordStatus: account?.recordStatus ?? null,
    countsTowardPotential: false,
  };
}

function rowResult(input: {
  accountId: number;
  parentAccountId: number;
  disposition: RentalRelationshipDisposition;
  reason: string;
  reviewFlags: string[];
  before: RentalRelationshipAccountSnapshot | null;
  parent: RentalRelationshipAccountSnapshot | null;
}): RentalRelationshipManifestRow {
  const base = {
    accountId: input.accountId,
    parentAccountId: input.parentAccountId,
    approved: false,
    disposition: input.disposition,
    reason: input.reason,
    reviewFlags: Array.from(new Set(input.reviewFlags)).sort(),
    before: input.before,
    parent: input.parent,
    expectedAfter: expectedAfter(input.before, input.parentAccountId),
    immutableStateHash: input.before ? immutableAccountStateHash(input.before) : null,
  };
  return { ...base, recordHash: sha256(base) };
}

export function classifyRentalRelationshipRow(
  spec: (typeof RENTAL_RELATIONSHIP_CANARY_SPECS)[number],
  account: RentalRelationshipAccountSnapshot | null,
  parent: RentalRelationshipAccountSnapshot | null,
): RentalRelationshipManifestRow {
  const reviewFlags: string[] = [];
  if (!account) reviewFlags.push("target_account_missing");
  if (!parent) reviewFlags.push("parent_account_missing");

  if (account) {
    if (normaliseIdentity(account.canonicalName) !== normaliseIdentity(spec.expectedAccountName)) {
      reviewFlags.push("target_identity_mismatch");
    }
    if ((account.country || "").toUpperCase() !== "AU") reviewFlags.push("target_not_australian");
    if (account.recordStatus !== "active") reviewFlags.push("target_not_active");
    if (account.mergedIntoAccountId !== null) reviewFlags.push("target_already_merged");
  }

  if (parent) {
    const parentIdentity = normaliseIdentity(`${parent.canonicalName} ${parent.displayName || ""}`);
    if (!parentIdentity.includes(normaliseIdentity(spec.expectedParentIdentityToken))) {
      reviewFlags.push("parent_identity_mismatch");
    }
    if ((parent.country || "").toUpperCase() !== "AU") reviewFlags.push("parent_not_australian");
    if (parent.recordStatus !== "active") reviewFlags.push("parent_not_active");
    if (!parent.countsTowardPotential) reviewFlags.push("parent_not_counting");
    if (parent.mergedIntoAccountId !== null) reviewFlags.push("parent_already_merged");
    if (parent.relationshipType === "duplicate") reviewFlags.push("parent_is_duplicate");
  }

  if (!account || !parent || reviewFlags.length > 0) {
    return rowResult({
      accountId: spec.accountId,
      parentAccountId: spec.parentAccountId,
      disposition: "manual_review",
      reason: "The target or parent account does not satisfy the fixed identity and lifecycle gates.",
      reviewFlags,
      before: account,
      parent,
    });
  }

  const alreadyAttached = account.parentAccountId === spec.parentAccountId
    && account.mergedIntoAccountId === null
    && account.relationshipType === RENTAL_RELATIONSHIP_TYPE
    && account.recordStatus === "active"
    && account.countsTowardPotential === false;
  if (alreadyAttached) {
    return rowResult({
      accountId: spec.accountId,
      parentAccountId: spec.parentAccountId,
      disposition: "already_attached",
      reason: "The account already matches the approved strategic-context relationship state.",
      reviewFlags: [],
      before: account,
      parent,
    });
  }

  const safeBefore = account.parentAccountId === null
    && account.mergedIntoAccountId === null
    && account.relationshipType === "standalone"
    && account.recordStatus === "active"
    && account.countsTowardPotential === true;
  if (safeBefore) {
    return rowResult({
      accountId: spec.accountId,
      parentAccountId: spec.parentAccountId,
      disposition: "safe_attach_context",
      reason: "The active counting account can be converted to non-counting strategic context under the reviewed canonical parent.",
      reviewFlags: [],
      before: account,
      parent,
    });
  }

  return rowResult({
    accountId: spec.accountId,
    parentAccountId: spec.parentAccountId,
    disposition: "manual_review",
    reason: "The account is neither in the exact reviewed pre-apply state nor the exact expected post-apply state.",
    reviewFlags: ["unexpected_relationship_state"],
    before: account,
    parent,
  });
}

export function expectedPreApplyWorkspaceFailures(
  summary: RentalRelationshipWorkspaceSummary,
): string[] {
  const failures: string[] = [];
  if (summary.totalRentalRows !== 76) failures.push(`totalRentalRows=${summary.totalRentalRows}; expected 76`);
  if (summary.totalRentalAccounts !== 76) failures.push(`totalRentalAccounts=${summary.totalRentalAccounts}; expected 76`);
  if (summary.tierA !== 17) failures.push(`tierA=${summary.tierA}; expected 17`);
  if (summary.pushNow !== 12) failures.push(`pushNow=${summary.pushNow}; expected 12`);
  if (summary.directAccounts !== 66) failures.push(`directAccounts=${summary.directAccounts}; expected 66`);
  if (summary.channelAccounts !== 2) failures.push(`channelAccounts=${summary.channelAccounts}; expected 2`);
  if (summary.nonCountingContextRecords !== 0) failures.push(`nonCountingContextRecords=${summary.nonCountingContextRecords}; expected 0`);
  if (summary.attachedContextRecords !== 0) failures.push(`attachedContextRecords=${summary.attachedContextRecords}; expected 0`);
  if (summary.unattachedContextRecords !== 0) failures.push(`unattachedContextRecords=${summary.unattachedContextRecords}; expected 0`);
  if ((summary.routeDistribution.direct_ape || 0) !== 66) failures.push(`route direct_ape=${summary.routeDistribution.direct_ape || 0}; expected 66`);
  if ((summary.routeDistribution.manual_review || 0) !== 8) failures.push(`route manual_review=${summary.routeDistribution.manual_review || 0}; expected 8`);
  if ((summary.routeDistribution.cea || 0) !== 2) failures.push(`route cea=${summary.routeDistribution.cea || 0}; expected 2`);
  for (const accountId of RENTAL_RELATIONSHIP_CANARY_ACCOUNT_IDS) {
    if (!summary.topLevelAccountIds.includes(accountId)) failures.push(`target ${accountId} is not a top-level account`);
  }
  for (const parentId of RENTAL_RELATIONSHIP_PARENT_ACCOUNT_IDS) {
    if (!summary.topLevelAccountIds.includes(parentId)) failures.push(`parent ${parentId} is not a top-level account`);
  }
  return failures;
}

export function expectedPostApplyWorkspaceFailures(
  summary: RentalRelationshipWorkspaceSummary,
): string[] {
  const failures: string[] = [];
  if (summary.totalRentalRows !== 76) failures.push(`totalRentalRows=${summary.totalRentalRows}; expected 76`);
  if (summary.totalRentalAccounts !== 74) failures.push(`totalRentalAccounts=${summary.totalRentalAccounts}; expected 74`);
  if (summary.tierA !== 15) failures.push(`tierA=${summary.tierA}; expected 15`);
  if (summary.pushNow !== 12) failures.push(`pushNow=${summary.pushNow}; expected 12`);
  if (summary.directAccounts !== 65) failures.push(`directAccounts=${summary.directAccounts}; expected 65`);
  if (summary.channelAccounts !== 1) failures.push(`channelAccounts=${summary.channelAccounts}; expected 1`);
  if (summary.nonCountingContextRecords !== 2) failures.push(`nonCountingContextRecords=${summary.nonCountingContextRecords}; expected 2`);
  if (summary.attachedContextRecords !== 2) failures.push(`attachedContextRecords=${summary.attachedContextRecords}; expected 2`);
  if (summary.unattachedContextRecords !== 0) failures.push(`unattachedContextRecords=${summary.unattachedContextRecords}; expected 0`);
  if ((summary.routeDistribution.direct_ape || 0) !== 65) failures.push(`route direct_ape=${summary.routeDistribution.direct_ape || 0}; expected 65`);
  if ((summary.routeDistribution.manual_review || 0) !== 8) failures.push(`route manual_review=${summary.routeDistribution.manual_review || 0}; expected 8`);
  if ((summary.routeDistribution.cea || 0) !== 1) failures.push(`route cea=${summary.routeDistribution.cea || 0}; expected 1`);
  for (const accountId of RENTAL_RELATIONSHIP_CANARY_ACCOUNT_IDS) {
    if (summary.topLevelAccountIds.includes(accountId)) failures.push(`target ${accountId} remains top-level`);
  }
  if (!(summary.parentContextAccountIds["269"] || []).includes(328)) failures.push("parent 269 does not contain context account 328");
  if (!(summary.parentContextAccountIds["415"] || []).includes(334)) failures.push("parent 415 does not contain context account 334");
  return failures;
}

export function buildRentalRelationshipManifestSummary(
  rows: readonly RentalRelationshipManifestRow[],
  workspaceBefore: RentalRelationshipWorkspaceSummary,
): RentalRelationshipManifestSummary {
  const preApplyWorkspaceFailures = expectedPreApplyWorkspaceFailures(workspaceBefore);
  return {
    targetRows: rows.length,
    safeAttachContext: rows.filter(row => row.disposition === "safe_attach_context").length,
    alreadyAttached: rows.filter(row => row.disposition === "already_attached").length,
    manualReview: rows.filter(row => row.disposition === "manual_review").length,
    approvedRows: rows.filter(row => row.approved).length,
    preApplyWorkspaceChecksPassed: preApplyWorkspaceFailures.length === 0,
    preApplyWorkspaceFailures,
    workspaceBefore,
  };
}

export function sealRentalRelationshipManifest(
  draft: RentalRelationshipManifestDraft,
  sealedAt = new Date().toISOString(),
): RentalRelationshipManifestSealed {
  if (draft.schemaVersion !== RENTAL_RELATIONSHIP_MANIFEST_VERSION || draft.sealed !== false) {
    throw new Error("Only an unsealed Rental relationship manifest draft can be sealed");
  }

  for (const row of draft.rows) {
    const { recordHash, ...rowWithoutHash } = row;
    if (sha256({ ...rowWithoutHash, approved: false }) !== recordHash) {
      throw new Error(`Account ${row.accountId}: manifest row changed outside the approved flag`);
    }
    if (row.approved && row.disposition !== "safe_attach_context") {
      throw new Error(`Account ${row.accountId}: disposition ${row.disposition} cannot be approved`);
    }
  }

  const approvedIds = draft.rows.filter(row => row.approved).map(row => row.accountId).sort((a, b) => a - b);
  if (approvedIds.length > 0 && stableStringify(approvedIds) !== stableStringify([...RENTAL_RELATIONSHIP_CANARY_ACCOUNT_IDS])) {
    throw new Error(`Approved account IDs must be exactly ${RENTAL_RELATIONSHIP_CANARY_ACCOUNT_IDS.join(",")}`);
  }

  const withoutHash = {
    ...draft,
    summary: { ...draft.summary, approvedRows: approvedIds.length },
    sealed: true as const,
    sealedAt,
  };
  return { ...withoutHash, manifestHash: sha256(withoutHash) };
}

export function verifySealedRentalRelationshipManifest(
  manifest: RentalRelationshipManifestSealed,
): boolean {
  const { manifestHash, ...withoutHash } = manifest;
  return manifest.schemaVersion === RENTAL_RELATIONSHIP_MANIFEST_VERSION
    && manifest.sealed === true
    && sha256(withoutHash) === manifestHash;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : stableStringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function rentalRelationshipManifestRowsToCsv(
  rows: readonly RentalRelationshipManifestRow[],
): string {
  const header = [
    "accountId",
    "accountName",
    "parentAccountId",
    "parentName",
    "disposition",
    "approved",
    "reason",
    "reviewFlags",
    "parentAccountIdBefore",
    "relationshipTypeBefore",
    "countsTowardPotentialBefore",
    "parentAccountIdAfter",
    "relationshipTypeAfter",
    "countsTowardPotentialAfter",
    "immutableStateHash",
    "recordHash",
  ].join(",");
  const body = rows.map(row => [
    row.accountId,
    csvCell(row.before?.canonicalName),
    row.parentAccountId,
    csvCell(row.parent?.canonicalName),
    row.disposition,
    row.approved,
    csvCell(row.reason),
    csvCell(row.reviewFlags.join(";")),
    row.before?.parentAccountId ?? "",
    row.before?.relationshipType ?? "",
    row.before?.countsTowardPotential ?? "",
    row.expectedAfter.parentAccountId,
    row.expectedAfter.relationshipType,
    row.expectedAfter.countsTowardPotential,
    row.immutableStateHash || "",
    row.recordHash,
  ].join(","));
  return `${header}\n${body.join("\n")}\n`;
}
