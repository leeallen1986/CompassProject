import { createHash } from "node:crypto";
import type {
  FullPotentialReconciliationAccount,
  FullPotentialReconciliationAlias,
} from "../shared/fullPotentialAccountReconciliation";
import type {
  FullPotentialLookalikeCandidate,
  FullPotentialLookalikeIdentityStatus,
  FullPotentialLookalikeReviewState,
} from "../shared/fullPotentialLookalikeDiscovery";

export interface FullPotentialLookalikeAccountSnapshot {
  snapshotRef: string;
  capturedAt: string;
  accounts: FullPotentialReconciliationAccount[];
  aliases: FullPotentialReconciliationAlias[];
}

export interface FullPotentialLookalikeGovernanceDelta {
  version: 1;
  deltaRef: string;
  appliedAt: string;
  baseSnapshotSha256: string;
  accounts: FullPotentialReconciliationAccount[];
  aliases: FullPotentialReconciliationAlias[];
}

export type FullPotentialLookalikeIdentityDisposition =
  | "existing_account"
  | "existing_market_context"
  | "new_identity"
  | "ambiguous_identity"
  | "excluded_market_participant";

export interface FullPotentialLookalikeIdentityCandidateMatch {
  accountId: number;
  stableKey: string;
  canonicalName: string;
  displayName: string | null;
  rowClass: FullPotentialReconciliationAccount["rowClass"];
  relationshipType: string | null;
  recordStatus: FullPotentialReconciliationAccount["recordStatus"];
  countsTowardPotential: boolean;
  routeToMarket: string;
  score: number;
  matchedOn: string[];
}

export interface FullPotentialLookalikeIdentityResolutionRow {
  candidateKey: string;
  candidateName: string;
  marketRole: FullPotentialLookalikeCandidate["marketRole"];
  disposition: FullPotentialLookalikeIdentityDisposition;
  proposedIdentityStatus: FullPotentialLookalikeIdentityStatus;
  proposedReviewState: FullPotentialLookalikeReviewState;
  proposedRouteToMarket: string;
  proposedOwner: null;
  matchedAccountId: number | null;
  matchedStableKey: string | null;
  candidates: FullPotentialLookalikeIdentityCandidateMatch[];
  reason: string;
  countsTowardPotential: false;
  monetaryImpactAud: 0;
  weeklyRecommendationEligible: false;
  durableActionCreated: false;
  manualApprovalRequired: true;
}

export interface FullPotentialLookalikeReviewOverride {
  candidateKey: string;
  identityStatus: FullPotentialLookalikeIdentityStatus;
  reviewState: FullPotentialLookalikeReviewState;
  proposedRouteToMarket: string;
  proposedOwner: null;
  recurringProgrammeEvidence: { reviewed: false; count: 0 };
  currentSignalEvidence: { reviewed: false; count: 0 };
}

export interface FullPotentialLookalikeReviewInput {
  version: 1;
  overrides: FullPotentialLookalikeReviewOverride[];
}

export interface FullPotentialLookalikeGovernedSnapshotSummary {
  version: 1;
  baseSnapshotRef: string;
  baseCapturedAt: string;
  deltaRef: string;
  deltaAppliedAt: string;
  baseSnapshotSha256: string;
  governanceDeltaSha256: string;
  governedSnapshotSha256: string;
  beforeAccountCount: number;
  afterAccountCount: number;
  beforeAliasCount: number;
  afterAliasCount: number;
  createdAccountCount: number;
  replacedAccountCount: number;
  addedAliasCount: number;
}

export interface FullPotentialLookalikeIdentityReport {
  version: 1;
  sourceSha: string;
  methodologyVersion: "fp-lookalike-identity-v1";
  governedSnapshot: FullPotentialLookalikeGovernedSnapshotSummary;
  counts: {
    candidateCount: number;
    buyerCandidateCount: number;
    marketParticipantControlCount: number;
    existingAccountCount: number;
    existingMarketContextCount: number;
    newIdentityCount: number;
    ambiguousIdentityCount: number;
    excludedMarketParticipantCount: number;
    weeklyRecommendationEligibleCount: 0;
  };
  completeForCandidateCreation: false;
  manualReviewRequired: true;
  results: FullPotentialLookalikeIdentityResolutionRow[];
  reviewInput: FullPotentialLookalikeReviewInput;
  safety: {
    databaseConnections: 0;
    databaseWrites: 0;
    fullPotentialAccountMutations: 0;
    fullPotentialMonetaryMutations: 0;
    crmC4cMutations: 0;
    contactEnrichmentMutations: 0;
    providerCalls: 0;
    pipelineInvocations: 0;
    durableActionsCreated: 0;
    deployments: 0;
  };
  reportSha256: string;
}

const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/;
const ACCOUNT_KEYS = new Set([
  "id",
  "stableKey",
  "canonicalName",
  "displayName",
  "parentGroup",
  "rowClass",
  "relationshipType",
  "recordStatus",
  "countsTowardPotential",
  "mergedIntoAccountId",
  "country",
  "routeToMarket",
]);
const ALIAS_KEYS = new Set([
  "accountId",
  "aliasName",
  "aliasType",
  "confidenceLevel",
]);

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function assertExactKeys(value: unknown, allowed: Set<string>, field: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const unknown = Object.keys(value as Record<string, unknown>)
    .filter(key => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${field} contains forbidden fields: ${unknown.sort().join(",")}`);
  }
}

function assertOpaque(value: string, field: string): void {
  if (!OPAQUE_REFERENCE_PATTERN.test(value)) {
    throw new Error(`${field} must be an opaque non-sensitive reference`);
  }
}

function assertDate(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be a valid date`);
}

function assertAccount(
  value: FullPotentialReconciliationAccount,
  field: string,
): void {
  assertExactKeys(value, ACCOUNT_KEYS, field);
  if (!Number.isInteger(value.id) || value.id <= 0) {
    throw new Error(`${field}.id must be a positive integer`);
  }
  if (!value.stableKey?.trim() || !value.canonicalName?.trim()) {
    throw new Error(`${field} requires stableKey and canonicalName`);
  }
  if (value.country.trim().toUpperCase() !== "AU") {
    throw new Error(`${field}.country must be AU`);
  }
  if (![
    "account",
    "site_context",
    "channel_managed",
    "competitor_watch",
    "cluster_signal",
  ].includes(value.rowClass)) {
    throw new Error(`${field}.rowClass is invalid`);
  }
  if (!["active", "under_review", "merged", "parked", "excluded"].includes(value.recordStatus)) {
    throw new Error(`${field}.recordStatus is invalid`);
  }
  if (typeof value.countsTowardPotential !== "boolean") {
    throw new Error(`${field}.countsTowardPotential must be boolean`);
  }
  if (
    value.mergedIntoAccountId !== null
    && value.mergedIntoAccountId !== undefined
    && (!Number.isInteger(value.mergedIntoAccountId) || value.mergedIntoAccountId <= 0)
  ) {
    throw new Error(`${field}.mergedIntoAccountId is invalid`);
  }
  if (!value.routeToMarket?.trim()) throw new Error(`${field}.routeToMarket is required`);
}

function assertAlias(value: FullPotentialReconciliationAlias, field: string): void {
  assertExactKeys(value, ALIAS_KEYS, field);
  if (!Number.isInteger(value.accountId) || value.accountId <= 0) {
    throw new Error(`${field}.accountId must be a positive integer`);
  }
  if (!value.aliasName?.trim()) throw new Error(`${field}.aliasName is required`);
}

function assertSnapshot(snapshot: FullPotentialLookalikeAccountSnapshot): void {
  assertOpaque(snapshot.snapshotRef, "snapshotRef");
  assertDate(snapshot.capturedAt, "capturedAt");
  if (!Array.isArray(snapshot.accounts) || !Array.isArray(snapshot.aliases)) {
    throw new Error("snapshot requires accounts and aliases arrays");
  }
  const ids = new Set<number>();
  const stableKeys = new Set<string>();
  snapshot.accounts.forEach((account, index) => {
    assertAccount(account, `snapshot.accounts[${index}]`);
    if (ids.has(account.id)) throw new Error(`Duplicate snapshot account id ${account.id}`);
    if (stableKeys.has(account.stableKey)) {
      throw new Error(`Duplicate snapshot stableKey ${account.stableKey}`);
    }
    ids.add(account.id);
    stableKeys.add(account.stableKey);
  });
  const aliasKeys = new Set<string>();
  snapshot.aliases.forEach((alias, index) => {
    assertAlias(alias, `snapshot.aliases[${index}]`);
    if (!ids.has(alias.accountId)) {
      throw new Error(`Snapshot alias references missing account ${alias.accountId}`);
    }
    const key = `${alias.accountId}:${normalize(alias.aliasName)}`;
    if (aliasKeys.has(key)) throw new Error(`Duplicate snapshot alias ${key}`);
    aliasKeys.add(key);
  });
}

function assertDelta(delta: FullPotentialLookalikeGovernanceDelta): void {
  if (delta.version !== 1) throw new Error("Unsupported governance delta version");
  assertOpaque(delta.deltaRef, "deltaRef");
  assertDate(delta.appliedAt, "appliedAt");
  if (!SHA256_PATTERN.test(delta.baseSnapshotSha256)) {
    throw new Error("baseSnapshotSha256 must be a SHA-256");
  }
  if (!Array.isArray(delta.accounts) || delta.accounts.length < 1) {
    throw new Error("governance delta requires at least one account row");
  }
  if (!Array.isArray(delta.aliases)) throw new Error("governance delta aliases must be an array");
  const ids = new Set<number>();
  const stableKeys = new Set<string>();
  delta.accounts.forEach((account, index) => {
    assertAccount(account, `delta.accounts[${index}]`);
    if (ids.has(account.id)) throw new Error(`Duplicate delta account id ${account.id}`);
    if (stableKeys.has(account.stableKey)) {
      throw new Error(`Duplicate delta stableKey ${account.stableKey}`);
    }
    ids.add(account.id);
    stableKeys.add(account.stableKey);
  });
  const aliases = new Set<string>();
  delta.aliases.forEach((alias, index) => {
    assertAlias(alias, `delta.aliases[${index}]`);
    const key = `${alias.accountId}:${normalize(alias.aliasName)}`;
    if (aliases.has(key)) throw new Error(`Duplicate delta alias ${key}`);
    aliases.add(key);
  });
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bpty\b|\bltd\b|\blimited\b|\baustralia\b|\baustralian\b/g, " ")
    .replace(/\bgroup\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function materializeGovernedSnapshot(
  snapshot: FullPotentialLookalikeAccountSnapshot,
  delta: FullPotentialLookalikeGovernanceDelta,
): {
  snapshot: FullPotentialLookalikeAccountSnapshot;
  summary: FullPotentialLookalikeGovernedSnapshotSummary;
} {
  assertSnapshot(snapshot);
  assertDelta(delta);
  const baseSnapshotSha256 = sha256(snapshot);
  if (baseSnapshotSha256 !== delta.baseSnapshotSha256) {
    throw new Error("Governance delta base snapshot SHA-256 mismatch");
  }

  const accounts = new Map(snapshot.accounts.map(account => [account.id, account]));
  const beforeIds = new Set(accounts.keys());
  for (const account of delta.accounts) accounts.set(account.id, account);

  const stableKeys = new Map<string, number>();
  for (const account of accounts.values()) {
    const existing = stableKeys.get(account.stableKey);
    if (existing !== undefined && existing !== account.id) {
      throw new Error(`Governed snapshot stableKey collision ${account.stableKey}`);
    }
    stableKeys.set(account.stableKey, account.id);
  }

  const aliases = new Map<string, FullPotentialReconciliationAlias>();
  for (const alias of snapshot.aliases) {
    aliases.set(`${alias.accountId}:${normalize(alias.aliasName)}`, alias);
  }
  let addedAliasCount = 0;
  for (const alias of delta.aliases) {
    if (!accounts.has(alias.accountId)) {
      throw new Error(`Delta alias references missing governed account ${alias.accountId}`);
    }
    const key = `${alias.accountId}:${normalize(alias.aliasName)}`;
    if (!aliases.has(key)) addedAliasCount += 1;
    aliases.set(key, alias);
  }

  for (const alias of aliases.values()) {
    if (!accounts.has(alias.accountId)) {
      throw new Error(`Governed alias references missing account ${alias.accountId}`);
    }
  }

  const governed: FullPotentialLookalikeAccountSnapshot = {
    snapshotRef: `${snapshot.snapshotRef}:governed`,
    capturedAt: new Date(delta.appliedAt).toISOString(),
    accounts: [...accounts.values()].sort((left, right) => left.id - right.id),
    aliases: [...aliases.values()].sort((left, right) => (
      left.accountId - right.accountId
      || left.aliasName.localeCompare(right.aliasName)
    )),
  };
  assertSnapshot(governed);

  const governedSnapshotSha256 = sha256(governed);
  return {
    snapshot: governed,
    summary: {
      version: 1,
      baseSnapshotRef: snapshot.snapshotRef,
      baseCapturedAt: new Date(snapshot.capturedAt).toISOString(),
      deltaRef: delta.deltaRef,
      deltaAppliedAt: new Date(delta.appliedAt).toISOString(),
      baseSnapshotSha256,
      governanceDeltaSha256: sha256(delta),
      governedSnapshotSha256,
      beforeAccountCount: snapshot.accounts.length,
      afterAccountCount: governed.accounts.length,
      beforeAliasCount: snapshot.aliases.length,
      afterAliasCount: governed.aliases.length,
      createdAccountCount: delta.accounts.filter(account => !beforeIds.has(account.id)).length,
      replacedAccountCount: delta.accounts.filter(account => beforeIds.has(account.id)).length,
      addedAliasCount,
    },
  };
}

function namesFor(
  account: FullPotentialReconciliationAccount,
  aliases: FullPotentialReconciliationAlias[],
): Array<{ kind: string; value: string }> {
  const values = [
    { kind: "canonicalName", value: account.canonicalName },
    { kind: "displayName", value: account.displayName ?? "" },
    { kind: "parentGroup", value: account.parentGroup ?? "" },
    ...aliases.map(alias => ({ kind: `alias:${alias.aliasType ?? "other"}`, value: alias.aliasName })),
  ];
  const seen = new Set<string>();
  return values
    .map(row => ({ kind: row.kind, value: normalize(row.value) }))
    .filter(row => {
      if (!row.value || seen.has(row.value)) return false;
      seen.add(row.value);
      return true;
    });
}

function scoreCandidate(
  candidate: FullPotentialLookalikeCandidate,
  account: FullPotentialReconciliationAccount,
  aliases: FullPotentialReconciliationAlias[],
): FullPotentialLookalikeIdentityCandidateMatch | null {
  const candidateName = normalize(candidate.candidateName);
  const candidateKey = normalize(candidate.candidateKey.replace(/-/g, " "));
  let score = 0;
  const matchedOn: string[] = [];

  for (const name of namesFor(account, aliases)) {
    if (name.value === candidateName) {
      const points = name.kind.startsWith("alias:") ? 100 : 110;
      score = Math.max(score, points);
      matchedOn.push(`${name.kind}:exact-candidate-name`);
      continue;
    }
    if (name.value === candidateKey) {
      score = Math.max(score, 100);
      matchedOn.push(`${name.kind}:exact-candidate-key`);
      continue;
    }
    const shorter = name.value.length < candidateName.length ? name.value : candidateName;
    const longer = name.value.length >= candidateName.length ? name.value : candidateName;
    if (shorter.length >= 6 && longer.includes(shorter)) {
      score = Math.max(score, 75);
      matchedOn.push(`${name.kind}:name-containment`);
    }
  }

  if (score === 0) return null;
  if (account.recordStatus === "under_review") score -= 5;
  if (account.recordStatus === "merged" || account.mergedIntoAccountId) score -= 10;

  return {
    accountId: account.id,
    stableKey: account.stableKey,
    canonicalName: account.canonicalName,
    displayName: account.displayName ?? null,
    rowClass: account.rowClass,
    relationshipType: account.relationshipType ?? null,
    recordStatus: account.recordStatus,
    countsTowardPotential: account.countsTowardPotential,
    routeToMarket: account.routeToMarket,
    score,
    matchedOn: [...new Set(matchedOn)].sort(),
  };
}

function isNonBuyerContext(match: FullPotentialLookalikeIdentityCandidateMatch): boolean {
  return (
    match.rowClass !== "account"
    || match.relationshipType === "strategic_context"
    || match.recordStatus === "excluded"
    || match.routeToMarket === "exclude"
  );
}

function manualReviewOverride(
  candidateKey: string,
  identityStatus: FullPotentialLookalikeIdentityStatus,
  reviewState: FullPotentialLookalikeReviewState,
  proposedRouteToMarket: string,
): FullPotentialLookalikeReviewOverride {
  return {
    candidateKey,
    identityStatus,
    reviewState,
    proposedRouteToMarket,
    proposedOwner: null,
    recurringProgrammeEvidence: { reviewed: false, count: 0 },
    currentSignalEvidence: { reviewed: false, count: 0 },
  };
}

function resolveCandidate(
  candidate: FullPotentialLookalikeCandidate,
  snapshot: FullPotentialLookalikeAccountSnapshot,
): {
  row: FullPotentialLookalikeIdentityResolutionRow;
  override: FullPotentialLookalikeReviewOverride;
} {
  if (candidate.marketRole !== "buyer") {
    return {
      row: {
        candidateKey: candidate.candidateKey,
        candidateName: candidate.candidateName,
        marketRole: candidate.marketRole,
        disposition: "excluded_market_participant",
        proposedIdentityStatus: "not_checked",
        proposedReviewState: "rejected",
        proposedRouteToMarket: "exclude",
        proposedOwner: null,
        matchedAccountId: null,
        matchedStableKey: null,
        candidates: [],
        reason: `Public market role ${candidate.marketRole} is non-promotable.`,
        countsTowardPotential: false,
        monetaryImpactAud: 0,
        weeklyRecommendationEligible: false,
        durableActionCreated: false,
        manualApprovalRequired: true,
      },
      override: manualReviewOverride(
        candidate.candidateKey,
        "not_checked",
        "rejected",
        "exclude",
      ),
    };
  }

  const aliasesByAccount = new Map<number, FullPotentialReconciliationAlias[]>();
  for (const alias of snapshot.aliases) {
    const rows = aliasesByAccount.get(alias.accountId) ?? [];
    rows.push(alias);
    aliasesByAccount.set(alias.accountId, rows);
  }
  const candidates = snapshot.accounts
    .filter(account => account.country.toUpperCase() === "AU")
    .map(account => scoreCandidate(candidate, account, aliasesByAccount.get(account.id) ?? []))
    .filter((row): row is FullPotentialLookalikeIdentityCandidateMatch => row !== null)
    .sort((left, right) => right.score - left.score || left.accountId - right.accountId);

  if (candidates.length === 0) {
    return {
      row: {
        candidateKey: candidate.candidateKey,
        candidateName: candidate.candidateName,
        marketRole: candidate.marketRole,
        disposition: "new_identity",
        proposedIdentityStatus: "new_identity",
        proposedReviewState: "pending_review",
        proposedRouteToMarket: "manual_review",
        proposedOwner: null,
        matchedAccountId: null,
        matchedStableKey: null,
        candidates: [],
        reason: "No governed canonical, display-name or alias identity matched.",
        countsTowardPotential: false,
        monetaryImpactAud: 0,
        weeklyRecommendationEligible: false,
        durableActionCreated: false,
        manualApprovalRequired: true,
      },
      override: manualReviewOverride(
        candidate.candidateKey,
        "new_identity",
        "pending_review",
        "manual_review",
      ),
    };
  }

  const topScore = candidates[0].score;
  const top = candidates.filter(row => row.score === topScore);
  if (top.length !== 1 || topScore < 100) {
    return {
      row: {
        candidateKey: candidate.candidateKey,
        candidateName: candidate.candidateName,
        marketRole: candidate.marketRole,
        disposition: "ambiguous_identity",
        proposedIdentityStatus: "ambiguous_identity",
        proposedReviewState: "pending_review",
        proposedRouteToMarket: "manual_review",
        proposedOwner: null,
        matchedAccountId: null,
        matchedStableKey: null,
        candidates: candidates.slice(0, 10),
        reason: top.length > 1
          ? `Multiple governed identities share the top score ${topScore}.`
          : `Strongest identity score ${topScore} is below the exact-match threshold.`,
        countsTowardPotential: false,
        monetaryImpactAud: 0,
        weeklyRecommendationEligible: false,
        durableActionCreated: false,
        manualApprovalRequired: true,
      },
      override: manualReviewOverride(
        candidate.candidateKey,
        "ambiguous_identity",
        "pending_review",
        "manual_review",
      ),
    };
  }

  const match = top[0];
  if (isNonBuyerContext(match)) {
    return {
      row: {
        candidateKey: candidate.candidateKey,
        candidateName: candidate.candidateName,
        marketRole: candidate.marketRole,
        disposition: "existing_market_context",
        proposedIdentityStatus: "existing_account",
        proposedReviewState: "rejected",
        proposedRouteToMarket: "exclude",
        proposedOwner: null,
        matchedAccountId: match.accountId,
        matchedStableKey: match.stableKey,
        candidates: top,
        reason: `Exact identity already exists as non-buyer/context rowClass=${match.rowClass}.`,
        countsTowardPotential: false,
        monetaryImpactAud: 0,
        weeklyRecommendationEligible: false,
        durableActionCreated: false,
        manualApprovalRequired: true,
      },
      override: manualReviewOverride(
        candidate.candidateKey,
        "existing_account",
        "rejected",
        "exclude",
      ),
    };
  }

  const route = match.routeToMarket === "exclude" ? "manual_review" : match.routeToMarket;
  return {
    row: {
      candidateKey: candidate.candidateKey,
      candidateName: candidate.candidateName,
      marketRole: candidate.marketRole,
      disposition: "existing_account",
      proposedIdentityStatus: "existing_account",
      proposedReviewState: "pending_review",
      proposedRouteToMarket: route,
      proposedOwner: null,
      matchedAccountId: match.accountId,
      matchedStableKey: match.stableKey,
      candidates: top,
      reason: `One governed account matched exactly with score ${topScore}.`,
      countsTowardPotential: false,
      monetaryImpactAud: 0,
      weeklyRecommendationEligible: false,
      durableActionCreated: false,
      manualApprovalRequired: true,
    },
    override: manualReviewOverride(
      candidate.candidateKey,
      "existing_account",
      "pending_review",
      route,
    ),
  };
}

export function buildFullPotentialLookalikeIdentityReport(input: {
  sourceSha: string;
  candidates: FullPotentialLookalikeCandidate[];
  baseSnapshot: FullPotentialLookalikeAccountSnapshot;
  governanceDelta: FullPotentialLookalikeGovernanceDelta;
}): FullPotentialLookalikeIdentityReport {
  if (!SOURCE_SHA_PATTERN.test(input.sourceSha)) throw new Error("sourceSha must be a 40-hex SHA");
  if (!Array.isArray(input.candidates) || input.candidates.length < 1) {
    throw new Error("At least one lookalike candidate is required");
  }
  const candidateKeys = new Set<string>();
  for (const candidate of input.candidates) {
    if (candidateKeys.has(candidate.candidateKey)) {
      throw new Error(`Duplicate lookalike candidateKey ${candidate.candidateKey}`);
    }
    candidateKeys.add(candidate.candidateKey);
  }

  const governed = materializeGovernedSnapshot(input.baseSnapshot, input.governanceDelta);
  const resolved = input.candidates
    .map(candidate => resolveCandidate(candidate, governed.snapshot));
  const results = resolved
    .map(row => row.row)
    .sort((left, right) => left.candidateKey.localeCompare(right.candidateKey));
  const overrides = resolved
    .map(row => row.override)
    .sort((left, right) => left.candidateKey.localeCompare(right.candidateKey));

  if (results.some(row => row.weeklyRecommendationEligible || row.durableActionCreated)) {
    throw new Error("Identity reconciliation must not activate weekly recommendations or actions");
  }
  if (overrides.some(row => (
    row.reviewState === "approved_for_qualification"
    || row.proposedOwner !== null
    || row.currentSignalEvidence.reviewed
    || row.currentSignalEvidence.count !== 0
    || row.recurringProgrammeEvidence.reviewed
    || row.recurringProgrammeEvidence.count !== 0
  ))) {
    throw new Error("Identity review input exceeds the identity-only boundary");
  }

  const counts = {
    candidateCount: results.length,
    buyerCandidateCount: results.filter(row => row.marketRole === "buyer").length,
    marketParticipantControlCount: results.filter(row => row.marketRole !== "buyer").length,
    existingAccountCount: results.filter(row => row.disposition === "existing_account").length,
    existingMarketContextCount: results.filter(row => row.disposition === "existing_market_context").length,
    newIdentityCount: results.filter(row => row.disposition === "new_identity").length,
    ambiguousIdentityCount: results.filter(row => row.disposition === "ambiguous_identity").length,
    excludedMarketParticipantCount: results.filter(
      row => row.disposition === "excluded_market_participant",
    ).length,
    weeklyRecommendationEligibleCount: 0 as const,
  };

  const unsigned = {
    version: 1 as const,
    sourceSha: input.sourceSha,
    methodologyVersion: "fp-lookalike-identity-v1" as const,
    governedSnapshot: governed.summary,
    counts,
    completeForCandidateCreation: false as const,
    manualReviewRequired: true as const,
    results,
    reviewInput: {
      version: 1 as const,
      overrides,
    },
    safety: {
      databaseConnections: 0 as const,
      databaseWrites: 0 as const,
      fullPotentialAccountMutations: 0 as const,
      fullPotentialMonetaryMutations: 0 as const,
      crmC4cMutations: 0 as const,
      contactEnrichmentMutations: 0 as const,
      providerCalls: 0 as const,
      pipelineInvocations: 0 as const,
      durableActionsCreated: 0 as const,
      deployments: 0 as const,
    },
  };

  return {
    ...unsigned,
    reportSha256: sha256(unsigned),
  };
}

export function verifyFullPotentialLookalikeIdentityReport(
  report: FullPotentialLookalikeIdentityReport,
): void {
  const { reportSha256, ...unsigned } = report;
  if (!SHA256_PATTERN.test(reportSha256) || sha256(unsigned) !== reportSha256) {
    throw new Error("Lookalike identity report SHA-256 mismatch");
  }
  if (report.completeForCandidateCreation || !report.manualReviewRequired) {
    throw new Error("Lookalike identity report violates the manual-review boundary");
  }
  if (
    report.counts.weeklyRecommendationEligibleCount !== 0
    || report.results.some(row => row.weeklyRecommendationEligible || row.durableActionCreated)
    || report.reviewInput.overrides.some(row => row.reviewState === "approved_for_qualification")
  ) {
    throw new Error("Lookalike identity report activates sales work prematurely");
  }
  if (Object.values(report.safety).some(value => value !== 0)) {
    throw new Error("Lookalike identity report violates the zero-side-effect boundary");
  }
}
