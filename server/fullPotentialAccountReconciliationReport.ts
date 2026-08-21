import { createHash } from "node:crypto";
import type { FullPotentialPublicObservationRecord } from "../shared/fullPotentialPublicDraftPack";
import {
  assertFullPotentialReconciliationComplete,
  reconcileFullPotentialPublicBuyers,
  type FullPotentialReconciliationAccount,
  type FullPotentialReconciliationAlias,
  type FullPotentialReconciliationSummary,
} from "../shared/fullPotentialAccountReconciliation";
import type { FullPotentialImportAccountTarget } from "./fullPotentialPublicImportManifest";
import type { RouteToMarket } from "./fullPotentialCommercialModel.shared";

export interface FullPotentialAccountSnapshot {
  snapshotRef: string;
  capturedAt: string;
  accounts: FullPotentialReconciliationAccount[];
  aliases: FullPotentialReconciliationAlias[];
}

export interface FullPotentialReconciliationReport {
  version: 1;
  snapshotRef: string;
  capturedAt: string;
  publicRecordCount: number;
  requiredBuyerIdentityCount: number;
  summary: FullPotentialReconciliationSummary;
  importTargets: FullPotentialImportAccountTarget[];
  unresolvedRecordKeys: string[];
  completeForDraftImport: boolean;
  invariants: {
    databaseConnections: 0;
    databaseWrites: 0;
    accountMutations: 0;
    crmWrites: 0;
    providerCalls: 0;
    pipelineInvocations: 0;
  };
  reportSha256: string;
}

const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function assertSnapshot(snapshot: FullPotentialAccountSnapshot): void {
  if (!OPAQUE_REFERENCE_PATTERN.test(snapshot.snapshotRef)) {
    throw new Error("snapshotRef must be an opaque non-sensitive reference");
  }
  if (Number.isNaN(Date.parse(snapshot.capturedAt))) {
    throw new Error("capturedAt must be a valid date");
  }
  const accountIds = new Set<number>();
  const stableKeys = new Set<string>();
  for (const account of snapshot.accounts) {
    if (!Number.isInteger(account.id) || account.id <= 0) {
      throw new Error("snapshot account id must be a positive integer");
    }
    if (!account.stableKey?.trim() || !account.canonicalName?.trim()) {
      throw new Error(`snapshot account ${account.id} requires stableKey and canonicalName`);
    }
    if (accountIds.has(account.id)) throw new Error(`Duplicate snapshot account id ${account.id}`);
    if (stableKeys.has(account.stableKey)) throw new Error(`Duplicate snapshot stableKey ${account.stableKey}`);
    accountIds.add(account.id);
    stableKeys.add(account.stableKey);
  }
  for (const alias of snapshot.aliases) {
    if (!accountIds.has(alias.accountId)) {
      throw new Error(`Alias references missing snapshot account ${alias.accountId}`);
    }
    if (!alias.aliasName?.trim()) throw new Error("snapshot aliasName is required");
  }
}

function routeToMarket(value: string): RouteToMarket {
  const allowed = new Set<RouteToMarket>([
    "direct_ape",
    "cea",
    "cp_aps",
    "cp_blastone",
    "cp_pneumatic_engineering",
    "cp_more_air",
    "nz_distributor",
    "png_oceania",
    "hybrid_strategic",
    "product_support",
    "manual_review",
    "exclude",
  ]);
  if (!allowed.has(value as RouteToMarket)) {
    throw new Error(`Unsupported routeToMarket ${value} in reconciliation snapshot`);
  }
  return value as RouteToMarket;
}

function requiredBuyerIdentityCount(records: FullPotentialPublicObservationRecord[]): number {
  return new Set(
    records
      .filter(record => record.countingTreatment === "buyer_counting")
      .map(record => record.buyerAccountKey)
      .filter((value): value is string => Boolean(value?.trim())),
  ).size;
}

export function buildFullPotentialAccountReconciliationReport(
  records: FullPotentialPublicObservationRecord[],
  snapshot: FullPotentialAccountSnapshot,
): FullPotentialReconciliationReport {
  assertSnapshot(snapshot);
  const summary = reconcileFullPotentialPublicBuyers(records, snapshot.accounts, snapshot.aliases);
  const requiredBuyerCount = requiredBuyerIdentityCount(records);
  const accountById = new Map(snapshot.accounts.map(account => [account.id, account]));
  const targetsByBuyer = new Map<string, FullPotentialImportAccountTarget>();

  for (const result of summary.results) {
    if (
      result.disposition !== "matched"
      || !result.buyerAccountKey
      || result.matchedAccountId === null
    ) continue;
    const account = accountById.get(result.matchedAccountId);
    if (!account) throw new Error(`Matched account ${result.matchedAccountId} missing from snapshot`);
    const target: FullPotentialImportAccountTarget = {
      buyerAccountKey: result.buyerAccountKey,
      accountId: account.id,
      stableKey: account.stableKey,
      routeToMarket: routeToMarket(account.routeToMarket),
      countsTowardPotential: account.countsTowardPotential,
      recordStatus: account.recordStatus,
      rowClass: account.rowClass,
    };
    const existing = targetsByBuyer.get(result.buyerAccountKey);
    if (existing && existing.accountId !== target.accountId) {
      throw new Error(`Buyer ${result.buyerAccountKey} resolved to multiple account targets`);
    }
    targetsByBuyer.set(result.buyerAccountKey, target);
  }

  const importTargets = [...targetsByBuyer.values()]
    .sort((left, right) => left.buyerAccountKey.localeCompare(right.buyerAccountKey));
  const unresolvedRecordKeys = summary.results
    .filter(result => result.disposition === "unmatched" || result.disposition === "ambiguous")
    .map(result => result.recordKey)
    .sort();

  let completeForDraftImport = false;
  try {
    assertFullPotentialReconciliationComplete(summary);
    completeForDraftImport = importTargets.length === requiredBuyerCount;
  } catch {
    completeForDraftImport = false;
  }

  const unsigned = {
    version: 1 as const,
    snapshotRef: snapshot.snapshotRef,
    capturedAt: new Date(snapshot.capturedAt).toISOString(),
    publicRecordCount: records.length,
    requiredBuyerIdentityCount: requiredBuyerCount,
    summary,
    importTargets,
    unresolvedRecordKeys,
    completeForDraftImport,
    invariants: {
      databaseConnections: 0 as const,
      databaseWrites: 0 as const,
      accountMutations: 0 as const,
      crmWrites: 0 as const,
      providerCalls: 0 as const,
      pipelineInvocations: 0 as const,
    },
  };

  return {
    ...unsigned,
    reportSha256: sha256(unsigned),
  };
}

export function verifyFullPotentialAccountReconciliationReport(
  report: FullPotentialReconciliationReport,
): void {
  const { reportSha256, ...unsigned } = report;
  if (!/^[a-f0-9]{64}$/.test(reportSha256) || sha256(unsigned) !== reportSha256) {
    throw new Error("Full Potential reconciliation report SHA-256 mismatch");
  }
  if (
    report.invariants.databaseConnections !== 0
    || report.invariants.databaseWrites !== 0
    || report.invariants.accountMutations !== 0
    || report.invariants.crmWrites !== 0
    || report.invariants.providerCalls !== 0
    || report.invariants.pipelineInvocations !== 0
  ) {
    throw new Error("Full Potential reconciliation report violates the read-only boundary");
  }
  if (report.completeForDraftImport) {
    assertFullPotentialReconciliationComplete(report.summary);
    if (report.importTargets.length !== report.requiredBuyerIdentityCount) {
      throw new Error("Complete reconciliation report does not cover every unique buyer identity");
    }
  }
}
