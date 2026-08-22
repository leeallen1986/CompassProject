import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ISSUE145_GOVERNANCE_DELTA_RECOVERY_PROFILE,
  canonicalFullPotentialJsonSha256,
  recoverFullPotentialGovernanceDelta,
  verifyFullPotentialGovernanceDeltaRecoveryReport,
  type FullPotentialGovernanceAuditFilename,
  type FullPotentialGovernanceDeltaRecoveryProfile,
} from "./fullPotentialGovernanceDeltaRecovery";

const ACCOUNT_HEADER = [
  "id",
  "stableKey",
  "canonicalName",
  "displayName",
  "parentAccountId",
  "mergedIntoAccountId",
  "rowClass",
  "relationshipType",
  "recordStatus",
  "countsTowardPotential",
  "country",
  "routeToMarket",
  "ownerName",
  "channelOwner",
  "fpStatus",
  "priorityTier",
  "platformPushDecision",
  "c4cStatus",
  "sourceWorkbookVersion",
  "sourceSheet",
  "sourceRowNumber",
  "financialValuesState",
];
const ALIAS_HEADER = ["accountId", "aliasName", "aliasType", "source", "confidenceLevel"];

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(header: string[], rows: unknown[][]): string {
  return `${[header, ...rows].map(row => row.map(csvCell).join(",")).join("\n")}\n`;
}

interface FixtureOptions {
  orphanAlias?: boolean;
  stableKeyCollision?: boolean;
  financialMutation?: boolean;
  accountDeletion?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const governanceSourceSha = "a".repeat(40);
  const approvedPackageSha256 = "b".repeat(64);
  const beforeManifestSha256 = "c".repeat(64);
  const afterManifestSha256 = "d".repeat(64);
  const baseSnapshot = {
    snapshotRef: "issue145-test-base-v1",
    capturedAt: "2026-08-21T00:00:00.000Z",
    accounts: [
      {
        id: 1,
        stableKey: "old-hire|account|au|wa|direct_ape",
        canonicalName: "Old Hire",
        displayName: "Old Hire",
        parentGroup: null,
        rowClass: "account" as const,
        relationshipType: "standalone",
        recordStatus: "active" as const,
        countsTowardPotential: true,
        mergedIntoAccountId: null,
        country: "AU",
        routeToMarket: "direct_ape",
      },
      {
        id: 2,
        stableKey: "parent-hire|account|au|national|direct_ape",
        canonicalName: "Parent Hire",
        displayName: "Parent Hire",
        parentGroup: null,
        rowClass: "account" as const,
        relationshipType: "standalone",
        recordStatus: "active" as const,
        countsTowardPotential: true,
        mergedIntoAccountId: null,
        country: "AU",
        routeToMarket: "direct_ape",
      },
    ],
    aliases: [],
  };
  const baseSnapshotRaw = `${JSON.stringify(baseSnapshot, null, 2)}\n`;

  const beforeRows = [[
    1,
    "old-hire|account|au|wa|direct_ape",
    "Old Hire",
    "Old Hire",
    "",
    "",
    "account",
    "standalone",
    "active",
    true,
    "AU",
    "direct_ape",
    "Private Owner",
    "",
    "reviewed",
    "A",
    "retain",
    "not_linked",
    "private-workbook",
    "Rental",
    1,
    "unchanged",
  ]];
  if (options.accountDeletion) {
    beforeRows.push([
      4,
      "deleted-hire|account|au|wa|direct_ape",
      "Deleted Hire",
      "Deleted Hire",
      "",
      "",
      "account",
      "standalone",
      "active",
      true,
      "AU",
      "direct_ape",
      "Private Owner",
      "",
      "reviewed",
      "A",
      "retain",
      "not_linked",
      "private-workbook",
      "Rental",
      2,
      "unchanged",
    ]);
  }
  const afterRows = [[
    1,
    "old-hire|account|au|wa|direct_ape",
    "Old Hire, Updated",
    "Old Hire Updated",
    "",
    "",
    "account",
    "standalone",
    "active",
    true,
    "AU",
    "direct_ape",
    "Private Owner",
    "",
    "reviewed",
    "A",
    "retain",
    "not_linked",
    "private-workbook",
    "Rental",
    1,
    "unchanged",
  ], [
    3,
    options.stableKeyCollision
      ? "parent-hire|account|au|national|direct_ape"
      : "child-hire|site_context|au|national|manual_review",
    "Child Hire",
    "Child Hire",
    2,
    "",
    "site_context",
    "strategic_context",
    "under_review",
    false,
    "AU",
    "manual_review",
    "Private Owner",
    "Private Channel",
    "under_review",
    "C",
    "defer",
    "not_linked",
    "private-workbook",
    "Rental",
    2,
    "null",
  ]];
  const aliasRows = [[
    options.orphanAlias ? "999" : "3",
    "Child Trading",
    "trading_name",
    "approved_governance",
    "high",
  ]];

  const artifacts = {
    "changed-accounts-before.csv": csv(ACCOUNT_HEADER, beforeRows),
    "changed-accounts-after.csv": csv(ACCOUNT_HEADER, afterRows),
    "changed-aliases-before.csv": csv(ALIAS_HEADER, []),
    "changed-aliases-after.csv": csv(ALIAS_HEADER, aliasRows),
    "audit-manifest.json": `${JSON.stringify({
      sourceSha: governanceSourceSha,
      approvedPackageSha256,
      beforeManifestSha256,
      afterManifestSha256,
      changedAccountAfterRows: afterRows.length,
      changedAccountBeforeRows: beforeRows.length,
      changedAliasAfterRows: aliasRows.length,
      changedAliasBeforeRows: 0,
      crmC4cMutations: 0,
      financialValuesChanged: options.financialMutation ?? false,
      pipelineProviderActivity: 0,
    })}\n`,
    "apply-summary.json": `${JSON.stringify({
      sourceSha: governanceSourceSha,
      approvedPackageSha: approvedPackageSha256,
      createdIds: [3],
      aliasesCreated: [{ accountId: 3 }],
      crmC4cMutations: 0,
      crmC4cMutationFields: [],
      financialValuesChanged: false,
      financialMutationFields: [],
      pipelineProviderActivity: 0,
      actionsModelsEvidenceSignalsCreated: { actions: 0, models: 0, evidence: 0, signals: 0 },
      runningCount: 0,
    })}\n`,
    "after-state-summary.json": `${JSON.stringify({
      beforeManifestSha256,
      afterManifestSha256,
      afterAccountCount: 3,
      createdAccountCount: 1,
      aliasCount: 1,
      createdFinancialsNull: true,
      createdGovernanceValid: true,
      financeInvariantExisting: true,
      sideEffects: { actions: 0, signals: 0, models: 0, evidence: 0 },
      zeroSideEffects: true,
    })}\n`,
    "before-state.json": `${JSON.stringify({
      accountIds: [1, 2],
      accounts: [{ id: 1 }, { id: 2 }],
      aliases: [],
      capturedAt: "2026-08-21T00:00:00.000Z",
    })}\n`,
    "SHA256SUMS.txt": "",
  } satisfies Record<FullPotentialGovernanceAuditFilename, string>;
  const checksumNames: FullPotentialGovernanceAuditFilename[] = [
    "changed-accounts-before.csv",
    "changed-accounts-after.csv",
    "changed-aliases-before.csv",
    "changed-aliases-after.csv",
    "audit-manifest.json",
  ];
  artifacts["SHA256SUMS.txt"] = `${checksumNames
    .map(filename => `${sha256(artifacts[filename])}  ${filename}`)
    .join("\n")}\n`;
  const artifactSha256 = Object.fromEntries(
    Object.entries(artifacts).map(([filename, value]) => [filename, sha256(value)]),
  ) as Record<FullPotentialGovernanceAuditFilename, string>;
  const profile: FullPotentialGovernanceDeltaRecoveryProfile = {
    version: 1,
    profileRef: "issue145-test-profile-v1",
    deltaRef: "issue145-test-recovered-delta-v1",
    governanceSourceSha,
    baseSnapshotRawSha256: sha256(baseSnapshotRaw),
    approvedPackageSha256,
    changedRowsBeforeManifestSha256: beforeManifestSha256,
    changedRowsAfterManifestSha256: afterManifestSha256,
    artifactSha256,
    expectedCounts: {
      baseAccounts: 2,
      baseAliases: 0,
      changedAccountsBefore: beforeRows.length,
      changedAccountsAfter: afterRows.length,
      changedAliasesBefore: 0,
      changedAliasesAfter: 1,
      accountCreated: 1,
      accountReplaced: 1,
      accountDeleted: 0,
      aliasAdded: 1,
      aliasReplaced: 0,
      aliasDeleted: 0,
      auditScopeBeforeAccounts: 2,
      auditScopeAfterAccounts: 3,
    },
  };
  return {
    sourceSha: "e".repeat(40),
    retainedPostApplyEvidenceAt: "2026-08-22T00:51:36.712Z",
    baseSnapshotRaw,
    artifacts,
    profile,
  };
}

describe("Issue #145 Full Potential governance delta recovery", () => {
  it("locks the recovered private package profile to the reviewed hashes and counts", () => {
    expect(ISSUE145_GOVERNANCE_DELTA_RECOVERY_PROFILE).toMatchObject({
      governanceSourceSha: "9ecc06561ad6d081ee2f6f721d4c74b6b8d2b98a",
      baseSnapshotRawSha256: "34a3e1242542dcb9c9ced913638ea00b306a0f2534c85e8da2c31aa560c0dd24",
      approvedPackageSha256: "125e010edb5b5237731369e7caae270f927fbfd5f5f1819386347fef7597efb8",
      changedRowsAfterManifestSha256: "d8e195adcd51e703ab8c15b2607a7b00ea707e52f13544fd4dc7d909b2e6a163",
      expectedCounts: {
        baseAccounts: 1_146,
        baseAliases: 157,
        accountCreated: 16,
        accountReplaced: 1,
        accountDeleted: 0,
        aliasAdded: 3,
        aliasReplaced: 0,
        aliasDeleted: 0,
      },
    });
  });

  it("recovers deterministic bounded rows and normalises numeric alias targets", () => {
    const input = fixture();
    const first = recoverFullPotentialGovernanceDelta(input);
    const second = recoverFullPotentialGovernanceDelta(input);

    expect(first).toEqual(second);
    expect(first.delta.accounts).toHaveLength(2);
    expect(first.delta.aliases).toEqual([{
      accountId: 3,
      aliasName: "Child Trading",
      aliasType: "trading_name",
      confidenceLevel: "high",
    }]);
    expect(first.delta.accounts.find(row => row.id === 3)?.parentGroup).toBe("Parent Hire");
    expect(first.report).toMatchObject({
      originalDeltaRecovered: false,
      counts: {
        accountCreatedCount: 1,
        accountReplacedCount: 1,
        accountDeletedCount: 0,
        aliasAddedCount: 1,
        aliasDeletedCount: 0,
        orphanAliasTargetCount: 0,
        missingParentTargetCount: 0,
      },
      issue143Validation: {
        weeklyRecommendationEligibleCount: 0,
        completeForCandidateCreation: false,
        durableActionsCreated: 0,
        monetaryImpactAud: 0,
      },
    });
    expect(() => verifyFullPotentialGovernanceDeltaRecoveryReport(first.report)).not.toThrow();
  });

  it("distinguishes the raw snapshot file hash from the canonical parsed-object hash", () => {
    const input = fixture();
    const result = recoverFullPotentialGovernanceDelta(input);
    expect(result.report.lineage.baseSnapshotRawSha256).toBe(sha256(input.baseSnapshotRaw));
    expect(result.report.lineage.baseSnapshotCanonicalSha256).toBe(
      canonicalFullPotentialJsonSha256(JSON.parse(input.baseSnapshotRaw)),
    );
    expect(result.report.lineage.baseSnapshotCanonicalSha256)
      .not.toBe(result.report.lineage.baseSnapshotRawSha256);
    expect(result.delta.baseSnapshotSha256)
      .toBe(result.report.lineage.baseSnapshotCanonicalSha256);
  });

  it("strips every audit-only owner, CRM, workbook and financial field", () => {
    const result = recoverFullPotentialGovernanceDelta(fixture());
    const serialized = JSON.stringify(result.delta);
    expect(serialized).not.toMatch(
      /ownerName|channelOwner|fpStatus|priorityTier|platformPushDecision|c4cStatus|sourceWorkbookVersion|sourceSheet|sourceRowNumber|financialValuesState/,
    );
  });

  it("fails closed for an orphan alias target after numeric normalisation", () => {
    expect(() => recoverFullPotentialGovernanceDelta(fixture({ orphanAlias: true })))
      .toThrow("GOVERNANCE_DELTA_RECOVERY_ORPHAN_ALIAS_TARGETS:1");
  });

  it("fails closed when the audit implies an unsupported account deletion", () => {
    expect(() => recoverFullPotentialGovernanceDelta(fixture({ accountDeletion: true })))
      .toThrow("GOVERNANCE_DELTA_RECOVERY_ACCOUNT_DELETED_COUNT_MISMATCH");
  });

  it("fails closed for a governed stable-key collision", () => {
    expect(() => recoverFullPotentialGovernanceDelta(fixture({ stableKeyCollision: true })))
      .toThrow("GOVERNANCE_DELTA_RECOVERY_GOVERNED_STABLE_KEY_COLLISION");
  });

  it("fails closed when the locked audit reports a financial mutation", () => {
    expect(() => recoverFullPotentialGovernanceDelta(fixture({ financialMutation: true })))
      .toThrow("GOVERNANCE_DELTA_RECOVERY_AUDIT_FINANCIAL_CHANGE_NOT_ZERO");
  });

  it("detects report tampering", () => {
    const result = recoverFullPotentialGovernanceDelta(fixture());
    const tampered = {
      ...result.report,
      counts: { ...result.report.counts, accountCreatedCount: 99 },
    };
    expect(() => verifyFullPotentialGovernanceDeltaRecoveryReport(tampered))
      .toThrow("GOVERNANCE_DELTA_RECOVERY_REPORT_SHA256_MISMATCH");
  });
});
