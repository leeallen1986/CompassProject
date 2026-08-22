import type {
  FullPotentialReconciliationAccount,
  FullPotentialReconciliationAlias,
} from "../shared/fullPotentialAccountReconciliation";
import {
  buildFullPotentialLookalikeIdentityReport,
  verifyFullPotentialLookalikeIdentityReport,
  type FullPotentialLookalikeGovernanceDelta,
} from "./fullPotentialLookalikeIdentityReconciliation";
import { FP_LOOKALIKE_PUBLIC_CANDIDATES_V1 } from "./fullPotentialLookalikePublicPack";
import {
  canonicalGovernanceJsonSha256,
  normalizeGovernanceIdentity,
  verifyRecoveryEvidence,
} from "./fullPotentialGovernanceDeltaRecovery.private";
import {
  ISSUE145_RECOVERY_PROFILE,
  type GovernanceDeltaRecoveryInput,
  type GovernanceDeltaRecoveryReport,
  type GovernanceDeltaRecoveryResult,
} from "./fullPotentialGovernanceDeltaRecovery.profile";

export {
  GOVERNANCE_AUDIT_FILES,
  ISSUE145_RECOVERY_PROFILE,
  type GovernanceAuditFile,
  type GovernanceDeltaRecoveryInput,
  type GovernanceDeltaRecoveryProfile,
  type GovernanceDeltaRecoveryReport,
  type GovernanceDeltaRecoveryResult,
} from "./fullPotentialGovernanceDeltaRecovery.profile";
export { canonicalGovernanceJsonSha256 } from "./fullPotentialGovernanceDeltaRecovery.private";

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;

function unique<T>(rows: T[], key: (row: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const current = key(row);
    if (seen.has(current)) throw new Error(`${label}_DUPLICATE`);
    seen.add(current);
  }
}
function count(actual: number, expected: number, label: string): void {
  if (actual !== expected) throw new Error(`${label}_COUNT_MISMATCH`);
}

export function recoverGovernanceDelta(input: GovernanceDeltaRecoveryInput): GovernanceDeltaRecoveryResult {
  const profile = input.profile ?? ISSUE145_RECOVERY_PROFILE;
  if (!SHA40.test(input.sourceSha)) throw new Error("RECOVERY_SOURCE_SHA_INVALID");
  if (Number.isNaN(Date.parse(input.retainedPostApplyEvidenceAt))) throw new Error("RECOVERY_EVIDENCE_TIMESTAMP_INVALID");
  const retainedPostApplyEvidenceAt = new Date(input.retainedPostApplyEvidenceAt).toISOString();
  const evidence = verifyRecoveryEvidence(profile, input.baseSnapshotRaw, input.artifacts);
  const { base, accountsBefore, accountsAfter, aliasesBefore, aliasesAfter } = evidence;

  unique(accountsBefore, row => String(row.id), "ACCOUNT_BEFORE_ID");
  unique(accountsAfter, row => String(row.id), "ACCOUNT_AFTER_ID");
  unique(accountsAfter, row => row.stableKey, "ACCOUNT_AFTER_STABLE_KEY");
  unique(aliasesBefore, row => `${row.accountId}:${normalizeGovernanceIdentity(row.aliasName)}`, "ALIAS_BEFORE");
  unique(aliasesAfter, row => `${row.accountId}:${normalizeGovernanceIdentity(row.aliasName)}`, "ALIAS_AFTER");

  const accountBeforeIds = new Set(accountsBefore.map(row => row.id));
  const accountAfterIds = new Set(accountsAfter.map(row => row.id));
  const accountCreated = accountsAfter.filter(row => !accountBeforeIds.has(row.id)).length;
  const accountReplaced = accountsAfter.filter(row => accountBeforeIds.has(row.id)).length;
  const accountDeleted = accountsBefore.filter(row => !accountAfterIds.has(row.id)).length;
  count(accountCreated, profile.counts.accountCreated, "ACCOUNT_CREATED");
  count(accountReplaced, profile.counts.accountReplaced, "ACCOUNT_REPLACED");
  count(accountDeleted, profile.counts.accountDeleted, "ACCOUNT_DELETED");

  const aliasKey = (row: { accountId: number; aliasName: string }) =>
    `${row.accountId}:${normalizeGovernanceIdentity(row.aliasName)}`;
  const aliasBeforeKeys = new Set(aliasesBefore.map(aliasKey));
  const aliasAfterKeys = new Set(aliasesAfter.map(aliasKey));
  const aliasAdded = aliasesAfter.filter(row => !aliasBeforeKeys.has(aliasKey(row))).length;
  const aliasReplaced = aliasesAfter.filter(row => aliasBeforeKeys.has(aliasKey(row))).length;
  const aliasDeleted = aliasesBefore.filter(row => !aliasAfterKeys.has(aliasKey(row))).length;
  count(aliasAdded, profile.counts.aliasAdded, "ALIAS_ADDED");
  count(aliasReplaced, profile.counts.aliasReplaced, "ALIAS_REPLACED");
  count(aliasDeleted, profile.counts.aliasDeleted, "ALIAS_DELETED");

  const baseById = new Map<number, FullPotentialReconciliationAccount>();
  for (const account of base.accounts) {
    if (!Number.isSafeInteger(account.id) || account.id <= 0 || baseById.has(account.id)) throw new Error("BASE_ACCOUNT_ID_INVALID");
    baseById.set(account.id, account);
  }
  const governedNameById = new Map(base.accounts.map(account => [account.id, account.canonicalName]));
  for (const row of accountsAfter) governedNameById.set(row.id, row.canonicalName);

  let missingParentTargets = 0;
  const deltaAccounts: FullPotentialReconciliationAccount[] = accountsAfter.map(row => {
    let parentGroup: string | null = null;
    if (row.parentAccountId !== null) {
      if (row.parentAccountId === row.id) throw new Error("ACCOUNT_PARENT_SELF_REFERENCE");
      parentGroup = governedNameById.get(row.parentAccountId) ?? null;
      if (parentGroup === null) missingParentTargets += 1;
    }
    return {
      id: row.id,
      stableKey: row.stableKey,
      canonicalName: row.canonicalName,
      displayName: row.displayName,
      parentGroup,
      rowClass: row.rowClass,
      relationshipType: row.relationshipType,
      recordStatus: row.recordStatus,
      countsTowardPotential: row.countsTowardPotential,
      mergedIntoAccountId: row.mergedIntoAccountId,
      country: row.country,
      routeToMarket: row.routeToMarket,
    };
  }).sort((left, right) => left.id - right.id);
  if (missingParentTargets !== 0) throw new Error(`MISSING_PARENT_TARGETS:${missingParentTargets}`);

  const governedById = new Map(baseById);
  for (const account of deltaAccounts) governedById.set(account.id, account);
  const stableKeys = new Map<string, number>();
  for (const account of governedById.values()) {
    const existing = stableKeys.get(account.stableKey);
    if (existing !== undefined && existing !== account.id) throw new Error("GOVERNED_STABLE_KEY_COLLISION");
    stableKeys.set(account.stableKey, account.id);
    if (account.mergedIntoAccountId != null && !governedById.has(account.mergedIntoAccountId)) {
      throw new Error("MERGED_TARGET_MISSING");
    }
  }

  let orphanAliasTargets = 0;
  const deltaAliases: FullPotentialReconciliationAlias[] = aliasesAfter.map(row => {
    if (!governedById.has(row.accountId)) orphanAliasTargets += 1;
    return {
      accountId: row.accountId,
      aliasName: row.aliasName,
      aliasType: row.aliasType,
      confidenceLevel: row.confidenceLevel,
    };
  }).sort((left, right) => left.accountId - right.accountId || left.aliasName.localeCompare(right.aliasName));
  if (orphanAliasTargets !== 0) throw new Error(`ORPHAN_ALIAS_TARGETS:${orphanAliasTargets}`);

  const delta: FullPotentialLookalikeGovernanceDelta = {
    version: 1,
    deltaRef: profile.deltaRef,
    appliedAt: retainedPostApplyEvidenceAt,
    baseSnapshotSha256: evidence.baseSnapshotCanonicalSha256,
    accounts: deltaAccounts,
    aliases: deltaAliases,
  };
  const deltaSha256 = canonicalGovernanceJsonSha256(delta);
  const issue143 = buildFullPotentialLookalikeIdentityReport({
    sourceSha: input.sourceSha,
    candidates: FP_LOOKALIKE_PUBLIC_CANDIDATES_V1,
    baseSnapshot: base,
    governanceDelta: delta,
  });
  verifyFullPotentialLookalikeIdentityReport(issue143);
  if (issue143.governedSnapshot.createdAccountCount !== accountCreated
      || issue143.governedSnapshot.replacedAccountCount !== accountReplaced
      || issue143.governedSnapshot.addedAliasCount !== aliasAdded) {
    throw new Error("ISSUE143_MATERIALISATION_COUNT_MISMATCH");
  }
  if (issue143.counts.weeklyRecommendationEligibleCount !== 0
      || issue143.completeForCandidateCreation !== false
      || issue143.manualReviewRequired !== true
      || issue143.safety.fullPotentialMonetaryMutations !== 0
      || issue143.safety.durableActionsCreated !== 0) {
    throw new Error("ISSUE143_SAFETY_MISMATCH");
  }

  const unsigned = {
    version: 1 as const,
    methodologyVersion: "fp-governance-delta-recovery-v1" as const,
    sourceSha: input.sourceSha,
    profileRef: profile.profileRef,
    originalDeltaRecovered: false as const,
    recoveryBasis: "hash_locked_changed_row_audit" as const,
    timestampEvidence: {
      retainedPostApplyEvidenceAt,
      exactTransactionTimeClaimed: false as const,
    },
    lineage: {
      governanceSourceSha: profile.governanceSourceSha,
      baseSnapshotRawSha256: evidence.baseSnapshotRawSha256,
      baseSnapshotCanonicalSha256: evidence.baseSnapshotCanonicalSha256,
      approvedPackageSha256: profile.approvedPackageSha256,
      beforeManifestSha256: profile.beforeManifestSha256,
      afterManifestSha256: profile.afterManifestSha256,
      artifactSha256: evidence.artifactSha256,
    },
    counts: {
      baseAccounts: base.accounts.length,
      governedAccounts: issue143.governedSnapshot.afterAccountCount,
      baseAliases: base.aliases.length,
      governedAliases: issue143.governedSnapshot.afterAliasCount,
      accountCreated,
      accountReplaced,
      accountDeleted: 0 as const,
      aliasAdded,
      aliasReplaced: 0 as const,
      aliasDeleted: 0 as const,
      orphanAliasTargets: 0 as const,
      missingParentTargets: 0 as const,
    },
    recoveredDelta: {
      deltaRef: delta.deltaRef,
      sha256: deltaSha256,
      accountRows: delta.accounts.length,
      aliasRows: delta.aliases.length,
    },
    issue143Validation: {
      governedSnapshotSha256: issue143.governedSnapshot.governedSnapshotSha256,
      candidateCount: issue143.counts.candidateCount,
      buyerCandidateCount: issue143.counts.buyerCandidateCount,
      marketParticipantControlCount: issue143.counts.marketParticipantControlCount,
      weeklyRecommendationEligibleCount: 0 as const,
      completeForCandidateCreation: false as const,
      manualReviewRequired: true as const,
      monetaryImpactAud: 0 as const,
      durableActionsCreated: 0 as const,
    },
    safety: {
      databaseConnections: 0 as const,
      databaseReads: 0 as const,
      databaseWrites: 0 as const,
      accountMutations: 0 as const,
      monetaryMutations: 0 as const,
      crmC4cMutations: 0 as const,
      contactMutations: 0 as const,
      providerCalls: 0 as const,
      pipelineInvocations: 0 as const,
      durableActionsCreated: 0 as const,
      deployments: 0 as const,
    },
  };
  const report: GovernanceDeltaRecoveryReport = {
    ...unsigned,
    reportSha256: canonicalGovernanceJsonSha256(unsigned),
  };
  verifyGovernanceDeltaRecoveryReport(report);
  return { delta, report };
}

export function verifyGovernanceDeltaRecoveryReport(report: GovernanceDeltaRecoveryReport): void {
  const { reportSha256, ...unsigned } = report;
  if (!SHA64.test(reportSha256) || canonicalGovernanceJsonSha256(unsigned) !== reportSha256) {
    throw new Error("RECOVERY_REPORT_HASH_MISMATCH");
  }
  if (report.originalDeltaRecovered !== false
      || report.timestampEvidence.exactTransactionTimeClaimed !== false) {
    throw new Error("RECOVERY_PROVENANCE_CLAIM_INVALID");
  }
  if (report.counts.accountDeleted !== 0
      || report.counts.aliasDeleted !== 0
      || report.counts.orphanAliasTargets !== 0
      || report.counts.missingParentTargets !== 0) {
    throw new Error("RECOVERY_FAIL_CLOSED_COUNT_INVALID");
  }
  if (report.issue143Validation.weeklyRecommendationEligibleCount !== 0
      || report.issue143Validation.completeForCandidateCreation !== false
      || report.issue143Validation.monetaryImpactAud !== 0
      || report.issue143Validation.durableActionsCreated !== 0) {
    throw new Error("RECOVERY_SALES_ACTIVATION_BOUNDARY_INVALID");
  }
  if (Object.values(report.safety).some(value => value !== 0)) {
    throw new Error("RECOVERY_SAFETY_BOUNDARY_INVALID");
  }
}
