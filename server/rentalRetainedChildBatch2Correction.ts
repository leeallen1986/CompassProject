import { and, eq, inArray, isNull } from "drizzle-orm";
import { fullPotentialAccounts, pipelineRuns } from "../drizzle/schema";
import { getDb } from "./db";
import { loadRentalRelationshipDataset } from "./rentalAccountRelationshipReconciliation";
import { toRentalRetainedChildAccountSnapshot } from "./rentalRetainedChildReconciliation";
import {
  REJECTED_KENNARDS_CHILD_ID,
  RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS,
  RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_BATCH_ID,
  RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_MANIFEST_VERSION,
  RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_PARENT_IDS,
  RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_RELATIONSHIP_TYPE,
  RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_SPECS,
  UNITED_RENTALS_ACCOUNT_ID,
  buildRentalRetainedChildBatch2CorrectionManifestSummary,
  classifyRentalRetainedChildBatch2CorrectionRow,
  expectedKennardsUnitedRentalsSeparationFailures,
  expectedPr78ContinuityFailures,
  expectedRetainedChildBatch2CorrectionPostApplyFailures,
  sha256RetainedChild,
  verifySealedRentalRetainedChildBatch2CorrectionManifest,
  type RentalRetainedChildBatch2CorrectionApplySnapshot,
  type RentalRetainedChildBatch2CorrectionManifestDraft,
  type RentalRetainedChildBatch2CorrectionManifestRow,
  type RentalRetainedChildBatch2CorrectionManifestSealed,
  type RentalRetainedChildBatch2CorrectionWorkspaceSummary,
} from "./rentalRetainedChildBatch2Correction.shared";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type AccountRow = typeof fullPotentialAccounts.$inferSelect;

export interface RentalRetainedChildBatch2CorrectionApplyResult {
  manifestHash: string;
  databaseFingerprintBefore: string;
  activePipelineRunsBefore: number;
  alreadyApplied: boolean;
  selected: number;
  applied: number;
  skipped: number;
  accountIds: number[];
  before: RentalRetainedChildBatch2CorrectionApplySnapshot[];
  after: RentalRetainedChildBatch2CorrectionApplySnapshot[];
  workspaceBefore: RentalRetainedChildBatch2CorrectionWorkspaceSummary;
  workspaceAfter: RentalRetainedChildBatch2CorrectionWorkspaceSummary;
  pr78ContinuityFailuresBefore: string[];
  pr78ContinuityFailuresAfter: string[];
  kennardsUnitedRentalsSeparationFailuresBefore: string[];
  kennardsUnitedRentalsSeparationFailuresAfter: string[];
  correctedBatch2DispositionsAfter: Record<string, string>;
  postApplyWorkspaceFailures: string[];
}

function toWorkspaceSummary(
  source: Awaited<ReturnType<typeof loadRentalRelationshipDataset>>["workspace"],
): RentalRetainedChildBatch2CorrectionWorkspaceSummary {
  return {
    totalRentalRows: source.totalRentalRows,
    totalRentalAccounts: source.totalRentalAccounts,
    tierA: source.tierA,
    pushNow: source.pushNow,
    directAccounts: source.directAccounts,
    channelAccounts: source.channelAccounts,
    nonCountingContextRecords: source.nonCountingContextRecords,
    attachedContextRecords: source.attachedContextRecords,
    unattachedContextRecords: source.unattachedContextRecords,
    routeDistribution: source.routeDistribution,
    topLevelAccountIds: source.topLevelAccountIds,
  };
}

function snapshotsById(accounts: readonly AccountRow[]) {
  return new Map(accounts.map(row => [row.id, toRentalRetainedChildAccountSnapshot(row)]));
}

export function buildRentalRetainedChildBatch2CorrectionManifestRows(
  accounts: readonly AccountRow[],
): RentalRetainedChildBatch2CorrectionManifestRow[] {
  const byId = snapshotsById(accounts);
  return RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_SPECS.map(spec =>
    classifyRentalRetainedChildBatch2CorrectionRow(
      spec,
      byId.get(spec.accountId) || null,
      byId.get(spec.parentAccountId) || null,
    ),
  ).sort((left, right) => left.accountId - right.accountId);
}

export async function generateRentalRetainedChildBatch2CorrectionManifest(
  dbOverride?: Db,
): Promise<RentalRetainedChildBatch2CorrectionManifestDraft> {
  const dataset = await loadRentalRelationshipDataset(dbOverride);
  const rows = buildRentalRetainedChildBatch2CorrectionManifestRows(dataset.accounts);
  const byId = snapshotsById(dataset.accounts);
  const pr78ContinuityFailures = expectedPr78ContinuityFailures(byId);
  const kennardsUnitedRentalsSeparationFailures = expectedKennardsUnitedRentalsSeparationFailures(byId);
  const workspace = toWorkspaceSummary(dataset.workspace);
  return {
    schemaVersion: RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_MANIFEST_VERSION,
    batchId: RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_BATCH_ID,
    generatedAt: new Date().toISOString(),
    databaseIdentity: dataset.databaseIdentity,
    databaseFingerprint: dataset.databaseFingerprint,
    sealed: false,
    summary: buildRentalRetainedChildBatch2CorrectionManifestSummary(
      rows,
      workspace,
      pr78ContinuityFailures,
      kennardsUnitedRentalsSeparationFailures,
    ),
    rows,
  };
}

function toApplySnapshot(row: AccountRow): RentalRetainedChildBatch2CorrectionApplySnapshot {
  const snapshot = toRentalRetainedChildAccountSnapshot(row);
  return {
    accountId: snapshot.id,
    parentAccountId: snapshot.parentAccountId,
    mergedIntoAccountId: snapshot.mergedIntoAccountId,
    relationshipType: snapshot.relationshipType,
    recordStatus: snapshot.recordStatus,
    countsTowardPotential: snapshot.countsTowardPotential,
    immutableStateHash: snapshot.fullImmutableStateHash,
  };
}

async function readApplySnapshots(
  db: Db | any,
  accountIds: readonly number[],
): Promise<RentalRetainedChildBatch2CorrectionApplySnapshot[]> {
  const rows = await db.select().from(fullPotentialAccounts)
    .where(inArray(fullPotentialAccounts.id, [...accountIds]));
  return (rows as AccountRow[])
    .map(toApplySnapshot)
    .sort((left, right) => left.accountId - right.accountId);
}

function selectedApprovedRows(
  manifest: RentalRetainedChildBatch2CorrectionManifestSealed,
): RentalRetainedChildBatch2CorrectionManifestRow[] {
  const rows = manifest.rows
    .filter(row => row.approved)
    .sort((left, right) => left.accountId - right.accountId);
  const actualIds = rows.map(row => row.accountId);
  const expectedIds = [...RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS];
  if (sha256RetainedChild(actualIds) !== sha256RetainedChild(expectedIds)) {
    throw new Error(`Approved account IDs must be exactly ${expectedIds.join(",")}`);
  }
  if (rows.some(row => row.disposition !== "safe_link_retained_child_batch2_corrected")) {
    throw new Error("Only safe_link_retained_child_batch2_corrected rows may be applied");
  }
  return rows;
}

function assertExpectedAfter(
  snapshot: RentalRetainedChildBatch2CorrectionApplySnapshot,
  row: RentalRetainedChildBatch2CorrectionManifestRow,
): void {
  if (
    snapshot.parentAccountId !== row.expectedAfter.parentAccountId
    || snapshot.mergedIntoAccountId !== null
    || snapshot.relationshipType !== row.expectedAfter.relationshipType
    || snapshot.recordStatus !== row.expectedAfter.recordStatus
    || snapshot.countsTowardPotential !== true
  ) {
    throw new Error(`Account ${row.accountId} did not reach its corrected batch-2 retained-child state`);
  }
  if (snapshot.immutableStateHash !== row.immutableStateHash) {
    throw new Error(`Account ${row.accountId} changed outside parentAccountId and relationshipType`);
  }
}

async function activePipelineCount(db: Db | any): Promise<number> {
  const rows = await db.select({ id: pipelineRuns.id }).from(pipelineRuns)
    .where(eq(pipelineRuns.status, "running"));
  return rows.length;
}

function dispositionsByAccountId(
  rows: readonly RentalRetainedChildBatch2CorrectionManifestRow[],
) {
  return Object.fromEntries(rows.map(row => [String(row.accountId), row.disposition]));
}

export async function applyRentalRetainedChildBatch2CorrectionManifest(
  manifest: RentalRetainedChildBatch2CorrectionManifestSealed,
  confirmHash: string,
  dbOverride?: Db,
): Promise<RentalRetainedChildBatch2CorrectionApplyResult> {
  if (!verifySealedRentalRetainedChildBatch2CorrectionManifest(manifest)) {
    throw new Error("Corrected retained-child batch-2 manifest hash verification failed");
  }
  if (confirmHash !== manifest.manifestHash) {
    throw new Error("--confirm-hash does not match the sealed corrected batch-2 manifest hash");
  }
  const selectedRows = selectedApprovedRows(manifest);
  const db = dbOverride || await getDb();
  if (!db) throw new Error("Database unavailable");

  const activePipelineRunsBefore = await activePipelineCount(db);
  if (activePipelineRunsBefore !== 0) {
    throw new Error(`Cannot apply while ${activePipelineRunsBefore} pipeline run(s) are active`);
  }

  const currentDataset = await loadRentalRelationshipDataset(db);
  if (currentDataset.databaseIdentity !== manifest.databaseIdentity) {
    throw new Error("Corrected retained-child batch-2 manifest belongs to a different database");
  }
  const currentRows = buildRentalRetainedChildBatch2CorrectionManifestRows(currentDataset.accounts);
  const currentRowsById = new Map(currentRows.map(row => [row.accountId, row]));
  const currentById = snapshotsById(currentDataset.accounts);
  const workspaceBefore = toWorkspaceSummary(currentDataset.workspace);
  const pr78ContinuityFailuresBefore = expectedPr78ContinuityFailures(currentById);
  const kennardsUnitedRentalsSeparationFailuresBefore = expectedKennardsUnitedRentalsSeparationFailures(currentById);

  const alreadyApplied = selectedRows.every(row =>
    currentRowsById.get(row.accountId)?.disposition
      === "already_linked_retained_child_batch2_corrected");
  if (alreadyApplied) {
    for (const selected of selectedRows) {
      const current = currentRowsById.get(selected.accountId);
      if (!current || current.immutableStateHash !== selected.immutableStateHash) {
        throw new Error(`Account ${selected.accountId} immutable state differs from the sealed corrected batch-2 manifest`);
      }
      if (current.parent?.fullImmutableStateHash !== selected.parent?.fullImmutableStateHash) {
        throw new Error(`Parent ${selected.parentAccountId} immutable state differs from the sealed corrected batch-2 manifest`);
      }
    }
    const postFailures = expectedRetainedChildBatch2CorrectionPostApplyFailures(workspaceBefore);
    if (pr78ContinuityFailuresBefore.length > 0
      || kennardsUnitedRentalsSeparationFailuresBefore.length > 0
      || postFailures.length > 0) {
      throw new Error(`Corrected batch 2 is linked but continuity is inconsistent: ${[
        ...pr78ContinuityFailuresBefore,
        ...kennardsUnitedRentalsSeparationFailuresBefore,
        ...postFailures,
      ].join("; ")}`);
    }
    const snapshots = await readApplySnapshots(
      db,
      RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS,
    );
    return {
      manifestHash: manifest.manifestHash,
      databaseFingerprintBefore: currentDataset.databaseFingerprint,
      activePipelineRunsBefore,
      alreadyApplied: true,
      selected: selectedRows.length,
      applied: 0,
      skipped: selectedRows.length,
      accountIds: [...RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS],
      before: snapshots,
      after: snapshots,
      workspaceBefore,
      workspaceAfter: workspaceBefore,
      pr78ContinuityFailuresBefore,
      pr78ContinuityFailuresAfter: pr78ContinuityFailuresBefore,
      kennardsUnitedRentalsSeparationFailuresBefore,
      kennardsUnitedRentalsSeparationFailuresAfter: kennardsUnitedRentalsSeparationFailuresBefore,
      correctedBatch2DispositionsAfter: dispositionsByAccountId(currentRows),
      postApplyWorkspaceFailures: [],
    };
  }

  if (!manifest.summary.pr78ContinuityChecksPassed) {
    throw new Error(`Sealed manifest failed PR78 continuity: ${manifest.summary.pr78ContinuityFailures.join("; ")}`);
  }
  if (!manifest.summary.kennardsUnitedRentalsSeparationChecksPassed) {
    throw new Error(`Sealed manifest failed Kennards/United Rentals separation: ${manifest.summary.kennardsUnitedRentalsSeparationFailures.join("; ")}`);
  }
  if (!manifest.summary.preApplyWorkspaceChecksPassed) {
    throw new Error(`Sealed corrected batch-2 manifest failed workspace gates: ${manifest.summary.preApplyWorkspaceFailures.join("; ")}`);
  }
  const currentDraft = await generateRentalRetainedChildBatch2CorrectionManifest(db);
  if (!currentDraft.summary.pr78ContinuityChecksPassed) {
    throw new Error(`Current PR78 continuity failed: ${currentDraft.summary.pr78ContinuityFailures.join("; ")}`);
  }
  if (!currentDraft.summary.kennardsUnitedRentalsSeparationChecksPassed) {
    throw new Error(`Current Kennards/United Rentals separation failed: ${currentDraft.summary.kennardsUnitedRentalsSeparationFailures.join("; ")}`);
  }
  if (!currentDraft.summary.preApplyWorkspaceChecksPassed) {
    throw new Error(`Current workspace failed corrected batch-2 gates: ${currentDraft.summary.preApplyWorkspaceFailures.join("; ")}`);
  }
  if (currentDataset.databaseFingerprint !== manifest.databaseFingerprint) {
    throw new Error("Account, action or signal state differs from the sealed corrected batch-2 manifest");
  }
  for (const selected of selectedRows) {
    const current = currentRowsById.get(selected.accountId);
    if (!current || current.recordHash !== selected.recordHash) {
      throw new Error(`Account ${selected.accountId} changed after corrected batch-2 manifest generation`);
    }
  }

  const before = await readApplySnapshots(
    db,
    RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS,
  );
  const lockIds = Array.from(new Set([
    ...RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS,
    ...RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_PARENT_IDS,
    REJECTED_KENNARDS_CHILD_ID,
    UNITED_RENTALS_ACCOUNT_ID,
  ])).sort((left, right) => left - right);

  const transactionResult = await db.transaction(async (tx: any) => {
    const activeInsideTransaction = await activePipelineCount(tx);
    if (activeInsideTransaction !== 0) {
      throw new Error(`Pipeline activity began before corrected retained-child batch-2 linking: ${activeInsideTransaction} active`);
    }

    const lockedRows = await tx.select().from(fullPotentialAccounts)
      .where(inArray(fullPotentialAccounts.id, lockIds))
      .for("update");
    if (lockedRows.length !== lockIds.length) {
      throw new Error(`Expected to lock ${lockIds.length} target/parent/protected rows; locked ${lockedRows.length}`);
    }

    const transactionDataset = await loadRentalRelationshipDataset(tx);
    if (transactionDataset.databaseFingerprint !== manifest.databaseFingerprint) {
      throw new Error("Corrected retained-child batch-2 state changed before account locks were acquired");
    }
    const transactionById = snapshotsById(transactionDataset.accounts);
    const transactionContinuityFailures = expectedPr78ContinuityFailures(transactionById);
    const transactionKennardsFailures = expectedKennardsUnitedRentalsSeparationFailures(transactionById);
    if (transactionContinuityFailures.length > 0 || transactionKennardsFailures.length > 0) {
      throw new Error(`Continuity changed before corrected batch-2 apply: ${[
        ...transactionContinuityFailures,
        ...transactionKennardsFailures,
      ].join("; ")}`);
    }

    for (const row of selectedRows) {
      await tx.update(fullPotentialAccounts).set({
        parentAccountId: row.expectedAfter.parentAccountId,
        relationshipType: RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_RELATIONSHIP_TYPE,
      }).where(and(
        eq(fullPotentialAccounts.id, row.accountId),
        isNull(fullPotentialAccounts.parentAccountId),
        isNull(fullPotentialAccounts.mergedIntoAccountId),
        eq(fullPotentialAccounts.relationshipType, "standalone"),
        eq(fullPotentialAccounts.recordStatus, "active"),
        eq(fullPotentialAccounts.countsTowardPotential, true),
      ));

      const current = await readApplySnapshots(tx, [row.accountId]);
      if (current.length !== 1) throw new Error(`Account ${row.accountId} is missing after corrected batch-2 update`);
      assertExpectedAfter(current[0], row);
    }

    const afterDataset = await loadRentalRelationshipDataset(tx);
    const workspaceAfter = toWorkspaceSummary(afterDataset.workspace);
    const postApplyWorkspaceFailures = expectedRetainedChildBatch2CorrectionPostApplyFailures(
      workspaceAfter,
    );
    const afterById = snapshotsById(afterDataset.accounts);
    const pr78ContinuityFailuresAfter = expectedPr78ContinuityFailures(afterById);
    const kennardsUnitedRentalsSeparationFailuresAfter = expectedKennardsUnitedRentalsSeparationFailures(afterById);
    const afterRows = buildRentalRetainedChildBatch2CorrectionManifestRows(afterDataset.accounts);
    const invalidAfterRows = afterRows.filter(row =>
      row.disposition !== "already_linked_retained_child_batch2_corrected");
    if (invalidAfterRows.length > 0) {
      throw new Error(`Corrected batch-2 post-link dispositions failed for ${invalidAfterRows.map(row => row.accountId).join(",")}`);
    }
    if (postApplyWorkspaceFailures.length > 0
      || pr78ContinuityFailuresAfter.length > 0
      || kennardsUnitedRentalsSeparationFailuresAfter.length > 0) {
      throw new Error(`Post-link corrected batch-2 assertion failed: ${[
        ...postApplyWorkspaceFailures,
        ...pr78ContinuityFailuresAfter,
        ...kennardsUnitedRentalsSeparationFailuresAfter,
      ].join("; ")}`);
    }

    return {
      workspaceAfter,
      pr78ContinuityFailuresAfter,
      kennardsUnitedRentalsSeparationFailuresAfter,
      correctedBatch2DispositionsAfter: dispositionsByAccountId(afterRows),
      postApplyWorkspaceFailures,
    };
  });

  const after = await readApplySnapshots(
    db,
    RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS,
  );
  for (const row of selectedRows) {
    const snapshot = after.find(item => item.accountId === row.accountId);
    if (!snapshot) throw new Error(`Account ${row.accountId} is missing after corrected batch-2 apply`);
    assertExpectedAfter(snapshot, row);
  }

  return {
    manifestHash: manifest.manifestHash,
    databaseFingerprintBefore: currentDataset.databaseFingerprint,
    activePipelineRunsBefore,
    alreadyApplied: false,
    selected: selectedRows.length,
    applied: selectedRows.length,
    skipped: 0,
    accountIds: [...RENTAL_RETAINED_CHILD_BATCH2_CORRECTION_ACCOUNT_IDS],
    before,
    after,
    workspaceBefore,
    workspaceAfter: transactionResult.workspaceAfter,
    pr78ContinuityFailuresBefore,
    pr78ContinuityFailuresAfter: transactionResult.pr78ContinuityFailuresAfter,
    kennardsUnitedRentalsSeparationFailuresBefore,
    kennardsUnitedRentalsSeparationFailuresAfter: transactionResult.kennardsUnitedRentalsSeparationFailuresAfter,
    correctedBatch2DispositionsAfter: transactionResult.correctedBatch2DispositionsAfter,
    postApplyWorkspaceFailures: transactionResult.postApplyWorkspaceFailures,
  };
}
