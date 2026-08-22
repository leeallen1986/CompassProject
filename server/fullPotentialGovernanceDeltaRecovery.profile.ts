import type { FullPotentialLookalikeGovernanceDelta } from "./fullPotentialLookalikeIdentityReconciliation";

export const GOVERNANCE_AUDIT_FILES = [
  "changed-accounts-before.csv",
  "changed-accounts-after.csv",
  "changed-aliases-before.csv",
  "changed-aliases-after.csv",
  "audit-manifest.json",
  "apply-summary.json",
  "after-state-summary.json",
  "before-state.json",
  "SHA256SUMS.txt",
] as const;

export type GovernanceAuditFile = typeof GOVERNANCE_AUDIT_FILES[number];

export interface GovernanceDeltaRecoveryProfile {
  version: 1;
  profileRef: string;
  deltaRef: string;
  governanceSourceSha: string;
  baseSnapshotRawSha256: string;
  approvedPackageSha256: string;
  beforeManifestSha256: string;
  afterManifestSha256: string;
  artifactSha256: Record<GovernanceAuditFile, string>;
  counts: {
    baseAccounts: number;
    baseAliases: number;
    accountBeforeRows: number;
    accountAfterRows: number;
    aliasBeforeRows: number;
    aliasAfterRows: number;
    accountCreated: number;
    accountReplaced: number;
    accountDeleted: 0;
    aliasAdded: number;
    aliasReplaced: 0;
    aliasDeleted: 0;
    auditScopeBeforeAccounts: number;
    auditScopeAfterAccounts: number;
  };
}

export const ISSUE145_RECOVERY_PROFILE: GovernanceDeltaRecoveryProfile = {
  version: 1,
  profileRef: "issue145-governance-delta-recovery-v1",
  deltaRef: "issue145-recovered-governance-delta-v1",
  governanceSourceSha: "9ecc06561ad6d081ee2f6f721d4c74b6b8d2b98a",
  baseSnapshotRawSha256: "34a3e1242542dcb9c9ced913638ea00b306a0f2534c85e8da2c31aa560c0dd24",
  approvedPackageSha256: "125e010edb5b5237731369e7caae270f927fbfd5f5f1819386347fef7597efb8",
  beforeManifestSha256: "29150bb32a5a06ebaae5db6c7f21d14334a00afdb94e93f696a6a7e613f893c2",
  afterManifestSha256: "d8e195adcd51e703ab8c15b2607a7b00ea707e52f13544fd4dc7d909b2e6a163",
  artifactSha256: {
    "changed-accounts-before.csv": "18516719612ee39e8a8f4d3cb8a6523db8bafff7d3ad4fcab0184968538e326c",
    "changed-accounts-after.csv": "8051a1154d1bd1f26cd92e4d093323f600d0158dd84b3db063ca59cd9182973e",
    "changed-aliases-before.csv": "3375655d7d26dab6384f58181e6c0af492377e021ff4127bbb30afb17563ea6f",
    "changed-aliases-after.csv": "e5e3d4d7dff2d6c3828e1cb40ec96234035041ed2d38d2efaa0c50e7950642f9",
    "audit-manifest.json": "48021f914ebb8335dbf974db9a6dd2e7b6fb549cd40272c1c2b15b46676321dd",
    "apply-summary.json": "35bec6fe6893a7b5edde382dea9e5f6c72e83e9df927d262524ae36aa8e568a3",
    "after-state-summary.json": "371bef30e432281512a2664914329a8b5886b2530b1ebbbf56ee404616811621",
    "before-state.json": "e6a0e85aea5a1bf0d5fde90dda713e4c23b2b6c6faa51833e655dc419327f7cf",
    "SHA256SUMS.txt": "8fadc942f699dcbd0fbc90720602c331ff910d0d416dbee700b65dcd5c02c2b2",
  },
  counts: {
    baseAccounts: 1_146,
    baseAliases: 157,
    accountBeforeRows: 1,
    accountAfterRows: 17,
    aliasBeforeRows: 0,
    aliasAfterRows: 3,
    accountCreated: 16,
    accountReplaced: 1,
    accountDeleted: 0,
    aliasAdded: 3,
    aliasReplaced: 0,
    aliasDeleted: 0,
    auditScopeBeforeAccounts: 14,
    auditScopeAfterAccounts: 24,
  },
};

export interface GovernanceDeltaRecoveryInput {
  sourceSha: string;
  retainedPostApplyEvidenceAt: string;
  baseSnapshotRaw: string | Buffer;
  artifacts: Record<GovernanceAuditFile, string | Buffer>;
  profile?: GovernanceDeltaRecoveryProfile;
}

export interface GovernanceDeltaRecoveryReport {
  version: 1;
  methodologyVersion: "fp-governance-delta-recovery-v1";
  sourceSha: string;
  profileRef: string;
  originalDeltaRecovered: false;
  recoveryBasis: "hash_locked_changed_row_audit";
  timestampEvidence: {
    retainedPostApplyEvidenceAt: string;
    exactTransactionTimeClaimed: false;
  };
  lineage: {
    governanceSourceSha: string;
    baseSnapshotRawSha256: string;
    baseSnapshotCanonicalSha256: string;
    approvedPackageSha256: string;
    beforeManifestSha256: string;
    afterManifestSha256: string;
    artifactSha256: Record<GovernanceAuditFile, string>;
  };
  counts: {
    baseAccounts: number;
    governedAccounts: number;
    baseAliases: number;
    governedAliases: number;
    accountCreated: number;
    accountReplaced: number;
    accountDeleted: 0;
    aliasAdded: number;
    aliasReplaced: 0;
    aliasDeleted: 0;
    orphanAliasTargets: 0;
    missingParentTargets: 0;
  };
  recoveredDelta: {
    deltaRef: string;
    sha256: string;
    accountRows: number;
    aliasRows: number;
  };
  issue143Validation: {
    governedSnapshotSha256: string;
    candidateCount: number;
    buyerCandidateCount: number;
    marketParticipantControlCount: number;
    weeklyRecommendationEligibleCount: 0;
    completeForCandidateCreation: false;
    manualReviewRequired: true;
    monetaryImpactAud: 0;
    durableActionsCreated: 0;
  };
  safety: {
    databaseConnections: 0;
    databaseReads: 0;
    databaseWrites: 0;
    accountMutations: 0;
    monetaryMutations: 0;
    crmC4cMutations: 0;
    contactMutations: 0;
    providerCalls: 0;
    pipelineInvocations: 0;
    durableActionsCreated: 0;
    deployments: 0;
  };
  reportSha256: string;
}

export interface GovernanceDeltaRecoveryResult {
  delta: FullPotentialLookalikeGovernanceDelta;
  report: GovernanceDeltaRecoveryReport;
}
