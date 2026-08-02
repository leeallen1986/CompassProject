import {
  immutableRetainedChildAccountHash,
  sha256RetainedChild,
  stableStringifyRetainedChild,
  type RentalRetainedChildAccountSnapshot,
  type RentalRetainedChildApplySnapshot,
  type RentalRetainedChildWorkspaceSummary,
} from "./rentalRetainedChildReconciliation.shared";

/**
 * PR #79 V3 is retained only as an explicit tombstone so historic artifacts
 * can be identified and rejected. It must never generate, seal or apply.
 */
export const RENTAL_RETAINED_CHILD_BATCH2_MANIFEST_VERSION = 3 as const;
export const RENTAL_RETAINED_CHILD_BATCH2_ACCOUNT_IDS = [278, 332, 352] as const;
export const RENTAL_RETAINED_CHILD_BATCH2_PARENT_IDS = [269, 272, 275] as const;
export const RENTAL_RETAINED_CHILD_BATCH2_RELATIONSHIP_TYPE = "strategic_context" as const;
export const RENTAL_RETAINED_CHILD_BATCH2_RETIRED = true as const;
export const RENTAL_RETAINED_CHILD_BATCH2_RETIREMENT_REASON =
  "PR #79 V3 is retired because account 272 is United Rentals, not Kennards Hire; the proposed 332 -> 272 relationship is false." as const;

export interface RentalRetainedChildBatch2Spec {
  accountId: number;
  expectedAccountName: string;
  expectedAccountRowClass: string;
  expectedState: string;
  expectedRouteToMarket: string;
  expectedPriorityTier: string;
  expectedPlatformPushDecision: string;
  parentAccountId: number;
  expectedParentIdentityToken: string;
  expectedParentRowClass: string;
  relationshipBasis: string;
}

export const RENTAL_RETAINED_CHILD_BATCH2_SPECS = [] as const satisfies readonly RentalRetainedChildBatch2Spec[];

export type RentalRetainedChildBatch2Disposition = "manual_review";

export interface RentalRetainedChildBatch2ExpectedState {
  parentAccountId: number;
  mergedIntoAccountId: null;
  relationshipType: typeof RENTAL_RETAINED_CHILD_BATCH2_RELATIONSHIP_TYPE;
  recordStatus: string | null;
  countsTowardPotential: true;
}

export interface RentalRetainedChildBatch2ManifestRow {
  accountId: number;
  parentAccountId: number;
  sourceDisposition: "retain_child";
  relationshipBasis: string;
  approved: boolean;
  disposition: RentalRetainedChildBatch2Disposition;
  reason: string;
  reviewFlags: string[];
  before: RentalRetainedChildAccountSnapshot | null;
  parent: RentalRetainedChildAccountSnapshot | null;
  expectedAfter: RentalRetainedChildBatch2ExpectedState;
  immutableStateHash: string | null;
  recordHash: string;
}

export interface RentalRetainedChildBatch2ManifestSummary {
  targetRows: number;
  safeLinkRetainedChildBatch2: number;
  alreadyLinkedRetainedChildBatch2: number;
  manualReview: number;
  approvedRows: number;
  pr78ContinuityChecksPassed: boolean;
  pr78ContinuityFailures: string[];
  preApplyWorkspaceChecksPassed: boolean;
  preApplyWorkspaceFailures: string[];
  workspaceBefore: RentalRetainedChildWorkspaceSummary;
}

export interface RentalRetainedChildBatch2ManifestDraft {
  schemaVersion: typeof RENTAL_RETAINED_CHILD_BATCH2_MANIFEST_VERSION;
  batchId: "retained-child-batch-2";
  generatedAt: string;
  databaseIdentity: string;
  databaseFingerprint: string;
  sealed: false;
  summary: RentalRetainedChildBatch2ManifestSummary;
  rows: RentalRetainedChildBatch2ManifestRow[];
}

export interface RentalRetainedChildBatch2ManifestSealed
  extends Omit<RentalRetainedChildBatch2ManifestDraft, "sealed"> {
  sealed: true;
  sealedAt: string;
  manifestHash: string;
}

export type RentalRetainedChildBatch2ApplySnapshot = RentalRetainedChildApplySnapshot;
export type RentalRetainedChildBatch2AccountSnapshot = RentalRetainedChildAccountSnapshot;
export type RentalRetainedChildBatch2WorkspaceSummary = RentalRetainedChildWorkspaceSummary;

export function retiredRentalRetainedChildBatch2Error(): Error {
  return new Error(RENTAL_RETAINED_CHILD_BATCH2_RETIREMENT_REASON);
}

export function classifyRentalRetainedChildBatch2Row(
  spec: RentalRetainedChildBatch2Spec,
  account: RentalRetainedChildAccountSnapshot | null,
  parent: RentalRetainedChildAccountSnapshot | null,
): RentalRetainedChildBatch2ManifestRow {
  const base = {
    accountId: spec.accountId,
    parentAccountId: spec.parentAccountId,
    sourceDisposition: "retain_child" as const,
    relationshipBasis: spec.relationshipBasis,
    approved: false,
    disposition: "manual_review" as const,
    reason: RENTAL_RETAINED_CHILD_BATCH2_RETIREMENT_REASON,
    reviewFlags: ["retired_manifest_version", "rejected_kennards_united_rentals_mapping"],
    before: account,
    parent,
    expectedAfter: {
      parentAccountId: spec.parentAccountId,
      mergedIntoAccountId: null,
      relationshipType: RENTAL_RETAINED_CHILD_BATCH2_RELATIONSHIP_TYPE,
      recordStatus: account?.recordStatus ?? null,
      countsTowardPotential: true as const,
    },
    immutableStateHash: account?.fullImmutableStateHash ?? null,
  };
  return { ...base, recordHash: sha256RetainedChild(base) };
}

export function expectedPr78ContinuityFailures(): string[] {
  return [RENTAL_RETAINED_CHILD_BATCH2_RETIREMENT_REASON];
}

export function expectedRetainedChildBatch2PreApplyFailures(): string[] {
  return [RENTAL_RETAINED_CHILD_BATCH2_RETIREMENT_REASON];
}

export function expectedRetainedChildBatch2PostApplyFailures(): string[] {
  return [RENTAL_RETAINED_CHILD_BATCH2_RETIREMENT_REASON];
}

export function buildRentalRetainedChildBatch2ManifestSummary(
  rows: readonly RentalRetainedChildBatch2ManifestRow[],
  workspaceBefore: RentalRetainedChildWorkspaceSummary,
): RentalRetainedChildBatch2ManifestSummary {
  return {
    targetRows: rows.length,
    safeLinkRetainedChildBatch2: 0,
    alreadyLinkedRetainedChildBatch2: 0,
    manualReview: rows.length,
    approvedRows: 0,
    pr78ContinuityChecksPassed: false,
    pr78ContinuityFailures: [RENTAL_RETAINED_CHILD_BATCH2_RETIREMENT_REASON],
    preApplyWorkspaceChecksPassed: false,
    preApplyWorkspaceFailures: [RENTAL_RETAINED_CHILD_BATCH2_RETIREMENT_REASON],
    workspaceBefore,
  };
}

export function sealRentalRetainedChildBatch2Manifest(
  _draft: RentalRetainedChildBatch2ManifestDraft,
): RentalRetainedChildBatch2ManifestSealed {
  throw retiredRentalRetainedChildBatch2Error();
}

export function verifySealedRentalRetainedChildBatch2Manifest(
  _manifest: RentalRetainedChildBatch2ManifestSealed,
): boolean {
  return false;
}

export function rentalRetainedChildBatch2RowsToCsv(
  rows: readonly RentalRetainedChildBatch2ManifestRow[],
): string {
  const header = "accountId,disposition,approved,reason,reviewFlags,recordHash";
  const body = rows.map(row => [
    row.accountId,
    row.disposition,
    row.approved,
    JSON.stringify(row.reason),
    JSON.stringify(row.reviewFlags.join(";")),
    row.recordHash,
  ].join(","));
  return `${header}\n${body.join("\n")}\n`;
}

export { immutableRetainedChildAccountHash, sha256RetainedChild, stableStringifyRetainedChild };
