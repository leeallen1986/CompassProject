#!/usr/bin/env tsx
/**
 * Guarded two-record Rental Hire relationship reconciliation.
 *
 * Default mode generates a read-only draft. Sealing performs no database write.
 * Apply requires an exact sealed manifest hash and can update only accounts 328
 * and 334 inside one transaction.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  fullPotentialAccounts,
  fullPotentialActions,
  fullPotentialSignals,
  pipelineRuns,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { buildRentalHireWorkspace } from "../fullPotentialRentalHire";
import {
  RENTAL_RELATIONSHIP_PERSISTED_TYPE,
  buildDraftManifest,
  computeManifestHash,
  immutableRowHash,
  projectRelationshipCanary,
  sealManifest,
  sha256,
  stableStringify,
  validateSourceTopology,
  verifySealedManifest,
  type RentalRelationshipAccount,
  type RentalRelationshipManifest,
  type RentalWorkspaceProjection,
} from "../fullPotentialRentalRelationshipReconciliation";

interface CliOptions {
  outputDir: string;
  manifest: string | null;
  seal: boolean;
  apply: boolean;
  confirmHash: string | null;
  help: boolean;
}

export function parseRentalRelationshipArgs(argv: string[]): CliOptions {
  const result: CliOptions = {
    outputDir: "",
    manifest: null,
    seal: false,
    apply: false,
    confirmHash: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--output-dir") result.outputDir = argv[++index] || "";
    else if (arg.startsWith("--output-dir=")) result.outputDir = arg.slice("--output-dir=".length);
    else if (arg === "--manifest") result.manifest = argv[++index] || null;
    else if (arg.startsWith("--manifest=")) result.manifest = arg.slice("--manifest=".length) || null;
    else if (arg === "--confirm-hash") result.confirmHash = argv[++index] || null;
    else if (arg.startsWith("--confirm-hash=")) result.confirmHash = arg.slice("--confirm-hash=".length) || null;
    else if (arg === "--seal") result.seal = true;
    else if (arg === "--apply") result.apply = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (result.seal && result.apply) throw new Error("--seal and --apply are mutually exclusive.");
  return result;
}

function usage(): string {
  return [
    "Guarded Rental Hire relationship reconciliation",
    "",
    "Generate read-only draft:",
    "  pnpm exec tsx server/scripts/fullPotentialRentalRelationshipReconcile.ts --output-dir <path>",
    "",
    "Seal operator-reviewed draft without database writes:",
    "  pnpm exec tsx server/scripts/fullPotentialRentalRelationshipReconcile.ts --seal --manifest <reviewed.json> --output-dir <path>",
    "",
    "Apply exact sealed two-record canary:",
    "  pnpm exec tsx server/scripts/fullPotentialRentalRelationshipReconcile.ts --apply --manifest <sealed.json> --confirm-hash <manifestHash> --output-dir <path>",
  ].join("\n");
}

function normalizeDistribution(rows: Array<{ value: string; count: number }>): Record<string, number> {
  return Object.fromEntries(rows.map(row => [row.value, row.count]));
}

function projectWorkspace(report: ReturnType<typeof buildRentalHireWorkspace>): RentalWorkspaceProjection {
  return {
    totalRentalRows: report.summary.totalRentalRows,
    totalRentalAccounts: report.summary.totalRentalAccounts,
    nonCountingContextRecords: report.summary.nonCountingContextRecords,
    attachedContextRecords: report.summary.attachedContextRecords,
    unattachedContextRecords: report.summary.unattachedContextRecords,
    tierA: report.summary.tierA,
    pushNow: report.summary.pushNow,
    routeDistribution: normalizeDistribution(report.routeDistribution),
    accountIds: report.accounts.map(row => row.id).sort((left, right) => left - right),
  };
}

function databaseIdentity(accounts: RentalRelationshipAccount[]): string {
  return sha256({
    table: "fullPotentialAccounts",
    columns: Object.keys(accounts[0] ?? {}).sort(),
    reconciliationSchemaVersion: 1,
  });
}

function databaseFingerprint(
  accounts: RentalRelationshipAccount[],
  workspace: RentalWorkspaceProjection,
): string {
  return sha256({
    rows: [...accounts]
      .sort((left, right) => left.id - right.id)
      .map(account => [account.id, sha256(account)]),
    workspace,
  });
}

function selectedRows(accounts: RentalRelationshipAccount[]): RentalRelationshipAccount[] {
  return accounts
    .filter(account => [269, 328, 415, 334].includes(account.id))
    .sort((left, right) => left.id - right.id);
}

async function readState(db: any) {
  const [accounts, actions, signals, activeRuns] = await Promise.all([
    db.select().from(fullPotentialAccounts),
    db.select().from(fullPotentialActions),
    db.select().from(fullPotentialSignals),
    db.select({ id: pipelineRuns.id }).from(pipelineRuns).where(eq(pipelineRuns.status, "running")),
  ]);
  const workspace = projectWorkspace(buildRentalHireWorkspace(accounts, actions, signals, { limit: 200, view: "all" }));
  return { accounts, actions, signals, activeRuns, workspace };
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function manifestCsv(manifest: RentalRelationshipManifest): string {
  const headers = [
    "accountId", "canonicalName", "parentAccountId", "parentCanonicalName",
    "relationshipSemantic", "relationshipTypeBefore", "relationshipTypeAfter",
    "countsTowardPotentialBefore", "countsTowardPotentialAfter", "approved", "reason",
  ];
  const lines = [headers.join(",")];
  for (const row of manifest.rows) {
    lines.push([
      row.accountId,
      row.canonicalName,
      row.parentAccountId,
      row.parentCanonicalName,
      row.relationshipSemantic,
      row.before.relationshipType,
      row.after.relationshipType,
      row.before.countsTowardPotential,
      row.after.countsTowardPotential,
      row.approved,
      row.reason,
    ].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function writeJson(outputDir: string, fileName: string, value: unknown): Promise<string> {
  const target = path.join(outputDir, fileName);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return target;
}

function desiredState(account: RentalRelationshipAccount, parentAccountId: number): boolean {
  return Number(account.parentAccountId) === parentAccountId
    && account.mergedIntoAccountId == null
    && String(account.relationshipType) === RENTAL_RELATIONSHIP_PERSISTED_TYPE
    && account.countsTowardPotential === false
    && String(account.recordStatus) === "active";
}

function assertImmutable(
  before: ReadonlyMap<number, RentalRelationshipAccount>,
  after: RentalRelationshipAccount[],
): void {
  for (const row of after) {
    const original = before.get(row.id);
    if (!original) throw new Error(`Missing before snapshot for account ${row.id}.`);
    if (immutableRowHash(original) !== immutableRowHash(row)) {
      throw new Error(`Immutable account fields changed for account ${row.id}.`);
    }
  }
}

async function generate(options: CliOptions): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");
  const state = await readState(db);
  if (state.activeRuns.length > 0) {
    throw new Error(`Active pipeline runs block generation: ${state.activeRuns.map((row: any) => row.id).join(",")}`);
  }
  validateSourceTopology(selectedRows(state.accounts));
  const projectedAccounts = projectRelationshipCanary(state.accounts);
  const expectedAfter = projectWorkspace(buildRentalHireWorkspace(projectedAccounts, state.actions, state.signals, { limit: 200, view: "all" }));
  const manifest = buildDraftManifest({
    accounts: selectedRows(state.accounts),
    sourceAccountCount: state.accounts.length,
    databaseIdentity: databaseIdentity(state.accounts),
    databaseFingerprint: databaseFingerprint(state.accounts, state.workspace),
    sourceGitHubSha: process.env.COMPASS_GITHUB_SOURCE_SHA || process.env.GIT_COMMIT_SHA || null,
    workspaceBefore: state.workspace,
    workspaceExpectedAfter: expectedAfter,
  });

  await mkdir(options.outputDir, { recursive: true });
  await writeJson(options.outputDir, "rental-relationship-manifest.draft.json", manifest);
  await writeFile(path.join(options.outputDir, "rental-relationship-manifest.csv"), manifestCsv(manifest), "utf8");
  await writeJson(options.outputDir, "rental-relationship-summary.json", {
    mode: "generate",
    sourceAccountCount: manifest.sourceAccountCount,
    rowCount: manifest.rowCount,
    approvedRows: manifest.approvedRows,
    automaticWriteAllowed: manifest.automaticWriteAllowed,
    databaseIdentity: manifest.databaseIdentity,
    databaseFingerprint: manifest.databaseFingerprint,
    persistedRelationshipType: RENTAL_RELATIONSHIP_PERSISTED_TYPE,
    relationshipSemantic: "strategic_context",
    workspaceBefore: manifest.workspaceBefore,
    workspaceExpectedAfter: manifest.workspaceExpectedAfter,
    databaseWrites: 0,
  });
  process.stdout.write(`${JSON.stringify({ mode: "generate", rowCount: 2, approvedRows: 0, databaseWrites: 0 }, null, 2)}\n`);
}

async function seal(options: CliOptions): Promise<void> {
  if (!options.manifest) throw new Error("--manifest is required with --seal.");
  const draft = JSON.parse(await readFile(path.resolve(options.manifest), "utf8")) as RentalRelationshipManifest;
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");
  const state = await readState(db);
  if (state.activeRuns.length > 0) throw new Error("Active pipeline runs block sealing.");
  if (draft.databaseIdentity !== databaseIdentity(state.accounts)) throw new Error("Database identity changed; regenerate the draft.");
  if (draft.databaseFingerprint !== databaseFingerprint(state.accounts, state.workspace)) throw new Error("Database fingerprint changed; regenerate the draft.");
  const sealed = sealManifest(draft);
  await mkdir(options.outputDir, { recursive: true });
  const sealedPath = await writeJson(options.outputDir, "rental-relationship-manifest.sealed.json", sealed);
  process.stdout.write(`${JSON.stringify({ mode: "seal", sealedPath, approvedRows: 2, manifestHash: sealed.manifestHash, databaseWrites: 0 }, null, 2)}\n`);
}

async function apply(options: CliOptions): Promise<void> {
  if (!options.manifest) throw new Error("--manifest is required with --apply.");
  if (!options.confirmHash) throw new Error("--confirm-hash is required with --apply.");
  const manifest = JSON.parse(await readFile(path.resolve(options.manifest), "utf8")) as RentalRelationshipManifest;
  if (!verifySealedManifest(manifest)) throw new Error("Invalid sealed Rental relationship manifest.");
  if (manifest.manifestHash !== options.confirmHash || computeManifestHash(manifest) !== options.confirmHash) {
    throw new Error("The confirmation hash does not match the sealed manifest content.");
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");
  const state = await readState(db);
  if (state.activeRuns.length > 0) throw new Error("Active pipeline runs block apply.");
  const currentSelected = new Map(selectedRows(state.accounts).map(row => [row.id, row]));
  const alreadyApplied = desiredState(currentSelected.get(328)!, 269)
    && desiredState(currentSelected.get(334)!, 415)
    && stableStringify(state.workspace) === stableStringify(manifest.workspaceExpectedAfter);

  await mkdir(options.outputDir, { recursive: true });
  await writeJson(options.outputDir, "rental-relationship-before.json", {
    workspace: state.workspace,
    accounts: [269, 328, 415, 334].map(id => currentSelected.get(id)),
  });

  if (alreadyApplied) {
    await writeJson(options.outputDir, "rental-relationship-apply-summary.json", {
      mode: "apply",
      selected: 2,
      applied: 0,
      alreadyApplied: true,
      manifestHash: manifest.manifestHash,
      databaseWrites: 0,
      workspaceAfter: state.workspace,
    });
    process.stdout.write(`${JSON.stringify({ mode: "apply", applied: 0, alreadyApplied: true }, null, 2)}\n`);
    return;
  }

  if (manifest.databaseIdentity !== databaseIdentity(state.accounts)) throw new Error("Database identity changed; regenerate and reseal.");
  if (manifest.databaseFingerprint !== databaseFingerprint(state.accounts, state.workspace)) throw new Error("Database fingerprint changed; regenerate and reseal.");
  validateSourceTopology(selectedRows(state.accounts));
  const beforeById = new Map(currentSelected);
  const now = new Date();

  const transactionResult = await db.transaction(async (tx: any) => {
    const locked = await tx.select().from(fullPotentialAccounts).where(inArray(fullPotentialAccounts.id, [269, 328, 415, 334]));
    validateSourceTopology(locked);

    await tx.update(fullPotentialAccounts).set({
      parentAccountId: 269,
      relationshipType: RENTAL_RELATIONSHIP_PERSISTED_TYPE as any,
      countsTowardPotential: false,
      updatedAt: now,
    }).where(and(
      eq(fullPotentialAccounts.id, 328),
      isNull(fullPotentialAccounts.parentAccountId),
      isNull(fullPotentialAccounts.mergedIntoAccountId),
      eq(fullPotentialAccounts.relationshipType, "standalone" as any),
      eq(fullPotentialAccounts.recordStatus, "active" as any),
      eq(fullPotentialAccounts.countsTowardPotential, true),
    ));

    await tx.update(fullPotentialAccounts).set({
      parentAccountId: 415,
      relationshipType: RENTAL_RELATIONSHIP_PERSISTED_TYPE as any,
      countsTowardPotential: false,
      updatedAt: now,
    }).where(and(
      eq(fullPotentialAccounts.id, 334),
      isNull(fullPotentialAccounts.parentAccountId),
      isNull(fullPotentialAccounts.mergedIntoAccountId),
      eq(fullPotentialAccounts.relationshipType, "standalone" as any),
      eq(fullPotentialAccounts.recordStatus, "active" as any),
      eq(fullPotentialAccounts.countsTowardPotential, true),
    ));

    const [accountsAfter, actionsAfter, signalsAfter] = await Promise.all([
      tx.select().from(fullPotentialAccounts),
      tx.select().from(fullPotentialActions),
      tx.select().from(fullPotentialSignals),
    ]);
    const selectedAfter = selectedRows(accountsAfter);
    const afterMap = new Map(selectedAfter.map(row => [row.id, row]));
    if (!desiredState(afterMap.get(328)!, 269)) throw new Error("Account 328 did not reach the exact approved after state.");
    if (!desiredState(afterMap.get(334)!, 415)) throw new Error("Account 334 did not reach the exact approved after state.");
    assertImmutable(beforeById, selectedAfter);
    const workspaceAfter = projectWorkspace(buildRentalHireWorkspace(accountsAfter, actionsAfter, signalsAfter, { limit: 200, view: "all" }));
    if (stableStringify(workspaceAfter) !== stableStringify(manifest.workspaceExpectedAfter)) {
      throw new Error(`Post-apply workspace mismatch: expected=${stableStringify(manifest.workspaceExpectedAfter)} actual=${stableStringify(workspaceAfter)}`);
    }
    return { selectedAfter, workspaceAfter };
  });

  await writeJson(options.outputDir, "rental-relationship-after.json", {
    workspace: transactionResult.workspaceAfter,
    accounts: transactionResult.selectedAfter,
  });
  await writeJson(options.outputDir, "rental-relationship-apply-summary.json", {
    mode: "apply",
    selected: 2,
    applied: 2,
    alreadyApplied: false,
    manifestHash: manifest.manifestHash,
    changedAccountIds: [328, 334],
    changedFields: ["parentAccountId", "relationshipType", "countsTowardPotential", "updatedAt"],
    persistedRelationshipType: RENTAL_RELATIONSHIP_PERSISTED_TYPE,
    relationshipSemantic: "strategic_context",
    workspaceBefore: manifest.workspaceBefore,
    workspaceAfter: transactionResult.workspaceAfter,
  });
  process.stdout.write(`${JSON.stringify({ mode: "apply", applied: 2, changedAccountIds: [328, 334], manifestHash: manifest.manifestHash }, null, 2)}\n`);
}

export async function runRentalRelationshipCli(argv = process.argv.slice(2)): Promise<void> {
  const options = parseRentalRelationshipArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.outputDir) throw new Error("--output-dir is required.");
  options.outputDir = path.resolve(options.outputDir);
  if (options.apply) return apply(options);
  if (options.seal) return seal(options);
  return generate(options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRentalRelationshipCli().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
