import { and, eq, inArray, isNull } from "drizzle-orm";
import { fullPotentialAccounts, pipelineRuns } from "../drizzle/schema";
import { getDb } from "./db";
import { loadRentalRelationshipDataset } from "./rentalAccountRelationshipReconciliation";
import { toRentalRetainedChildAccountSnapshot } from "./rentalRetainedChildReconciliation";
import {
  RENTAL_RETAINED_CHILD_BATCH2_ACCOUNT_IDS,
  RENTAL_RETAINED_CHILD_BATCH2_MANIFEST_VERSION,
  RENTAL_RETAINED_CHILD_BATCH2_PARENT_IDS,
  RENTAL_RETAINED_CHILD_BATCH2_RELATIONSHIP_TYPE,
  RENTAL_RETAINED_CHILD_BATCH2_SPECS,
  buildRentalRetainedChildBatch2ManifestSummary,
  classifyRentalRetainedChildBatch2Row,
  expectedPr78ContinuityFailures,
  expectedRetainedChildBatch2PostApplyFailures,
  sha256RetainedChild,
  verifySealedRentalRetainedChildBatch2Manifest,
  type RentalRetainedChildBatch2ApplySnapshot,
  type RentalRetainedChildBatch2ManifestDraft,
  type RentalRetainedChildBatch2ManifestRow,
  type RentalRetainedChildBatch2ManifestSealed,
  type RentalRetainedChildBatch2WorkspaceSummary,
} from "./rentalRetainedChildBatch2Reconciliation.shared";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type AccountRow = typeof fullPotentialAccounts.$inferSelect;

export interface RentalRetainedChildBatch2ApplyResult {
  manifestHash: string;
  databaseFingerprintBefore: string;
  activePipelineRunsBefore: number;
  alreadyApplied: boolean;
  selected: number;
  applied: number;
  skipped: number;
  accountIds: number[];
  before: RentalRetainedChildBatch2ApplySnapshot[];
  after: RentalRetainedChildBatch2ApplySnapshot[];
  workspaceBefore: RentalRetainedChildBatch2WorkspaceSummary;
  workspaceAfter: RentalRetainedChildBatch2WorkspaceSummary;
  pr78ContinuityFailuresBefore: string[];
  pr78ContinuityFailuresAfter: string[];
  batch2DispositionsAfter: Record<string, string>;
  postApplyWorkspaceFailures: string[];
}

function toWorkspaceSummary(
  source: Awaited<ReturnType<typeof loadRentalRelationshipDataset>>["workspace"],
): RentalRetainedChildBatch2WorkspaceSummary {
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

export function buildRentalRetainedChildBatch2ManifestRows(
  accounts: readonly AccountRow[],
): RentalRetainedChildBatch2ManifestRow[] {
  const byId = snapshotsById(accounts);
  return RENTAL_RETAINED_CHILD_BATCH2_SPECS.map(spec =>
    classifyRentalRetainedChildBatch2Row(
      spec,
      byId.get(spec.accountId) || null,
      byId.get(spec.parentAccountId) || null,
    ),
  ).sort((left, right) => left.accountId - right.accountId);
}

export async function generateRentalRetainedChildBatch2Manifest(
  dbOverride?: Db,
): Promise<RentalRetainedChildBatch2ManifestDraft> {
  const dataset = await loadRentalRelationshipDataset(dbOverride);
  const rows = buildRentalRetainedChildBatch2ManifestRows(dataset.accounts);
  const continuityFailures = expectedPr78ContinuityFailures(snapshotsById(dataset.accounts));
  const workspace = toWorkspaceSummary(dataset.workspace);
  return {
    schemaVersion: RENTAL_RETAINED_CHILD_BATCH2_MANIFEST_VERSION,
    batchId: "retained-child-batch-2",
    generatedAt: new Date().toISOString(),
    databaseIdentity: dataset.databaseIdentity,
    databaseFingerprint: dataset.databaseFingerprint,
    sealed: false,
    summary: buildRentalRetainedChildBatch2ManifestSummary(
      rows,
      workspace,
      continuityFailures,
    ),
    rows,
  };
}

function toApplySnapshot(row: AccountRow): RentalRetainedChildBatch2ApplySnapshot {
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
): Promise<RentalRetainedChildBatch2ApplySnapshot[]> {
  const rows = await db.select().from(fullPotentialAccounts)
    .where(inArray(fullPotentialAccounts.id, [...accountIds]));
  return (rows as AccountRow[])
    .map(toApplySnapshot)
    .sort((left, right) => left.accountId - right.accountId);
}

function selectedApprovedRows(
  manifest: RentalRetainedChildBatch2ManifestSealed,
): RentalRetainedChildBatch2ManifestRow[] {
  const rows = manifest.rows
    .filter(row => row.approved)
    .sort((left, right) => left.accountId - right.accountId);
  const actualIds = rows.map(row => row.accountId);
  const expectedIds = [...RENTAL_RETAINED_CHILD_BATCH2_ACCOUNT_IDS];
  if (sha256RetainedChild(actualIds) !== sha256RetainedChild(expectedIds)) {
    throw new Error(`Approved account IDs must be exactly ${expectedIds.join(",")}`);
  }
  if (rows.some(row => row.disposition !== "safe_link_retained_child_batch2")) {
    throw new Error("Only safe_link_retained_child_batch2 rows may be applied");
  }
  return rows;
}

function assertExpectedAfter(
  snapshot: RentalRetainedChildBatch2ApplySnapshot,
  row: RentalRetainedChildBatch2ManifestRow,
): void {
  if (
    snapshot.parentAccountId !== row.expectedAfter.parentAccountId
    || snapshot.mergedIntoAccountId !== null
    || snapshot.relationshipType !== row.expectedAfter.relationshipType
    || snapshot.recordStatus !== row.expectedAfter.recordStatus
    || snapshot.countsTowardPotential !== true
  ) {
    throw new Error(`Account ${row.accountId} did not reach its batch-2 retained-child state`);
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

function dispositionsByAccountId(rows: readonly RentalRetainedChildBatch2ManifestRow[]) {
  return Object.fromEntries(rows.map(row => [String(row.accountId), row.disposition]));
}

export async function applyRentalRetainedChildBatch2Manifest(
  manifest: RentalRetainedChildBatch2ManifestSealed,
  confirmHash: string,
  dbOverride?: Db,
): Promise<RentalRetainedChildBatch2ApplyResult> {
  if (!verifySealedRentalRetainedChildBatch2Manifest(manifest)) {
    throw new Error("Retained-child batch-2 manifest hash verification failed");
  }
  if (confirmHash !== manifest.manifestHash) {
    throw new Error("--confirm-hash does not match the sealed batch-2 manifest hash");
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
    throw new Error("Retained-child batch-2 manifest belongs to a different database");
  }
  const currentRows = buildRentalRetainedChildBatch2ManifestRows(currentDataset.accounts);
  const currentRowsById = new Map(currentRows.map(row => [row.accountId, row]));
  const workspaceBefore = toWorkspaceSummary(currentDataset.workspace);
  const pr78ContinuityFailuresBefore = expectedPr78ContinuityFailures(
    snapshotsById(currentDataset.accounts),
  );

  const alreadyApplied = selectedRows.every(row =>
    currentRowsById.get(row.accountId)?.disposition
      === "already_linked_retained_child_batch2");
  if (alreadyApplied) {
    for (const selected of selectedRows) {
      const current = currentRowsById.get(selected.accountId);
      if (!current || current.immutableStateHash !== selected.immutableStateHash) {
        throw new Error(`Account ${selected.accountId} immutable state differs from the sealed batch-2 manifest`);
      }
      if (current.parent?.fullImmutableStateHash !== selected.parent?.fullImmutableStateHash) {
        throw new Error(`Parent ${selected.parentAccountId} immutable state differs from the sealed batch-2 manifest`);
      }
    }
    const postFailures = expectedRetainedChildBatch2PostApplyFailures(workspaceBefore);
    if (pr78ContinuityFailuresBefore.length > 0 || postFailures.length > 0) {
      throw new Error(`Batch 2 is linked but continuity is inconsistent: ${[
        ...pr78ContinuityFailuresBefore,
        ...postFailures,
      ].join("; ")}`);
    }
    const snapshots = await readApplySnapshots(db, RENTAL_RETAINED_CHILD_BATCH2_ACCOUNT_IDS);
    return {
      manifestHash: manifest.manifestHash,
      databaseFingerprintBefore: currentDataset.databaseFingerprint,
      activePipelineRunsBefore,
      alreadyApplied: true,
      selected: selectedRows.length,
      applied: 0,
      skipped: selectedRows.length,
      accountIds: [...RENTAL_RETAINED_CHILD_BATCH2_ACCOUNT_IDS],
      before: snapshots,
      after: snapshots,
      workspaceBefore,
      workspaceAfter: workspaceBefore,
      pr78ContinuityFailuresBefore,
      pr78ContinuityFailuresAfter: pr78ContinuityFailuresBefore,
      batch2DispositionsAfter: dispositionsByAccountId(currentRows),
      postApplyWorkspaceFailures: [],
    };
  }

  if (!manifest.summary.pr78ContinuityChecksPassed) {
    throw new Error(`Sealed manifest failed PR78 continuity: ${manifest.summary.pr78ContinuityFailures.join("; ")}`);
  }
  if (!manifest.summary.preApplyWorkspaceChecksPassed) {
    throw new Error(`Sealed batch-2 manifest failed workspace gates: ${manifest.summary.preApplyWorkspaceFailures.join("; ")}`);
  }
  const currentDraft = await generateRentalRetainedChildBatch2Manifest(db);
  if (!currentDraft.summary.pr78ContinuityChecksPassed) {
    throw new Error(`Current PR78 continuity failed: ${currentDraft.summary.pr78ContinuityFailures.join("; ")}`);
  }
  if (!currentDraft.summary.preApplyWorkspaceChecksPassed) {
    throw new Error(`Current workspace failed batch-2 gates: ${currentDraft.summary.preApplyWorkspaceFailures.join("; ")}`);
  }
  if (currentDataset.databaseFingerprint !== manifest.databaseFingerprint) {
    throw new Error("Account, action or signal state differs from the sealed batch-2 manifest");
  }
  for (const selected of selectedRows) {
    const current = currentRowsById.get(selected.accountId);
    if (!current || current.recordHash !== selected.recordHash) {
      throw new Error(`Account ${selected.accountId} changed after batch-2 manifest generation`);
    }
  }

  const before = await readApplySnapshots(db, RENTAL_RETAINED_CHILD_BATCH2_ACCOUNT_IDS);
  const lockIds = Array.from(new Set([
    ...RENTAL_RETAINED_CHILD_BATCH2_ACCOUNT_IDS,
    ...RENTAL_RETAINED_CHILD_BATCH2_PARENT_IDS,
  ])).sort((left, right) => left - right);

  const transactionResult = await db.transaction(async (tx: any) => {
    const activeInsideTransaction = await activePipelineCount(tx);
    if (activeInsideTransaction !== 0) {
      throw new Error(`Pipeline activity began before retained-child batch-2 linking: ${activeInsideTransaction} active`);
    }

    const lockedRows = await tx.select().from(fullPotentialAccounts)
      .where(inArray(fullPotentialAccounts.id, lockIds))
      .for("update");
    if (lockedRows.length !== lockIds.length) {
      throw new Error(`Expected to lock ${lockIds.length} target/parent rows; locked ${lockedRows.length}`);
    }

    const transactionDataset = await loadRentalRelationshipDataset(tx);
    if (transactionDataset.databaseFingerprint !== manifest.databaseFingerprint) {
      throw new Error("Retained-child batch-2 state changed before account locks were acquired");
    }
    const transactionContinuityFailures = expectedPr78ContinuityFailures(
      snapshotsById(transactionDataset.accounts),
    );
    if (transactionContinuityFailures.length > 0) {
      throw new Error(`PR78 continuity changed before batch-2 apply: ${transactionContinuityFailures.join("; ")}`);
    }

    for (const row of selectedRows) {
      await tx.update(fullPotentialAccounts).set({
        parentAccountId: row.expectedAfter.parentAccountId,
        relationshipType: RENTAL_RETAINED_CHILD_BATCH2_RELATIONSHIP_TYPE,
      }).where(and(
        eq(fullPotentialAccounts.id, row.accountId),
        isNull(fullPotentialAccounts.parentAccountId),
        isNull(fullPotentialAccounts.mergedIntoAccountId),
        eq(fullPotentialAccounts.relationshipType, "standalone"),
        eq(fullPotentialAccounts.recordStatus, "active"),
        eq(fullPotentialAccounts.countsTowardPotential, true),
      ));

      const current = await readApplySnapshots(tx, [row.accountId]);
      if (current.length !== 1) throw new Error(`Account ${row.accountId} is missing after batch-2 update`);
      assertExpectedAfter(current[0], row);
    }

    const afterDataset = await loadRentalRelationshipDataset(tx);
    const workspaceAfter = toWorkspaceSummary(afterDataset.workspace);
    const postApplyWorkspaceFailures = expectedRetainedChildBatch2PostApplyFailures(
      workspaceAfter,
    );
    const pr78ContinuityFailuresAfter = expectedPr78ContinuityFailures(
      snapshotsById(afterDataset.accounts),
    );
    const afterRows = buildRentalRetainedChildBatch2ManifestRows(afterDataset.accounts);
    const invalidAfterRows = afterRows.filter(row =>
      row.disposition !== "already_linked_retained_child_batch2");
    if (invalidAfterRows.length > 0) {
      throw new Error(`Batch-2 post-link dispositions failed for ${invalidAfterRows.map(row => row.accountId).join(",")}`);
    }
    if (postApplyWorkspaceFailures.length > 0 || pr78ContinuityFailuresAfter.length > 0) {
      throw new Error(`Post-link batch-2 assertion failed: ${[
        ...postApplyWorkspaceFailures,
        ...pr78ContinuityFailuresAfter,
      ].join("; ")}`);
    }

    return {
      workspaceAfter,
      pr78ContinuityFailuresAfter,
      batch2DispositionsAfter: dispositionsByAccountId(afterRows),
      postApplyWorkspaceFailures,
    };
  });

  const after = await readApplySnapshots(db, RENTAL_RETAINED_CHILD_BATCH2_ACCOUNT_IDS);
  for (const row of selectedRows) {
    const snapshot = after.find(item => item.accountId === row.accountId);
    if (!snapshot) throw new Error(`Account ${row.accountId} is missing after batch-2 apply`);
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
    accountIds: [...RENTAL_RETAINED_CHILD_BATCH2_ACCOUNT_IDS],
    before,
    after,
    workspaceBefore,
    workspaceAfter: transactionResult.workspaceAfter,
    pr78ContinuityFailuresBefore,
    pr78ContinuityFailuresAfter: transactionResult.pr78ContinuityFailuresAfter,
    batch2DispositionsAfter: transactionResult.batch2DispositionsAfter,
    postApplyWorkspaceFailures: transactionResult.postApplyWorkspaceFailures,
  };
}
