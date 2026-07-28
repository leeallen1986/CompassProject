import { createHash } from "node:crypto";

export const RENTAL_RETAINED_CHILD_MANIFEST_VERSION = 2 as const;
export const RENTAL_RETAINED_CHILD_ACCOUNT_IDS = [328, 334] as const;
export const RENTAL_RETAINED_CHILD_PARENT_IDS = [269, 415] as const;
export const RENTAL_RETAINED_CHILD_RELATIONSHIP_TYPE = "strategic_context" as const;

export const RENTAL_RETAINED_CHILD_SPECS = [
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

export type RentalRetainedChildDisposition =
  | "safe_link_retained_child"
  | "already_linked_retained_child"
  | "manual_review";

export interface RentalRetainedChildAccountSnapshot {
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

export interface RentalRetainedChildExpectedState {
  parentAccountId: number;
  mergedIntoAccountId: null;
  relationshipType: typeof RENTAL_RETAINED_CHILD_RELATIONSHIP_TYPE;
  recordStatus: string | null;
  countsTowardPotential: true;
}

export interface RentalRetainedChildManifestRow {
  accountId: number;
  parentAccountId: number;
  approved: boolean;
  disposition: RentalRetainedChildDisposition;
  reason: string;
  reviewFlags: string[];
  before: RentalRetainedChildAccountSnapshot | null;
  parent: RentalRetainedChildAccountSnapshot | null;
  expectedAfter: RentalRetainedChildExpectedState;
  immutableStateHash: string | null;
  recordHash: string;
}

export interface RentalRetainedChildWorkspaceSummary {
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
}

export interface RentalRetainedChildManifestSummary {
  targetRows: number;
  safeLinkRetainedChild: number;
  alreadyLinkedRetainedChild: number;
  manualReview: number;
  approvedRows: number;
  preApplyWorkspaceChecksPassed: boolean;
  preApplyWorkspaceFailures: string[];
  workspaceBefore: RentalRetainedChildWorkspaceSummary;
}

export interface RentalRetainedChildManifestDraft {
  schemaVersion: typeof RENTAL_RETAINED_CHILD_MANIFEST_VERSION;
  generatedAt: string;
  databaseIdentity: string;
  databaseFingerprint: string;
  sealed: false;
  summary: RentalRetainedChildManifestSummary;
  rows: RentalRetainedChildManifestRow[];
}

export interface RentalRetainedChildManifestSealed
  extends Omit<RentalRetainedChildManifestDraft, "sealed"> {
  sealed: true;
  sealedAt: string;
  manifestHash: string;
}

export interface RentalRetainedChildApplySnapshot {
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

export function stableStringifyRetainedChild(value: unknown): string {
  return JSON.stringify(normaliseScalar(value));
}

export function sha256RetainedChild(value: unknown): string {
  return createHash("sha256").update(stableStringifyRetainedChild(value)).digest("hex");
}

export function normaliseRetainedChildIdentity(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * The retained-child correction authorises only parentAccountId,
 * relationshipType and the database-managed updatedAt timestamp to change.
 * countsTowardPotential is intentionally immutable and must remain true.
 */
export function immutableRetainedChildAccountHash(
  record: Record<string, unknown>,
): string {
  const {
    parentAccountId: _parentAccountId,
    relationshipType: _relationshipType,
    updatedAt: _updatedAt,
    ...immutable
  } = record;
  return sha256RetainedChild(immutable);
}

function expectedAfter(
  account: RentalRetainedChildAccountSnapshot | null,
  parentAccountId: number,
): RentalRetainedChildExpectedState {
  return {
    parentAccountId,
    mergedIntoAccountId: null,
    relationshipType: RENTAL_RETAINED_CHILD_RELATIONSHIP_TYPE,
    recordStatus: account?.recordStatus ?? null,
    countsTowardPotential: true,
  };
}

function rowResult(input: {
  accountId: number;
  parentAccountId: number;
  disposition: RentalRetainedChildDisposition;
  reason: string;
  reviewFlags: string[];
  before: RentalRetainedChildAccountSnapshot | null;
  parent: RentalRetainedChildAccountSnapshot | null;
}): RentalRetainedChildManifestRow {
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
    immutableStateHash: input.before?.fullImmutableStateHash ?? null,
  };
  return { ...base, recordHash: sha256RetainedChild(base) };
}

export function classifyRentalRetainedChildRow(
  spec: (typeof RENTAL_RETAINED_CHILD_SPECS)[number],
  account: RentalRetainedChildAccountSnapshot | null,
  parent: RentalRetainedChildAccountSnapshot | null,
): RentalRetainedChildManifestRow {
  const reviewFlags: string[] = [];
  if (!account) reviewFlags.push("target_account_missing");
  if (!parent) reviewFlags.push("parent_account_missing");

  if (account) {
    if (normaliseRetainedChildIdentity(account.canonicalName)
      !== normaliseRetainedChildIdentity(spec.expectedAccountName)) {
      reviewFlags.push("target_identity_mismatch");
    }
    if ((account.country || "").toUpperCase() !== "AU") reviewFlags.push("target_not_australian");
    if (account.recordStatus !== "active") reviewFlags.push("target_not_active");
    if (account.mergedIntoAccountId !== null) reviewFlags.push("target_already_merged");
    if (!account.countsTowardPotential) reviewFlags.push("target_not_counting");
  }

  if (parent) {
    const parentIdentity = normaliseRetainedChildIdentity(
      `${parent.canonicalName} ${parent.displayName || ""}`,
    );
    if (!parentIdentity.includes(normaliseRetainedChildIdentity(spec.expectedParentIdentityToken))) {
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
      reason: "The target or parent does not satisfy the retained-child identity, lifecycle and counting gates.",
      reviewFlags,
      before: account,
      parent,
    });
  }

  const alreadyLinked = account.parentAccountId === spec.parentAccountId
    && account.mergedIntoAccountId === null
    && account.relationshipType === RENTAL_RETAINED_CHILD_RELATIONSHIP_TYPE
    && account.recordStatus === "active"
    && account.countsTowardPotential === true;
  if (alreadyLinked) {
    return rowResult({
      accountId: spec.accountId,
      parentAccountId: spec.parentAccountId,
      disposition: "already_linked_retained_child",
      reason: "The retained child already has the reviewed parent link and remains a counting engagement account.",
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
      disposition: "safe_link_retained_child",
      reason: "The reviewed legitimate child can be linked to its parent without changing its counting or engagement status.",
      reviewFlags: [],
      before: account,
      parent,
    });
  }

  return rowResult({
    accountId: spec.accountId,
    parentAccountId: spec.parentAccountId,
    disposition: "manual_review",
    reason: "The child is neither in the exact reviewed pre-link state nor the exact retained-child post-link state.",
    reviewFlags: ["unexpected_relationship_state"],
    before: account,
    parent,
  });
}

function commonWorkspaceFailures(
  summary: RentalRetainedChildWorkspaceSummary,
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
  for (const accountId of RENTAL_RETAINED_CHILD_ACCOUNT_IDS) {
    if (!summary.topLevelAccountIds.includes(accountId)) failures.push(`retained child ${accountId} is not top-level`);
  }
  for (const parentId of RENTAL_RETAINED_CHILD_PARENT_IDS) {
    if (!summary.topLevelAccountIds.includes(parentId)) failures.push(`parent ${parentId} is not top-level`);
  }
  return failures;
}

export function expectedRetainedChildPreApplyFailures(
  summary: RentalRetainedChildWorkspaceSummary,
): string[] {
  return commonWorkspaceFailures(summary);
}

export function expectedRetainedChildPostApplyFailures(
  summary: RentalRetainedChildWorkspaceSummary,
): string[] {
  return commonWorkspaceFailures(summary);
}

export function buildRentalRetainedChildManifestSummary(
  rows: readonly RentalRetainedChildManifestRow[],
  workspaceBefore: RentalRetainedChildWorkspaceSummary,
): RentalRetainedChildManifestSummary {
  const preApplyWorkspaceFailures = expectedRetainedChildPreApplyFailures(workspaceBefore);
  return {
    targetRows: rows.length,
    safeLinkRetainedChild: rows.filter(row => row.disposition === "safe_link_retained_child").length,
    alreadyLinkedRetainedChild: rows.filter(row => row.disposition === "already_linked_retained_child").length,
    manualReview: rows.filter(row => row.disposition === "manual_review").length,
    approvedRows: rows.filter(row => row.approved).length,
    preApplyWorkspaceChecksPassed: preApplyWorkspaceFailures.length === 0,
    preApplyWorkspaceFailures,
    workspaceBefore,
  };
}

export function sealRentalRetainedChildManifest(
  draft: RentalRetainedChildManifestDraft,
  sealedAt = new Date().toISOString(),
): RentalRetainedChildManifestSealed {
  if (draft.schemaVersion !== RENTAL_RETAINED_CHILD_MANIFEST_VERSION || draft.sealed !== false) {
    throw new Error("Only an unsealed Rental retained-child manifest v2 draft can be sealed");
  }

  for (const row of draft.rows) {
    const { recordHash, ...rowWithoutHash } = row;
    if (sha256RetainedChild({ ...rowWithoutHash, approved: false }) !== recordHash) {
      throw new Error(`Account ${row.accountId}: manifest row changed outside the approved flag`);
    }
    if (row.approved && row.disposition !== "safe_link_retained_child") {
      throw new Error(`Account ${row.accountId}: disposition ${row.disposition} cannot be approved`);
    }
  }

  const approvedIds = draft.rows
    .filter(row => row.approved)
    .map(row => row.accountId)
    .sort((left, right) => left - right);
  if (approvedIds.length > 0
    && stableStringifyRetainedChild(approvedIds)
      !== stableStringifyRetainedChild([...RENTAL_RETAINED_CHILD_ACCOUNT_IDS])) {
    throw new Error(`Approved account IDs must be exactly ${RENTAL_RETAINED_CHILD_ACCOUNT_IDS.join(",")}`);
  }

  const withoutHash = {
    ...draft,
    summary: { ...draft.summary, approvedRows: approvedIds.length },
    sealed: true as const,
    sealedAt,
  };
  return { ...withoutHash, manifestHash: sha256RetainedChild(withoutHash) };
}

export function verifySealedRentalRetainedChildManifest(
  manifest: RentalRetainedChildManifestSealed,
): boolean {
  const { manifestHash, ...withoutHash } = manifest;
  return manifest.schemaVersion === RENTAL_RETAINED_CHILD_MANIFEST_VERSION
    && manifest.sealed === true
    && sha256RetainedChild(withoutHash) === manifestHash;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : stableStringifyRetainedChild(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function rentalRetainedChildRowsToCsv(
  rows: readonly RentalRetainedChildManifestRow[],
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
