import type { FullPotentialPublicObservationRecord } from "./fullPotentialPublicDraftPack";

export interface FullPotentialReconciliationAccount {
  id: number;
  stableKey: string;
  canonicalName: string;
  displayName?: string | null;
  parentGroup?: string | null;
  rowClass: "account" | "site_context" | "channel_managed" | "competitor_watch" | "cluster_signal";
  relationshipType?: string | null;
  recordStatus: "active" | "under_review" | "merged" | "parked" | "excluded";
  countsTowardPotential: boolean;
  mergedIntoAccountId?: number | null;
  country: string;
  routeToMarket: string;
}

export interface FullPotentialReconciliationAlias {
  accountId: number;
  aliasName: string;
  aliasType?: string | null;
  confidenceLevel?: string | null;
}

export interface FullPotentialReconciliationCandidate {
  accountId: number;
  stableKey: string;
  canonicalName: string;
  score: number;
  matchedOn: string[];
}

export type FullPotentialReconciliationDisposition =
  | "matched"
  | "unmatched"
  | "ambiguous"
  | "not_buyer_counting";

export interface FullPotentialReconciliationResult {
  recordKey: string;
  buyerAccountKey: string | null;
  buyerName: string | null;
  disposition: FullPotentialReconciliationDisposition;
  matchedAccountId: number | null;
  matchedStableKey: string | null;
  candidates: FullPotentialReconciliationCandidate[];
  reason: string;
}

export interface FullPotentialReconciliationSummary {
  recordCount: number;
  buyerCountingCount: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  nonCountingCount: number;
  results: FullPotentialReconciliationResult[];
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bpty\b|\bltd\b|\blimited\b|\baustralia\b|\baustralian\b/g, " ")
    .replace(/\bgroup\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slugWords(value: unknown): string {
  return normalize(value).replace(/\s+/g, " ");
}

function eligible(account: FullPotentialReconciliationAccount): boolean {
  return (
    account.rowClass === "account"
    && account.countsTowardPotential
    && !["merged", "parked", "excluded"].includes(account.recordStatus)
    && account.mergedIntoAccountId == null
    && account.country.trim().toUpperCase() === "AU"
    && account.routeToMarket !== "exclude"
  );
}

function nameValues(
  account: FullPotentialReconciliationAccount,
  aliases: FullPotentialReconciliationAlias[],
): Array<{ kind: string; normalized: string }> {
  const values = [
    { kind: "canonicalName", value: account.canonicalName },
    { kind: "displayName", value: account.displayName },
    { kind: "parentGroup", value: account.parentGroup },
    ...aliases.map(alias => ({ kind: `alias:${alias.aliasType ?? "other"}`, value: alias.aliasName })),
  ];
  const seen = new Set<string>();
  return values
    .map(({ kind, value }) => ({ kind, normalized: normalize(value) }))
    .filter(({ normalized }) => {
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function candidateScore(
  record: FullPotentialPublicObservationRecord,
  account: FullPotentialReconciliationAccount,
  aliases: FullPotentialReconciliationAlias[],
): FullPotentialReconciliationCandidate | null {
  const buyerName = normalize(record.buyerName);
  const buyerKey = slugWords(record.buyerAccountKey?.replace(/-au$/i, ""));
  const matchedOn: string[] = [];
  let score = 0;

  for (const value of nameValues(account, aliases)) {
    if (buyerName && value.normalized === buyerName) {
      const points = value.kind.startsWith("alias:") ? 100 : 110;
      if (points > score) score = points;
      matchedOn.push(`${value.kind}:exact-buyer-name`);
      continue;
    }
    if (buyerKey && value.normalized === buyerKey) {
      if (100 > score) score = 100;
      matchedOn.push(`${value.kind}:exact-buyer-key`);
      continue;
    }

    const longer = value.normalized.length >= buyerName.length
      ? value.normalized
      : buyerName;
    const shorter = value.normalized.length < buyerName.length
      ? value.normalized
      : buyerName;
    if (buyerName && shorter.length >= 6 && longer.includes(shorter)) {
      if (75 > score) score = 75;
      matchedOn.push(`${value.kind}:name-containment`);
    }
  }

  if (score === 0) return null;
  if (account.recordStatus === "under_review") score -= 5;

  return {
    accountId: account.id,
    stableKey: account.stableKey,
    canonicalName: account.canonicalName,
    score,
    matchedOn: [...new Set(matchedOn)].sort(),
  };
}

function requiresAccountTarget(record: FullPotentialPublicObservationRecord): boolean {
  return record.countingTreatment === "buyer_counting"
    && record.valueClass !== "unobserved_allowance";
}

export function reconcileFullPotentialPublicBuyers(
  records: FullPotentialPublicObservationRecord[],
  accounts: FullPotentialReconciliationAccount[],
  aliases: FullPotentialReconciliationAlias[],
): FullPotentialReconciliationSummary {
  const aliasesByAccount = new Map<number, FullPotentialReconciliationAlias[]>();
  for (const alias of aliases) {
    const rows = aliasesByAccount.get(alias.accountId) ?? [];
    rows.push(alias);
    aliasesByAccount.set(alias.accountId, rows);
  }
  const eligibleAccounts = accounts.filter(eligible);

  const results = records.map<FullPotentialReconciliationResult>(record => {
    if (!requiresAccountTarget(record)) {
      const reason = record.valueClass === "unobserved_allowance"
        ? "Unobserved allowance remains management-only and cannot receive a production account target."
        : "Non-counting public context/application record does not require a monetary account target.";
      return {
        recordKey: record.recordKey,
        buyerAccountKey: record.buyerAccountKey,
        buyerName: record.buyerName,
        disposition: "not_buyer_counting",
        matchedAccountId: null,
        matchedStableKey: null,
        candidates: [],
        reason,
      };
    }

    const candidates = eligibleAccounts
      .map(account => candidateScore(record, account, aliasesByAccount.get(account.id) ?? []))
      .filter((candidate): candidate is FullPotentialReconciliationCandidate => candidate !== null)
      .sort((left, right) => right.score - left.score || left.accountId - right.accountId);

    if (candidates.length === 0) {
      return {
        recordKey: record.recordKey,
        buyerAccountKey: record.buyerAccountKey,
        buyerName: record.buyerName,
        disposition: "unmatched",
        matchedAccountId: null,
        matchedStableKey: null,
        candidates: [],
        reason: "No eligible active Australian counting account matched the public buyer identity.",
      };
    }

    const topScore = candidates[0].score;
    const top = candidates.filter(candidate => candidate.score === topScore);
    if (top.length !== 1 || topScore < 90) {
      return {
        recordKey: record.recordKey,
        buyerAccountKey: record.buyerAccountKey,
        buyerName: record.buyerName,
        disposition: "ambiguous",
        matchedAccountId: null,
        matchedStableKey: null,
        candidates: candidates.slice(0, 10),
        reason: top.length > 1
          ? `Multiple eligible accounts share the top identity score ${topScore}.`
          : `The strongest match score ${topScore} is below the automatic-match threshold.`,
      };
    }

    return {
      recordKey: record.recordKey,
      buyerAccountKey: record.buyerAccountKey,
      buyerName: record.buyerName,
      disposition: "matched",
      matchedAccountId: top[0].accountId,
      matchedStableKey: top[0].stableKey,
      candidates: top,
      reason: `One eligible account matched with score ${topScore}.`,
    };
  });

  return {
    recordCount: records.length,
    buyerCountingCount: results.filter(result => result.disposition !== "not_buyer_counting").length,
    matchedCount: results.filter(result => result.disposition === "matched").length,
    unmatchedCount: results.filter(result => result.disposition === "unmatched").length,
    ambiguousCount: results.filter(result => result.disposition === "ambiguous").length,
    nonCountingCount: results.filter(result => result.disposition === "not_buyer_counting").length,
    results,
  };
}

/**
 * A buyer may legitimately carry several distinct commercial pools (for example
 * conventional Rental replacement plus TS2 and TS4 electric adoption) on one
 * canonical account. Completion therefore validates buyer identity, not a
 * one-record-per-account assumption. Unobserved allowances are management-only.
 */
export function assertFullPotentialReconciliationComplete(
  summary: FullPotentialReconciliationSummary,
): void {
  if (summary.unmatchedCount > 0 || summary.ambiguousCount > 0) {
    throw new Error(
      `Full Potential account reconciliation incomplete: ${summary.unmatchedCount} unmatched, ${summary.ambiguousCount} ambiguous`,
    );
  }

  const matched = summary.results.filter(
    (result): result is FullPotentialReconciliationResult & {
      buyerAccountKey: string;
      matchedAccountId: number;
    } => (
      result.disposition === "matched"
      && typeof result.buyerAccountKey === "string"
      && result.buyerAccountKey.length > 0
      && typeof result.matchedAccountId === "number"
    ),
  );

  const accountIdsByBuyer = new Map<string, Set<number>>();
  const buyerKeysByAccount = new Map<number, Set<string>>();
  for (const result of matched) {
    const accountIds = accountIdsByBuyer.get(result.buyerAccountKey) ?? new Set<number>();
    accountIds.add(result.matchedAccountId);
    accountIdsByBuyer.set(result.buyerAccountKey, accountIds);

    const buyerKeys = buyerKeysByAccount.get(result.matchedAccountId) ?? new Set<string>();
    buyerKeys.add(result.buyerAccountKey);
    buyerKeysByAccount.set(result.matchedAccountId, buyerKeys);
  }

  for (const [buyerAccountKey, accountIds] of accountIdsByBuyer) {
    if (accountIds.size > 1) {
      throw new Error(
        `Full Potential reconciliation maps buyer ${buyerAccountKey} to multiple counting accounts`,
      );
    }
  }

  for (const [accountId, buyerAccountKeys] of buyerKeysByAccount) {
    if (buyerAccountKeys.size > 1) {
      throw new Error(
        `Full Potential reconciliation maps distinct public buyer identities to counting account ${accountId}`,
      );
    }
  }
}
