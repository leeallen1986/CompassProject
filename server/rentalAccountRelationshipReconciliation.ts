import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  fullPotentialAccounts,
  fullPotentialActions,
  fullPotentialSignals,
  pipelineRuns,
} from "../drizzle/schema";
import { getDb } from "./db";
import { buildRentalHireWorkspace } from "./fullPotentialRentalHire";
import {
  RENTAL_RELATIONSHIP_CANARY_ACCOUNT_IDS,
  RENTAL_RELATIONSHIP_CANARY_SPECS,
  RENTAL_RELATIONSHIP_MANIFEST_VERSION,
  RENTAL_RELATIONSHIP_PARENT_ACCOUNT_IDS,
  RENTAL_RELATIONSHIP_TYPE,
  buildRentalRelationshipManifestSummary,
  classifyRentalRelationshipRow,
  expectedPostApplyWorkspaceFailures,
  immutableAccountRecordHash,
  immutableAccountStateHash,
  sha256,
  verifySealedRentalRelationshipManifest,
  type RentalRelationshipAccountSnapshot,
  type RentalRelationshipApplySnapshot,
  type RentalRelationshipManifestDraft,
  type RentalRelationshipManifestRow,
  type RentalRelationshipManifestSealed,
  type RentalRelationshipWorkspaceSummary,
} from "./rentalAccountRelationshipReconciliation.shared";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type AccountRow = typeof fullPotentialAccounts.$inferSelect;
type ActionRow = typeof fullPotentialActions.$inferSelect;
type SignalRow = typeof fullPotentialSignals.$inferSelect;

export interface RentalRelationshipDataset {
  accounts: AccountRow[];
  actions: ActionRow[];
  signals: SignalRow[];
  databaseIdentity: string;
  databaseFingerprint: string;
  workspace: RentalRelationshipWorkspaceSummary;
}

export interface RentalRelationshipApplyResult {
  manifestHash: string;
  databaseFingerprintBefore: string;
  activePipelineRunsBefore: number;
  alreadyApplied: boolean;
  selected: number;
  applied: number;
  skipped: number;
  accountIds: number[];
  before: RentalRelationshipApplySnapshot[];
  after: RentalRelationshipApplySnapshot[];
  workspaceBefore: RentalRelationshipWorkspaceSummary;
  workspaceAfter: RentalRelationshipWorkspaceSummary;
  postApplyWorkspaceFailures: string[];
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function scalarString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function currentDatabaseIdentity(): string {
  const raw = process.env.DATABASE_URL || "";
  try {
    const parsed = new URL(raw);
    return sha256({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      pathname: parsed.pathname,
    });
  } catch {
    return sha256({ database: "unconfigured" });
  }
}

export function toRentalRelationshipAccountSnapshot(
  row: AccountRow,
): RentalRelationshipAccountSnapshot {
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
    fullImmutableStateHash: immutableAccountRecordHash(
      row as unknown as Record<string, unknown>,
    ),
  };
}

function relevantDatabaseFingerprint(
  accounts: readonly AccountRow[],
  actions: readonly ActionRow[],
  signals: readonly SignalRow[],
): string {
  return sha256({
    accounts: [...accounts].sort((left, right) => left.id - right.id),
    actions: [...actions].sort((left, right) => left.id - right.id),
    signals: [...signals].sort((left, right) => left.id - right.id),
  });
}

function distributionMap(
  rows: Array<{ value: string; count: number }> | undefined,
): Record<string, number> {
  return Object.fromEntries((rows || []).map(row => [row.value, row.count]));
}

export function toRentalRelationshipWorkspaceSummary(
  report: ReturnType<typeof buildRentalHireWorkspace>,
): RentalRelationshipWorkspaceSummary {
  const parentContextAccountIds: Record<string, number[]> = {};
  for (const account of report.accounts as Array<Record<string, any>>) {
    const contextIds = Array.isArray(account.contextRecords)
      ? account.contextRecords.map((row: Record<string, unknown>) => Number(row.id)).filter(Number.isInteger)
      : [];
    if (contextIds.length > 0) parentContextAccountIds[String(account.id)] = contextIds.sort((a, b) => a - b);
  }

  return {
    totalRentalRows: Number(report.summary.totalRentalRows || 0),
    totalRentalAccounts: Number(report.summary.totalRentalAccounts || 0),
    tierA: Number(report.summary.tierA || 0),
    pushNow: Number(report.summary.pushNow || 0),
    directAccounts: Number(report.summary.directAccounts || 0),
    channelAccounts: Number(report.summary.channelAccounts || 0),
    nonCountingContextRecords: Number(report.summary.nonCountingContextRecords || 0),
    attachedContextRecords: Number(report.summary.attachedContextRecords || 0),
    unattachedContextRecords: Number(report.summary.unattachedContextRecords || 0),
    routeDistribution: distributionMap(report.routeDistribution as Array<{ value: string; count: number }>),
    topLevelAccountIds: (report.accounts as Array<{ id: number }>).map(row => row.id).sort((a, b) => a - b),
    parentContextAccountIds,
  };
}

function workspaceFromRows(
  accounts: readonly AccountRow[],
  actions: readonly ActionRow[],
  signals: readonly SignalRow[],
): RentalRelationshipWorkspaceSummary {
  const report = buildRentalHireWorkspace(
    [...accounts] as unknown as Array<Record<string, unknown> & { id: number }>,
    [...actions] as unknown as Array<Record<string, unknown> & { id?: number; accountId?: number | null; status?: string | null }>,
    [...signals] as unknown as Array<Record<string, unknown> & { accountId?: number | null; status?: string | null; urgency?: string | null }>,
    { limit: 200, offset: 0, view: "all" },
  );
  return toRentalRelationshipWorkspaceSummary(report);
}

export async function loadRentalRelationshipDataset(
  dbOverride?: Db,
): Promise<RentalRelationshipDataset> {
  const db = dbOverride || await getDb();
  if (!db) throw new Error("Database unavailable");
  const [accounts, actions, signals] = await Promise.all([
    db.select().from(fullPotentialAccounts),
    db.select().from(fullPotentialActions),
    db.select().from(fullPotentialSignals),
  ]);
  return {
    accounts,
    actions,
    signals,
    databaseIdentity: currentDatabaseIdentity(),
    databaseFingerprint: relevantDatabaseFingerprint(accounts, actions, signals),
    workspace: workspaceFromRows(accounts, actions, signals),
  };
}

export function buildRentalRelationshipManifestRows(
  accounts: readonly AccountRow[],
): RentalRelationshipManifestRow[] {
  const byId = new Map(accounts.map(row => [row.id, toRentalRelationshipAccountSnapshot(row)]));
  return RENTAL_RELATIONSHIP_CANARY_SPECS.map(spec =>
    classifyRentalRelationshipRow(
      spec,
      byId.get(spec.accountId) || null,
      byId.get(spec.parentAccountId) || null,
    ),
  ).sort((left, right) => left.accountId - right.accountId);
}

export async function generateRentalRelationshipManifest(
  dbOverride?: Db,
): Promise<RentalRelationshipManifestDraft> {
  const dataset = await loadRentalRelationshipDataset(dbOverride);
  const rows = buildRentalRelationshipManifestRows(dataset.accounts);
  return {
    schemaVersion: RENTAL_RELATIONSHIP_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    databaseIdentity: dataset.databaseIdentity,
    databaseFingerprint: dataset.databaseFingerprint,
    sealed: false,
    summary: buildRentalRelationshipManifestSummary(rows, dataset.workspace),
    rows,
  };
}

function toApplySnapshot(row: AccountRow): RentalRelationshipApplySnapshot {
  const snapshot = toRentalRelationshipAccountSnapshot(row);
  return {
    accountId: row.id,
    parentAccountId: snapshot.parentAccountId,
    mergedIntoAccountId: snapshot.mergedIntoAccountId,
    relationshipType: snapshot.relationshipType,
    recordStatus: snapshot.recordStatus,
    countsTowardPotential: snapshot.countsTowardPotential,
    immutableStateHash: immutableAccountStateHash(snapshot),
  };
}

async function readApplySnapshots(
  db: Db | any,
  accountIds: readonly number[],
): Promise<RentalRelationshipApplySnapshot[]> {
  const rows = await db.select().from(fullPotentialAccounts)
    .where(inArray(fullPotentialAccounts.id, [...accountIds]));
  return (rows as AccountRow[]).map(toApplySnapshot).sort((left, right) => left.accountId - right.accountId);
}

function selectedApprovedRows(
  manifest: RentalRelationshipManifestSealed,
): RentalRelationshipManifestRow[] {
  const rows = manifest.rows.filter(row => row.approved).sort((left, right) => left.accountId - right.accountId);
  const actualIds = rows.map(row => row.accountId);
  const expectedIds = [...RENTAL_RELATIONSHIP_CANARY_ACCOUNT_IDS];
  if (sha256(actualIds) !== sha256(expectedIds)) {
    throw new Error(`Approved account IDs must be exactly ${expectedIds.join(",")}`);
  }
  if (rows.some(row => row.disposition !== "safe_attach_context")) {
    throw new Error("Only safe_attach_context rows may be applied");
  }
  return rows;
}

function assertExpectedAfter(
  snapshot: RentalRelationshipApplySnapshot,
  row: RentalRelationshipManifestRow,
): void {
  if (
    snapshot.parentAccountId !== row.expectedAfter.parentAccountId
    || snapshot.mergedIntoAccountId !== null
    || snapshot.relationshipType !== row.expectedAfter.relationshipType
    || snapshot.recordStatus !== row.expectedAfter.recordStatus
    || snapshot.countsTowardPotential !== false
  ) {
    throw new Error(`Account ${row.accountId} did not reach its expected relationship state`);
  }
  if (snapshot.immutableStateHash !== row.immutableStateHash) {
    throw new Error(`Account ${row.accountId} changed outside the approved relationship fields`);
  }
}

async function activePipelineCount(db: Db | any): Promise<number> {
  const rows = await db.select({ id: pipelineRuns.id }).from(pipelineRuns)
    .where(eq(pipelineRuns.status, "running"));
  return rows.length;
}

export async function applyRentalRelationshipManifest(
  manifest: RentalRelationshipManifestSealed,
  confirmHash: string,
  dbOverride?: Db,
): Promise<RentalRelationshipApplyResult> {
  if (!verifySealedRentalRelationshipManifest(manifest)) {
    throw new Error("Manifest hash verification failed");
  }
  if (confirmHash !== manifest.manifestHash) {
    throw new Error("--confirm-hash does not match the sealed manifest hash");
  }
  const selectedRows = selectedApprovedRows(manifest);
  const db = dbOverride || await getDb();
  if (!db) throw new Error("Database unavailable");

  const activePipelineRunsBefore = await activePipelineCount(db);
  if (activePipelineRunsBefore !== 0) {
    throw new Error(`Cannot apply while ${activePipelineRunsBefore} pipeline run(s) are active`);
  }

  const currentManifest = await generateRentalRelationshipManifest(db);
  if (currentManifest.databaseIdentity !== manifest.databaseIdentity) {
    throw new Error("Manifest belongs to a different database");
  }

  const currentRowsById = new Map(currentManifest.rows.map(row => [row.accountId, row]));
  const alreadyApplied = selectedRows.every(row =>
    currentRowsById.get(row.accountId)?.disposition === "already_attached");
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
    const postFailures = expectedPostApplyWorkspaceFailures(currentManifest.summary.workspaceBefore);
    if (postFailures.length > 0) {
      throw new Error(`Accounts are attached but the workspace is inconsistent: ${postFailures.join("; ")}`);
    }
    const snapshots = await readApplySnapshots(db, RENTAL_RELATIONSHIP_CANARY_ACCOUNT_IDS);
    return {
      manifestHash: manifest.manifestHash,
      databaseFingerprintBefore: currentManifest.databaseFingerprint,
      activePipelineRunsBefore,
      alreadyApplied: true,
      selected: selectedRows.length,
      applied: 0,
      skipped: selectedRows.length,
      accountIds: [...RENTAL_RELATIONSHIP_CANARY_ACCOUNT_IDS],
      before: snapshots,
      after: snapshots,
      workspaceBefore: currentManifest.summary.workspaceBefore,
      workspaceAfter: currentManifest.summary.workspaceBefore,
      postApplyWorkspaceFailures: [],
    };
  }

  if (!manifest.summary.preApplyWorkspaceChecksPassed) {
    throw new Error(`Sealed manifest failed its pre-apply workspace gates: ${manifest.summary.preApplyWorkspaceFailures.join("; ")}`);
  }
  if (!currentManifest.summary.preApplyWorkspaceChecksPassed) {
    throw new Error(`Current workspace failed pre-apply gates: ${currentManifest.summary.preApplyWorkspaceFailures.join("; ")}`);
  }
  if (currentManifest.databaseFingerprint !== manifest.databaseFingerprint) {
    throw new Error("Account, action or signal state differs from the sealed manifest; regenerate and review a new manifest");
  }

  for (const selected of selectedRows) {
    const current = currentRowsById.get(selected.accountId);
    if (!current || current.recordHash !== selected.recordHash) {
      throw new Error(`Account ${selected.accountId} changed after manifest generation`);
    }
  }

  const before = await readApplySnapshots(db, RENTAL_RELATIONSHIP_CANARY_ACCOUNT_IDS);
  const expectedImmutableHashes = new Map(selectedRows.map(row => [row.accountId, row.immutableStateHash]));
  const lockIds = Array.from(new Set([
    ...RENTAL_RELATIONSHIP_CANARY_ACCOUNT_IDS,
    ...RENTAL_RELATIONSHIP_PARENT_ACCOUNT_IDS,
  ])).sort((left, right) => left - right);

  const transactionResult = await db.transaction(async (tx: any) => {
    const activeInsideTransaction = await activePipelineCount(tx);
    if (activeInsideTransaction !== 0) {
      throw new Error(`Pipeline activity began before the account transaction: ${activeInsideTransaction} active`);
    }

    const lockedRows = await tx.select().from(fullPotentialAccounts)
      .where(inArray(fullPotentialAccounts.id, lockIds))
      .for("update");
    if (lockedRows.length !== lockIds.length) {
      throw new Error(`Expected to lock ${lockIds.length} target/parent rows; locked ${lockedRows.length}`);
    }

    const accountsBeforeTx = await tx.select().from(fullPotentialAccounts);
    const actionsBeforeTx = await tx.select().from(fullPotentialActions);
    const signalsBeforeTx = await tx.select().from(fullPotentialSignals);
    const transactionFingerprint = relevantDatabaseFingerprint(
      accountsBeforeTx as AccountRow[],
      actionsBeforeTx as ActionRow[],
      signalsBeforeTx as SignalRow[],
    );
    if (transactionFingerprint !== manifest.databaseFingerprint) {
      throw new Error("Reconciliation state changed before the transaction acquired its account locks");
    }

    for (const row of selectedRows) {
      await tx.update(fullPotentialAccounts).set({
        parentAccountId: row.expectedAfter.parentAccountId,
        relationshipType: RENTAL_RELATIONSHIP_TYPE,
        countsTowardPotential: false,
      }).where(and(
        eq(fullPotentialAccounts.id, row.accountId),
        isNull(fullPotentialAccounts.parentAccountId),
        isNull(fullPotentialAccounts.mergedIntoAccountId),
        eq(fullPotentialAccounts.relationshipType, "standalone"),
        eq(fullPotentialAccounts.recordStatus, "active"),
        eq(fullPotentialAccounts.countsTowardPotential, true),
      ));

      const current = await readApplySnapshots(tx, [row.accountId]);
      if (current.length !== 1) throw new Error(`Account ${row.accountId} is missing after transactional update`);
      assertExpectedAfter(current[0], row);
      if (current[0].immutableStateHash !== expectedImmutableHashes.get(row.accountId)) {
        throw new Error(`Account ${row.accountId} immutable-state assertion failed`);
      }
    }

    const accountsAfter = await tx.select().from(fullPotentialAccounts);
    const actionsAfter = await tx.select().from(fullPotentialActions);
    const signalsAfter = await tx.select().from(fullPotentialSignals);
    const workspaceAfter = workspaceFromRows(
      accountsAfter as AccountRow[],
      actionsAfter as ActionRow[],
      signalsAfter as SignalRow[],
    );
    const postApplyWorkspaceFailures = expectedPostApplyWorkspaceFailures(workspaceAfter);
    if (postApplyWorkspaceFailures.length > 0) {
      throw new Error(`Post-apply workspace assertion failed: ${postApplyWorkspaceFailures.join("; ")}`);
    }

    return {
      workspaceAfter,
      postApplyWorkspaceFailures,
    };
  });

  const after = await readApplySnapshots(db, RENTAL_RELATIONSHIP_CANARY_ACCOUNT_IDS);
  for (const row of selectedRows) {
    const snapshot = after.find(item => item.accountId === row.accountId);
    if (!snapshot) throw new Error(`Account ${row.accountId} is missing after apply`);
    assertExpectedAfter(snapshot, row);
  }

  return {
    manifestHash: manifest.manifestHash,
    databaseFingerprintBefore: currentManifest.databaseFingerprint,
    activePipelineRunsBefore,
    alreadyApplied: false,
    selected: selectedRows.length,
    applied: selectedRows.length,
    skipped: 0,
    accountIds: [...RENTAL_RELATIONSHIP_CANARY_ACCOUNT_IDS],
    before,
    after,
    workspaceBefore: currentManifest.summary.workspaceBefore,
    workspaceAfter: transactionResult.workspaceAfter,
    postApplyWorkspaceFailures: transactionResult.postApplyWorkspaceFailures,
  };
}
