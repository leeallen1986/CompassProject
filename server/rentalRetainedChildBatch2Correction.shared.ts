import {
  immutableRetainedChildAccountHash,
  normaliseRetainedChildIdentity,
  sha256RetainedChild,
  stableStringifyRetainedChild,
  type RentalRetainedChildAccountSnapshot,
  type RentalRetainedChildApplySnapshot,
  type RentalRetainedChildWorkspaceSummary,
} from "./rentalRetainedChildReconciliation.shared";

export const RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_MANIFEST_VERSION = 4 as const;
export const RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_BATCH_ID = "retained-child-batch-2-corrected" as const;
export const RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS = [278, 352] as const;
export const RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_PARENT_IDS = [269, 275] as const;
export const RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_RELATIONSHIP_TYPE = "strategic_context" as const;
export const REJECTED_KENNARDS_CHILD_ID = 332 as const;
export const UNITED_RENTALS_ACCOUNT_ID = 272 as const;

export interface RentalRetainedChildBatch2CorrectionSpec {
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

export const RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_SPECS = [
  {
    accountId: 278,
    expectedAccountName: "Coates Industrial Solutions",
    expectedAccountRowClass: "account",
    expectedState: "National",
    expectedRouteToMarket: "direct_ape",
    expectedPriorityTier: "tier_a",
    expectedPlatformPushDecision: "push_now",
    parentAccountId: 269,
    expectedParentIdentityToken: "coates hire",
    expectedParentRowClass: "account",
    relationshipBasis: "Industrial and specialist division of the Coates group with a separate compressed-air buying authority.",
  },
  {
    accountId: 352,
    expectedAccountName: "Tutt Bryant Equipment",
    expectedAccountRowClass: "account",
    expectedState: "National",
    expectedRouteToMarket: "manual_review",
    expectedPriorityTier: "tier_c",
    expectedPlatformPushDecision: "channel_view",
    parentAccountId: 275,
    expectedParentIdentityToken: "tutt bryant hire",
    expectedParentRowClass: "account",
    relationshipBasis: "Separate legal entity and buying authority within the Tutt Bryant group; route remains manual review.",
  },
] as const satisfies readonly RentalRetainedChildBatch2CorrectionSpec[];

export type RentalRetainedChildBatch2CorrectionDisposition =
  | "safe_link_retained_child_batch2_corrected"
  | "already_linked_retained_child_batch2_corrected"
  | "manual_review";

export interface RentalRetainedChildBatch2CorrectionExpectedState {
  parentAccountId: number;
  mergedIntoAccountId: null;
  relationshipType: typeof RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_RELATIONSHIP_TYPE;
  recordStatus: string | null;
  countsTowardPotential: true;
}

export interface RentalRetainedChildBatch2CorrectionManifestRow {
  accountId: number;
  parentAccountId: number;
  sourceDisposition: "retain_child";
  relationshipBasis: string;
  approved: boolean;
  disposition: RentalRetainedChildBatch2CorrectionDisposition;
  reason: string;
  reviewFlags: string[];
  before: RentalRetainedChildAccountSnapshot | null;
  parent: RentalRetainedChildAccountSnapshot | null;
  expectedAfter: RentalRetainedChildBatch2CorrectionExpectedState;
  immutableStateHash: string | null;
  recordHash: string;
}

export interface RentalRetainedChildBatch2CorrectionManifestSummary {
  targetRows: number;
  safeLinkRetainedChildBatch2Corrected: number;
  alreadyLinkedRetainedChildBatch2Corrected: number;
  manualReview: number;
  approvedRows: number;
  pr78ContinuityChecksPassed: boolean;
  pr78ContinuityFailures: string[];
  kennardsUnitedRentalsSeparationChecksPassed: boolean;
  kennardsUnitedRentalsSeparationFailures: string[];
  preApplyWorkspaceChecksPassed: boolean;
  preApplyWorkspaceFailures: string[];
  workspaceBefore: RentalRetainedChildWorkspaceSummary;
}

export interface RentalRetainedChildBatch2CorrectionManifestDraft {
  schemaVersion: typeof RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_MANIFEST_VERSION;
  batchId: typeof RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_BATCH_ID;
  generatedAt: string;
  databaseIdentity: string;
  databaseFingerprint: string;
  sealed: false;
  summary: RentalRetainedChildBatch2CorrectionManifestSummary;
  rows: RentalRetainedChildBatch2CorrectionManifestRow[];
}

export interface RentalRetainedChildBatch2CorrectionManifestSealed
  extends Omit<RentalRetainedChildBatch2CorrectionManifestDraft, "sealed"> {
  sealed: true;
  sealedAt: string;
  manifestHash: string;
}

export type RentalRetainedChildBatch2CorrectionApplySnapshot = RentalRetainedChildApplySnapshot;
export type RentalRetainedChildBatch2CorrectionAccountSnapshot = RentalRetainedChildAccountSnapshot;
export type RentalRetainedChildBatch2CorrectionWorkspaceSummary = RentalRetainedChildWorkspaceSummary;

function expectedAfter(
  account: RentalRetainedChildAccountSnapshot | null,
  parentAccountId: number,
): RentalRetainedChildBatch2CorrectionExpectedState {
  return {
    parentAccountId,
    mergedIntoAccountId: null,
    relationshipType: RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_RELATIONSHIP_TYPE,
    recordStatus: account?.recordStatus ?? null,
    countsTowardPotential: true,
  };
}

function rowResult(input: {
  spec: RentalRetainedChildBatch2CorrectionSpec;
  disposition: RentalRetainedChildBatch2CorrectionDisposition;
  reason: string;
  reviewFlags: string[];
  before: RentalRetainedChildAccountSnapshot | null;
  parent: RentalRetainedChildAccountSnapshot | null;
}): RentalRetainedChildBatch2CorrectionManifestRow {
  const base = {
    accountId: input.spec.accountId,
    parentAccountId: input.spec.parentAccountId,
    sourceDisposition: "retain_child" as const,
    relationshipBasis: input.spec.relationshipBasis,
    approved: false,
    disposition: input.disposition,
    reason: input.reason,
    reviewFlags: Array.from(new Set(input.reviewFlags)).sort(),
    before: input.before,
    parent: input.parent,
    expectedAfter: expectedAfter(input.before, input.spec.parentAccountId),
    immutableStateHash: input.before?.fullImmutableStateHash ?? null,
  };
  return { ...base, recordHash: sha256RetainedChild(base) };
}

export function classifyRentalRetainedChildBatch2CorrectionRow(
  spec: RentalRetainedChildBatch2CorrectionSpec,
  account: RentalRetainedChildAccountSnapshot | null,
  parent: RentalRetainedChildAccountSnapshot | null,
): RentalRetainedChildBatch2CorrectionManifestRow {
  const reviewFlags: string[] = [];
  if (!account) reviewFlags.push("target_account_missing");
  if (!parent) reviewFlags.push("parent_account_missing");

  if (account) {
    if (normaliseRetainedChildIdentity(account.canonicalName)
      !== normaliseRetainedChildIdentity(spec.expectedAccountName)) {
      reviewFlags.push("target_identity_mismatch");
    }
    if ((account.country || "").toUpperCase() !== "AU") reviewFlags.push("target_not_australian");
    if (account.state !== spec.expectedState) reviewFlags.push("target_state_mismatch");
    if (account.rowClass !== spec.expectedAccountRowClass) reviewFlags.push("target_row_class_mismatch");
    if (account.routeToMarket !== spec.expectedRouteToMarket) reviewFlags.push("target_route_mismatch");
    if (account.priorityTier !== spec.expectedPriorityTier) reviewFlags.push("target_priority_mismatch");
    if (account.platformPushDecision !== spec.expectedPlatformPushDecision) reviewFlags.push("target_push_decision_mismatch");
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
    if (parent.rowClass !== spec.expectedParentRowClass) reviewFlags.push("parent_row_class_mismatch");
    if (parent.recordStatus !== "active") reviewFlags.push("parent_not_active");
    if (!parent.countsTowardPotential) reviewFlags.push("parent_not_counting");
    if (parent.mergedIntoAccountId !== null) reviewFlags.push("parent_already_merged");
    if (parent.relationshipType === "duplicate") reviewFlags.push("parent_is_duplicate");
  }

  if (!account || !parent || reviewFlags.length > 0) {
    return rowResult({
      spec,
      disposition: "manual_review",
      reason: "The target or parent does not match the corrected retained-child batch-2 identity and commercial-state gates.",
      reviewFlags,
      before: account,
      parent,
    });
  }

  const alreadyLinked = account.parentAccountId === spec.parentAccountId
    && account.mergedIntoAccountId === null
    && account.relationshipType === RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_RELATIONSHIP_TYPE
    && account.recordStatus === "active"
    && account.countsTowardPotential === true;
  if (alreadyLinked) {
    return rowResult({
      spec,
      disposition: "already_linked_retained_child_batch2_corrected",
      reason: "The retained child already has the reviewed parent link and remains an independently counting engagement account.",
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
      spec,
      disposition: "safe_link_retained_child_batch2_corrected",
      reason: "The reviewed legitimate child can be linked to its parent without changing its counting, route, ownership or engagement status.",
      reviewFlags: [],
      before: account,
      parent,
    });
  }

  return rowResult({
    spec,
    disposition: "manual_review",
    reason: "The child is neither in the exact reviewed pre-link state nor the exact corrected retained-child batch-2 post-link state.",
    reviewFlags: ["unexpected_relationship_state"],
    before: account,
    parent,
  });
}

export function expectedPr78ContinuityFailures(
  accountsById: ReadonlyMap<number, RentalRetainedChildAccountSnapshot>,
): string[] {
  const failures: string[] = [];
  const checks = [
    { accountId: 328, parentAccountId: 269 },
    { accountId: 334, parentAccountId: 415 },
  ];
  for (const check of checks) {
    const account = accountsById.get(check.accountId);
    if (!account) {
      failures.push(`PR78 retained child ${check.accountId} is missing`);
      continue;
    }
    if (account.parentAccountId !== check.parentAccountId) failures.push(`PR78 retained child ${check.accountId} parent=${account.parentAccountId}; expected ${check.parentAccountId}`);
    if (account.relationshipType !== "strategic_context") failures.push(`PR78 retained child ${check.accountId} relationshipType=${account.relationshipType}; expected strategic_context`);
    if (!account.countsTowardPotential) failures.push(`PR78 retained child ${check.accountId} is not counting`);
    if (account.recordStatus !== "active") failures.push(`PR78 retained child ${check.accountId} is not active`);
    if (account.mergedIntoAccountId !== null) failures.push(`PR78 retained child ${check.accountId} is merged`);
  }
  for (const parentId of [269, 415]) {
    const parent = accountsById.get(parentId);
    if (!parent) failures.push(`PR78 parent ${parentId} is missing`);
    else {
      if (parent.recordStatus !== "active") failures.push(`PR78 parent ${parentId} is not active`);
      if (!parent.countsTowardPotential) failures.push(`PR78 parent ${parentId} is not counting`);
      if (parent.mergedIntoAccountId !== null) failures.push(`PR78 parent ${parentId} is merged`);
    }
  }
  return failures;
}

export function expectedKennardsUnitedRentalsSeparationFailures(
  accountsById: ReadonlyMap<number, RentalRetainedChildAccountSnapshot>,
): string[] {
  const failures: string[] = [];
  const unitedRentals = accountsById.get(UNITED_RENTALS_ACCOUNT_ID);
  const kennards = accountsById.get(REJECTED_KENNARDS_CHILD_ID);

  if (!unitedRentals) {
    failures.push("United Rentals account 272 is missing");
  } else {
    const identity = normaliseRetainedChildIdentity(
      `${unitedRentals.canonicalName} ${unitedRentals.displayName || ""}`,
    );
    if (!identity.includes("united rentals")) failures.push("account 272 identity is not United Rentals");
    if ((unitedRentals.country || "").toUpperCase() !== "AU") failures.push("United Rentals account 272 is not Australian");
    if (unitedRentals.recordStatus !== "active") failures.push("United Rentals account 272 is not active");
    if (!unitedRentals.countsTowardPotential) failures.push("United Rentals account 272 is not counting");
    if (unitedRentals.mergedIntoAccountId !== null) failures.push("United Rentals account 272 is merged");
  }

  if (!kennards) {
    failures.push("Kennards Hire account 332 is missing");
  } else {
    if (normaliseRetainedChildIdentity(kennards.canonicalName) !== "kennards hire") failures.push("account 332 identity is not Kennards Hire");
    if ((kennards.country || "").toUpperCase() !== "AU") failures.push("Kennards Hire account 332 is not Australian");
    if (kennards.state !== "National") failures.push("Kennards Hire account 332 state is not National");
    if (kennards.rowClass !== "channel_managed") failures.push("Kennards Hire account 332 rowClass is not channel_managed");
    if (kennards.routeToMarket !== "direct_ape") failures.push("Kennards Hire account 332 route is not direct_ape");
    if (kennards.priorityTier !== "tier_a") failures.push("Kennards Hire account 332 priority is not tier_a");
    if (kennards.platformPushDecision !== "channel_view") failures.push("Kennards Hire account 332 push decision is not channel_view");
    if (kennards.parentAccountId !== null) failures.push(`Kennards Hire account 332 parent=${kennards.parentAccountId}; expected null`);
    if (kennards.relationshipType !== "standalone") failures.push(`Kennards Hire account 332 relationshipType=${kennards.relationshipType}; expected standalone`);
    if (kennards.recordStatus !== "active") failures.push("Kennards Hire account 332 is not active");
    if (!kennards.countsTowardPotential) failures.push("Kennards Hire account 332 is not counting");
    if (kennards.mergedIntoAccountId !== null) failures.push("Kennards Hire account 332 is merged");
  }

  return failures;
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
  for (const accountId of RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS) {
    if (!summary.topLevelAccountIds.includes(accountId)) failures.push(`corrected batch-2 retained child ${accountId} is not top-level`);
  }
  for (const parentId of RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_PARENT_IDS) {
    if (!summary.topLevelAccountIds.includes(parentId)) failures.push(`corrected batch-2 parent ${parentId} is not top-level`);
  }
  for (const protectedId of [UNITED_RENTALS_ACCOUNT_ID, REJECTED_KENNARDS_CHILD_ID]) {
    if (!summary.topLevelAccountIds.includes(protectedId)) failures.push(`protected standalone account ${protectedId} is not top-level`);
  }
  return failures;
}

export function expectedRetainedChildBatch2CorrectionPreApplyFailures(
  summary: RentalRetainedChildWorkspaceSummary,
): string[] {
  return commonWorkspaceFailures(summary);
}

export function expectedRetainedChildBatch2CorrectionPostApplyFailures(
  summary: RentalRetainedChildWorkspaceSummary,
): string[] {
  return commonWorkspaceFailures(summary);
}

export function buildRentalRetainedChildBatch2CorrectionManifestSummary(
  rows: readonly RentalRetainedChildBatch2CorrectionManifestRow[],
  workspaceBefore: RentalRetainedChildWorkspaceSummary,
  pr78ContinuityFailures: string[],
  kennardsUnitedRentalsSeparationFailures: string[],
): RentalRetainedChildBatch2CorrectionManifestSummary {
  const preApplyWorkspaceFailures = expectedRetainedChildBatch2CorrectionPreApplyFailures(workspaceBefore);
  return {
    targetRows: rows.length,
    safeLinkRetainedChildBatch2Corrected: rows.filter(row => row.disposition === "safe_link_retained_child_batch2_corrected").length,
    alreadyLinkedRetainedChildBatch2Corrected: rows.filter(row => row.disposition === "already_linked_retained_child_batch2_corrected").length,
    manualReview: rows.filter(row => row.disposition === "manual_review").length,
    approvedRows: rows.filter(row => row.approved).length,
    pr78ContinuityChecksPassed: pr78ContinuityFailures.length === 0,
    pr78ContinuityFailures,
    kennardsUnitedRentalsSeparationChecksPassed: kennardsUnitedRentalsSeparationFailures.length === 0,
    kennardsUnitedRentalsSeparationFailures,
    preApplyWorkspaceChecksPassed: preApplyWorkspaceFailures.length === 0,
    preApplyWorkspaceFailures,
    workspaceBefore,
  };
}

export function sealRentalRetainedChildBatch2CorrectionManifest(
  draft: RentalRetainedChildBatch2CorrectionManifestDraft,
  sealedAt = new Date().toISOString(),
): RentalRetainedChildBatch2CorrectionManifestSealed {
  if (draft.schemaVersion !== RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_MANIFEST_VERSION
    || draft.batchId !== RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_BATCH_ID
    || draft.sealed !== false) {
    throw new Error("Only an unsealed corrected retained-child batch-2 manifest v4 draft can be sealed");
  }

  for (const row of draft.rows) {
    const { recordHash, ...rowWithoutHash } = row;
    if (sha256RetainedChild({ ...rowWithoutHash, approved: false }) !== recordHash) {
      throw new Error(`Account ${row.accountId}: manifest row changed outside the approved flag`);
    }
    if (row.approved && row.disposition !== "safe_link_retained_child_batch2_corrected") {
      throw new Error(`Account ${row.accountId}: disposition ${row.disposition} cannot be approved`);
    }
  }

  const approvedIds = draft.rows
    .filter(row => row.approved)
    .map(row => row.accountId)
    .sort((left, right) => left - right);
  if (approvedIds.length > 0
    && stableStringifyRetainedChild(approvedIds)
      !== stableStringifyRetainedChild([...RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS])) {
    throw new Error(`Approved account IDs must be exactly ${RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS.join(",")}`);
  }
  if (approvedIds.length > 0 && !draft.summary.pr78ContinuityChecksPassed) {
    throw new Error(`PR78 continuity failed: ${draft.summary.pr78ContinuityFailures.join("; ")}`);
  }
  if (approvedIds.length > 0 && !draft.summary.kennardsUnitedRentalsSeparationChecksPassed) {
    throw new Error(`Kennards/United Rentals separation failed: ${draft.summary.kennardsUnitedRentalsSeparationFailures.join("; ")}`);
  }
  if (approvedIds.length > 0 && !draft.summary.preApplyWorkspaceChecksPassed) {
    throw new Error(`Corrected batch-2 workspace gates failed: ${draft.summary.preApplyWorkspaceFailures.join("; ")}`);
  }

  const withoutHash = {
    ...draft,
    summary: { ...draft.summary, approvedRows: approvedIds.length },
    sealed: true as const,
    sealedAt,
  };
  return { ...withoutHash, manifestHash: sha256RetainedChild(withoutHash) };
}

export function verifySealedRentalRetainedChildBatch2CorrectionManifest(
  manifest: RentalRetainedChildBatch2CorrectionManifestSealed,
): boolean {
  const { manifestHash, ...withoutHash } = manifest;
  return manifest.schemaVersion === RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_MANIFEST_VERSION
    && manifest.batchId === RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_BATCH_ID
    && manifest.sealed === true
    && sha256RetainedChild(withoutHash) === manifestHash;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : stableStringifyRetainedChild(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function rentalRetainedChildBatch2CorrectionRowsToCsv(
  rows: readonly RentalRetainedChildBatch2CorrectionManifestRow[],
): string {
  const header = [
    "accountId",
    "accountName",
    "parentAccountId",
    "parentName",
    "sourceDisposition",
    "relationshipBasis",
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
    "routeToMarket",
    "priorityTier",
    "platformPushDecision",
    "immutableStateHash",
    "recordHash",
  ].join(",");
  const body = rows.map(row => [
    row.accountId,
    csvCell(row.before?.canonicalName),
    row.parentAccountId,
    csvCell(row.parent?.canonicalName),
    row.sourceDisposition,
    csvCell(row.relationshipBasis),
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
    row.before?.routeToMarket ?? "",
    row.before?.priorityTier ?? "",
    row.before?.platformPushDecision ?? "",
    row.immutableStateHash || "",
    row.recordHash,
  ].join(","));
  return `${header}\n${body.join("\n")}\n`;
}

export { immutableRetainedChildAccountHash, sha256RetainedChild, stableStringifyRetainedChild };
