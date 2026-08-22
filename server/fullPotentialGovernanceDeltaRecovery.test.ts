import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalGovernanceJsonSha256,
  recoverGovernanceDelta,
  type GovernanceAuditFile,
  type GovernanceDeltaRecoveryInput,
  type GovernanceDeltaRecoveryProfile,
} from "./fullPotentialGovernanceDeltaRecovery";

const ACCOUNT_HEADER = "id,stableKey,canonicalName,displayName,parentAccountId,mergedIntoAccountId,rowClass,relationshipType,recordStatus,countsTowardPotential,country,routeToMarket,ownerName,channelOwner,fpStatus,priorityTier,platformPushDecision,c4cStatus,sourceWorkbookVersion,sourceSheet,sourceRowNumber,financialValuesState";
const ALIAS_HEADER = "accountId,aliasName,aliasType,source,confidenceLevel";

function sha(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function accountCsvRow(overrides: Record<string, string | number | boolean | null> = {}): string {
  const row = {
    id: 100,
    stableKey: "existing-hire|account|au|national|direct_ape",
    canonicalName: "Existing Hire Pty Ltd",
    displayName: "Existing Hire",
    parentAccountId: "",
    mergedIntoAccountId: "",
    rowClass: "account",
    relationshipType: "standalone",
    recordStatus: "active",
    countsTowardPotential: true,
    country: "AU",
    routeToMarket: "direct_ape",
    ownerName: "Private Owner",
    channelOwner: "Private Channel",
    fpStatus: "reviewed",
    priorityTier: "A",
    platformPushDecision: "hold",
    c4cStatus: "not_created",
    sourceWorkbookVersion: "private-v1",
    sourceSheet: "Rental",
    sourceRowNumber: 1,
    financialValuesState: "null",
    ...overrides,
  };
  const keys = ACCOUNT_HEADER.split(",");
  return keys.map(key => String(row[key as keyof typeof row] ?? "")).join(",");
}

function aliasCsvRow(accountId: number): string {
  return `${accountId},New Hire Trading,former_name,approved_governance,high`;
}

interface FixtureOptions {
  orphanAlias?: boolean;
  deleteExisting?: boolean;
  financialSideEffect?: boolean;
}

function fixture(options: FixtureOptions = {}): GovernanceDeltaRecoveryInput {
  const governanceSourceSha = "a".repeat(40);
  const approvedPackageSha256 = "b".repeat(64);
  const beforeManifestSha256 = "c".repeat(64);
  const afterManifestSha256 = "d".repeat(64);
  const base = {
    snapshotRef: "issue145-test-base-v1",
    capturedAt: "2026-08-21T00:00:00.000Z",
    accounts: [{
      id: 100,
      stableKey: "existing-hire|account|au|national|direct_ape",
      canonicalName: "Existing Hire Pty Ltd",
      displayName: "Existing Hire",
      parentGroup: null,
      rowClass: "account",
      relationshipType: "standalone",
      recordStatus: "active",
      countsTowardPotential: true,
      mergedIntoAccountId: null,
      country: "AU",
      routeToMarket: "direct_ape",
    }],
    aliases: [],
  };
  const baseSnapshotRaw = `${JSON.stringify(base, null, 2)}\n`;
  const beforeRows = [accountCsvRow()];
  const afterRows = options.deleteExisting
    ? [accountCsvRow({
      id: 200,
      stableKey: "new-hire|account|au|national|manual_review",
      canonicalName: "New Hire",
      displayName: "New Hire",
      parentAccountId: "",
      rowClass: "account",
      relationshipType: "standalone",
      recordStatus: "under_review",
      countsTowardPotential: false,
      routeToMarket: "manual_review",
    })]
    : [
      accountCsvRow({ displayName: "Existing Hire Updated" }),
      accountCsvRow({
        id: 200,
        stableKey: "new-hire|account|au|national|manual_review",
        canonicalName: "New Hire",
        displayName: "New Hire",
        parentAccountId: 100,
        rowClass: "account",
        relationshipType: "retained_child",
        recordStatus: "under_review",
        countsTowardPotential: false,
        routeToMarket: "manual_review",
      }),
    ];
  const aliasAccountId = options.orphanAlias ? 999 : 200;
  const artifacts = {
    "changed-accounts-before.csv": `${ACCOUNT_HEADER}\n${beforeRows.join("\n")}\n`,
    "changed-accounts-after.csv": `${ACCOUNT_HEADER}\n${afterRows.join("\n")}\n`,
    "changed-aliases-before.csv": `${ALIAS_HEADER}\n`,
    "changed-aliases-after.csv": `${ALIAS_HEADER}\n${aliasCsvRow(aliasAccountId)}\n`,
    "audit-manifest.json": `${JSON.stringify({
      sourceSha: governanceSourceSha,
      approvedPackageSha256,
      beforeManifestSha256,
      afterManifestSha256,
      changedAccountBeforeRows: 1,
      changedAccountAfterRows: afterRows.length,
      changedAliasBeforeRows: 0,
      changedAliasAfterRows: 1,
      financialValuesChanged: options.financialSideEffect ?? false,
      crmC4cMutations: 0,
      pipelineProviderActivity: 0,
    })}\n`,
    "apply-summary.json": `${JSON.stringify({
      sourceSha: governanceSourceSha,
      approvedPackageSha: approvedPackageSha256,
      financialValuesChanged: false,
      financialMutationFields: [],
      crmC4cMutations: 0,
      crmC4cMutationFields: [],
      pipelineProviderActivity: 0,
      actionsModelsEvidenceSignalsCreated: 0,
      runningCount: 0,
      createdIds: [200],
      aliasesCreated: 1,
    })}\n`,
    "after-state-summary.json": `${JSON.stringify({
      beforeManifestSha256,
      afterManifestSha256,
      afterAccountCount: 2,
      createdAccountCount: 1,
      aliasCount: 1,
      createdFinancialsNull: true,
      createdGovernanceValid: true,
      financeInvariantExisting: true,
      zeroSideEffects: true,
      sideEffects: {},
    })}\n`,
    "before-state.json": `${JSON.stringify({ accountIds: [100], accounts: [{}], aliases: [], capturedAt: "2026-08-22T00:00:00.000Z" })}\n`,
    "SHA256SUMS.txt": "",
  } satisfies Record<GovernanceAuditFile, string>;
  artifacts["SHA256SUMS.txt"] = [
    "changed-accounts-before.csv",
    "changed-accounts-after.csv",
    "changed-aliases-before.csv",
    "changed-aliases-after.csv",
    "audit-manifest.json",
  ].map(name => `${sha(artifacts[name as GovernanceAuditFile])}  ${name}`).join("\n") + "\n";

  const profile: GovernanceDeltaRecoveryProfile = {
    version: 1,
    profileRef: "issue145-test-profile-v1",
    deltaRef: "issue145-test-recovered-delta-v1",
    governanceSourceSha,
    baseSnapshotRawSha256: sha(baseSnapshotRaw),
    approvedPackageSha256,
    beforeManifestSha256,
    afterManifestSha256,
    artifactSha256: Object.fromEntries(
      Object.entries(artifacts).map(([name, content]) => [name, sha(content)]),
    ) as Record<GovernanceAuditFile, string>,
    counts: {
      baseAccounts: 1,
      baseAliases: 0,
      accountBeforeRows: 1,
      accountAfterRows: afterRows.length,
      aliasBeforeRows: 0,
      aliasAfterRows: 1,
      accountCreated: 1,
      accountReplaced: options.deleteExisting ? 0 : 1,
      accountDeleted: 0,
      aliasAdded: 1,
      aliasReplaced: 0,
      aliasDeleted: 0,
      auditScopeBeforeAccounts: 1,
      auditScopeAfterAccounts: 2,
    },
  };
  return {
    sourceSha: "f".repeat(40),
    retainedPostApplyEvidenceAt: "2026-08-22T00:51:36.712Z",
    baseSnapshotRaw,
    artifacts,
    profile,
  };
}

describe("Issue #145 Full Potential governance-delta recovery", () => {
  it("recovers a bounded deterministic delta and normalises numeric alias targets", () => {
    const first = recoverGovernanceDelta(fixture());
    const second = recoverGovernanceDelta(fixture());
    expect(first).toEqual(second);
    expect(first.delta).toMatchObject({
      version: 1,
      baseSnapshotSha256: canonicalGovernanceJsonSha256(JSON.parse(fixture().baseSnapshotRaw as string)),
      accounts: [{ id: 100 }, { id: 200, parentGroup: "Existing Hire Pty Ltd" }],
      aliases: [{ accountId: 200, aliasName: "New Hire Trading" }],
    });
    expect(first.report).toMatchObject({
      originalDeltaRecovered: false,
      counts: {
        accountCreated: 1,
        accountReplaced: 1,
        accountDeleted: 0,
        aliasAdded: 1,
        aliasDeleted: 0,
        orphanAliasTargets: 0,
      },
      issue143Validation: {
        weeklyRecommendationEligibleCount: 0,
        completeForCandidateCreation: false,
        monetaryImpactAud: 0,
        durableActionsCreated: 0,
      },
    });
  });

  it("keeps raw-file and canonical-object snapshot hashes distinct and strips audit-only fields", () => {
    const input = fixture();
    const result = recoverGovernanceDelta(input);
    expect(result.report.lineage.baseSnapshotRawSha256).not.toBe(result.report.lineage.baseSnapshotCanonicalSha256);
    const serialized = JSON.stringify(result.delta);
    expect(serialized).not.toMatch(/ownerName|channelOwner|priorityTier|platformPushDecision|c4cStatus|financialValuesState|sourceWorkbook/);
  });

  it("fails closed for an orphan alias after numeric normalisation", () => {
    expect(() => recoverGovernanceDelta(fixture({ orphanAlias: true }))).toThrow("ORPHAN_ALIAS_TARGETS:1");
  });

  it("fails closed for an unsupported account deletion", () => {
    expect(() => recoverGovernanceDelta(fixture({ deleteExisting: true }))).toThrow("ACCOUNT_DELETED_COUNT_MISMATCH");
  });

  it("fails closed when retained audit evidence reports a financial side effect", () => {
    expect(() => recoverGovernanceDelta(fixture({ financialSideEffect: true }))).toThrow("AUDIT_FINANCIAL_CHANGE_NOT_ZERO");
  });

  it("fails before parsing when a hash-locked artifact changes", () => {
    const input = fixture();
    input.artifacts["changed-aliases-after.csv"] += "tamper";
    expect(() => recoverGovernanceDelta(input)).toThrow("RECOVERY_changed-aliases-after.csv_HASH_MISMATCH");
  });
});
