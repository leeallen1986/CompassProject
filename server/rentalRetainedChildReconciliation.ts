import { and, eq, inArray, isNull } from "drizzle-orm";
import { fullPotentialAccounts, pipelineRuns } from "../drizzle/schema";
import { getDb } from "./db";
import { loadRentalRelationshipDataset } from "./rentalAccountRelationshipReconciliation";
import {
  RENTAL_RETAINED_CHILD_ACCOUNT_IDS,
  RENTAL_RETAINED_CHILD_MANIFEST_VERSION,
  RENTAL_RETAINED_CHILD_PARENT_IDS,
  RENTAL_RETAINED_CHILD_RELATIONSHIP_TYPE,
  RENTAL_RETAINED_CHILD_SPECS,
  buildRentalRetainedChildManifestSummary,
  classifyRentalRetainedChildRow,
  expectedRetainedChildPostApplyFailures,
  immutableRetainedChildAccountHash,
  sha256RetainedChild,
  verifySealedRentalRetainedChildManifest,
  type RentalRetainedChildAccountSnapshot,
  type RentalRetainedChildApplySnapshot,
  type RentalRetainedChildManifestDraft,
  type RentalRetainedChildManifestRow,
  type RentalRetainedChildManifestSealed,
  type RentalRetainedChildWorkspaceSummary,
} from "./rentalRetainedChildReconciliation.shared";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type AccountRow = typeof fullPotentialAccounts.$inferSelect;

export interface RentalRetainedChildApplyResult {
  manifestHash: string;
  databaseFingerprintBefore: string;
  activePipelineRunsBefore: number;
  alreadyApplied: boolean;
  selected: number;
  applied: number;
  skipped: number;
  accountIds: number[];
  before: RentalRetainedChildApplySnapshot[];
  after: RentalRetainedChildApplySnapshot[];
  workspaceBefore: RentalRetainedChildWorkspaceSummary;
  workspaceAfter: RentalRetainedChildWorkspaceSummary;
  postApplyWorkspaceFailures: string[];
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function scalarString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export function toRentalRetainedChildAccountSnapshot(
  row: AccountRow,
): RentalRetainedChildAccountSnapshot {
  return {
    id: row.id,
    stableKey: row.stableKey || null,
    canonicalName: row.canonicalName,
    displayName: row.displayName || null,
    country: row.country || null,
    state: row.state || null,
    region: row.region || null,
    rowClass: row.rowClass || null,
    parentAccountId: row.parentAccountId ?? null,
    mergedIntoAccountId: row.mergedIntoAccountId ?? null,
    relationshipType: row.relationshipType || null,
    recordStatus: row.recordStatus || null,
    countsTowardPotential: !!row.countsTowardPotential,
    routeToMarket: row.routeToMarket || null,
    ownerName: row.ownerName || null,
    priorityTier: row.priorityTier || null,
    platformPushDecision: row.platformPushDecision || null,
    currentRevenueAud: scalarString(row.currentRevenueAud),
    fullPotentialAud: scalarString(row.fullPotentialAud),
    target2026Aud: scalarString(row.target2026Aud),
    remainingPotentialAud: scalarString(row.remainingPotentialAud),
    updatedAt: iso(row.updatedAt),
    fullImmutableStateHash: immutableRetainedChildAccountHash(
      row as unknown as Record<string, unknown>,
    ),
  };
}

function toWorkspaceSummary(
  source: Awaited<ReturnType<typeof loadRentalRelationshipDataset>>["workspace"],
): RentalRetainedChildWorkspaceSummary {
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

export function buildRentalRetainedChildManifestRows(
  accounts: readonly AccountRow[],
): RentalRetainedChildManifestRow[] {
  const byId = new Map(accounts.map(row => [row.id, toRentalRetainedChildAccountSnapshot(row)]));
  return RENTAL_RETAINED_CHILD_SPECS.map(spec =>
    classifyRentalRetainedChildRow(
      spec,
      byId.get(spec.accountId) || null,
      byId.get(spec.parentAccountId) || null,
    ),
  ).sort((left, right) => left.accountId - right.accountId);
}

export async function generateRentalRetainedChildManifest(
  dbOverride?: Db,
): Promise<RentalRetainedChildManifestDraft> {
  const dataset = await loadRentalRelationshipDataset(dbOverride);
  const rows = buildRentalRetainedChildManifestRows(dataset.accounts);
  const workspace = toWorkspaceSummary(dataset.workspace);
  return {
    schemaVersion: RENTAL_RETAINED_CHILD_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    databaseIdentity: dataset.databaseIdentity,
    databaseFingerprint: dataset.databaseFingerprint,
    sealed: false,
    summary: buildRentalRetainedChildManifestSummary(rows, workspace),
    rows,
  };
}

function toApplySnapshot(row: AccountRow): RentalRetainedChildApplySnapshot {
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
): Promise<RentalRetainedChildApplySnapshot[]> {
  const rows = await db.select().from(fullPotentialAccounts)
    .where(inArray(fullPotentialAccounts.id, [...accountIds]));
  return (rows as AccountRow[])
    .map(toApplySnapshot)
    .sort((left, right) => left.accountId - right.accountId);
}

function selectedApprovedRows(
  manifest: RentalRetainedChildManifestSealed,
): RentalRetainedChildManifestRow[] {
  const rows = manifest.rows
    .filter(row => row.approved)
    .sort((left, right) => left.accountId - right.accountId);
  const actualIds = rows.map(row => row.accountId);
  const expectedIds = [...RENTAL_RETAINED_CHILD_ACCOUNT_IDS];
  if (sha256RetainedChild(actualIds) !== sha256RetainedChild(expectedIds)) {
    throw new Error(`Approved account IDs must be exactly ${expectedIds.join(",")}`);
  }
  if (rows.some(row => row.disposition !== "safe_link_retained_child")) {
    throw new Error("Only safe_link_retained_child rows may be applied");
  }
  return rows;
}

function assertExpectedAfter(
  snapshot: RentalRetainedChildApplySnapshot,
  row: RentalRetainedChildManifestRow,
): void {
  if (
    snapshot.parentAccountId !== row.expectedAfter.parentAccountId
    || snapshot.mergedIntoAccountId !== null
    || snapshot.relationshipType !== row.expectedAfter.relationshipType
    || snapshot.recordStatus !== row.expectedAfter.recordStatus
    || snapshot.countsTowardPotential !== true
  ) {
    throw new Error(`Account ${row.accountId} did not reach its retained-child relationship state`);
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

export async function applyRentalRetainedChildManifest(
  manifest: RentalRetainedChildManifestSealed,
  confirmHash: string,
  dbOverride?: Db,
): Promise<RentalRetainedChildApplyResult> {
  if (!verifySealedRentalRetainedChildManifest(manifest)) {
    throw new Error("Retained-child manifest hash verification failed");
  }
  if (confirmHash !== manifest.manifestHash) {
    throw new Error("--confirm-hash does not match the sealed retained-child manifest hash");
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
    throw new Error("Retained-child manifest belongs to a different database");
  }
  const currentRows = buildRentalRetainedChildManifestRows(currentDataset.accounts);
  const currentRowsById = new Map(currentRows.map(row => [row.accountId, row]));
  const workspaceBefore = toWorkspaceSummary(currentDataset.workspace);

  const alreadyApplied = selectedRows.every(row =>
    currentRowsById.get(row.accountId)?.disposition === "already_linked_retained_child");
  if (alreadyApplied) {
    for (const selected of selectedRows) {
      const current = currentRowsById.get(selected.accountId);
      if (!current || current.immutableStateHash !== selected.immutableStateHash) {
        throw new Error(`Account ${selected.accountId} immutable state differs from the sealed manifest`);
      }
      if (current.parent?.fullImmutableStateHash !== selected.parent?.fullImmutableStateHash) {
        throw new Error(`Parent ${selected.parentAccountId} immutable state differs from the sealed manifest`);
      }
    }
    const postFailures = expectedRetainedChildPostApplyFailures(workspaceBefore);
    if (postFailures.length > 0) {
      throw new Error(`Retained children are linked but the workspace is inconsistent: ${postFailures.join("; ")}`);
    }
    const snapshots = await readApplySnapshots(db, RENTAL_RETAINED_CHILD_ACCOUNT_IDS);
    return {
      manifestHash: manifest.manifestHash,
      databaseFingerprintBefore: currentDataset.databaseFingerprint,
      activePipelineRunsBefore,
      alreadyApplied: true,
      selected: selectedRows.length,
      applied: 0,
      skipped: selectedRows.length,
      accountIds: [...RENTAL_RETAINED_CHILD_ACCOUNT_IDS],
      before: snapshots,
      after: snapshots,
      workspaceBefore,
      workspaceAfter: workspaceBefore,
      postApplyWorkspaceFailures: [],
    };
  }

  if (!manifest.summary.preApplyWorkspaceChecksPassed) {
    throw new Error(`Sealed retained-child manifest failed pre-apply gates: ${manifest.summary.preApplyWorkspaceFailures.join("; ")}`);
  }
  const currentDraft = await generateRentalRetainedChildManifest(db);
  if (!currentDraft.summary.preApplyWorkspaceChecksPassed) {
    throw new Error(`Current workspace failed retained-child pre-apply gates: ${currentDraft.summary.preApplyWorkspaceFailures.join("; ")}`);
  }
  if (currentDataset.databaseFingerprint !== manifest.databaseFingerprint) {
    throw new Error("Account, action or signal state differs from the sealed retained-child manifest");
  }
  for (const selected of selectedRows) {
    const current = currentRowsById.get(selected.accountId);
    if (!current || current.recordHash !== selected.recordHash) {
      throw new Error(`Account ${selected.accountId} changed after retained-child manifest generation`);
    }
  }

  const before = await readApplySnapshots(db, RENTAL_RETAINED_CHILD_ACCOUNT_IDS);
  const lockIds = Array.from(new Set([
    ...RENTAL_RETAINED_CHILD_ACCOUNT_IDS,
    ...RENTAL_RETAINED_CHILD_PARENT_IDS,
  ])).sort((left, right) => left - right);

  const transactionResult = await db.transaction(async (tx: any) => {
    const activeInsideTransaction = await activePipelineCount(tx);
    if (activeInsideTransaction !== 0) {
      throw new Error(`Pipeline activity began before retained-child linking: ${activeInsideTransaction} active`);
    }

    const lockedRows = await tx.select().from(fullPotentialAccounts)
      .where(inArray(fullPotentialAccounts.id, lockIds))
      .for("update");
    if (lockedRows.length !== lockIds.length) {
      throw new Error(`Expected to lock ${lockIds.length} target/parent rows; locked ${lockedRows.length}`);
    }

    const transactionDataset = await loadRentalRelationshipDataset(tx);
    if (transactionDataset.databaseFingerprint !== manifest.databaseFingerprint) {
      throw new Error("Retained-child reconciliation state changed before account locks were acquired");
    }

    for (const row of selectedRows) {
      await tx.update(fullPotentialAccounts).set({
        parentAccountId: row.expectedAfter.parentAccountId,
        relationshipType: RENTAL_RETAINED_CHILD_RELATIONSHIP_TYPE,
      }).where(and(
        eq(fullPotentialAccounts.id, row.accountId),
        isNull(fullPotentialAccounts.parentAccountId),
        isNull(fullPotentialAccounts.mergedIntoAccountId),
        eq(fullPotentialAccounts.relationshipType, "standalone"),
        eq(fullPotentialAccounts.recordStatus, "active"),
        eq(fullPotentialAccounts.countsTowardPotential, true),
      ));

      const current = await readApplySnapshots(tx, [row.accountId]);
      if (current.length !== 1) throw new Error(`Account ${row.accountId} is missing after retained-child update`);
      assertExpectedAfter(current[0], row);
    }

    const afterDataset = await loadRentalRelationshipDataset(tx);
    const workspaceAfter = toWorkspaceSummary(afterDataset.workspace);
    const postApplyWorkspaceFailures = expectedRetainedChildPostApplyFailures(workspaceAfter);
    if (postApplyWorkspaceFailures.length > 0) {
      throw new Error(`Post-link Rental workspace assertion failed: ${postApplyWorkspaceFailures.join("; ")}`);
    }

    return { workspaceAfter, postApplyWorkspaceFailures };
  });

  const after = await readApplySnapshots(db, RENTAL_RETAINED_CHILD_ACCOUNT_IDS);
  for (const row of selectedRows) {
    const snapshot = after.find(item => item.accountId === row.accountId);
    if (!snapshot) throw new Error(`Account ${row.accountId} is missing after retained-child apply`);
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
    accountIds: [...RENTAL_RETAINED_CHILD_ACCOUNT_IDS],
    before,
    after,
    workspaceBefore,
    workspaceAfter: transactionResult.workspaceAfter,
    postApplyWorkspaceFailures: transactionResult.postApplyWorkspaceFailures,
  };
}
