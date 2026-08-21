import { createHash } from "node:crypto";
import {
  calculateFullPotentialPublicScenario,
  type FullPotentialPublicEvidenceRecord,
} from "../shared/fullPotentialPublicEvidence";
import {
  materializeFullPotentialDraftPack,
  type FullPotentialPublicObservationRecord,
  type FullPotentialRestrictedScenarioRecord,
} from "../shared/fullPotentialPublicDraftPack";
import { toFullPotentialPrivatePlanningAssumptions } from "../shared/fullPotentialPrivatePlanning";
import type { RouteToMarket } from "./fullPotentialCommercialModel.shared";

export interface FullPotentialImportAccountTarget {
  buyerAccountKey: string;
  accountId: number;
  stableKey: string;
  routeToMarket: RouteToMarket;
  countsTowardPotential: boolean;
  recordStatus: "active" | "under_review" | "merged" | "parked" | "excluded";
  rowClass: "account" | "site_context" | "channel_managed" | "competitor_watch" | "cluster_signal";
}

export interface FullPotentialDraftImportManifestInput {
  publicObservations: FullPotentialPublicObservationRecord[];
  restrictedPlanning: FullPotentialRestrictedScenarioRecord[];
  accountTargets: FullPotentialImportAccountTarget[];
  generatedAt: string;
  generatedByRef: string;
  sourcePackRef: string;
}

export interface FullPotentialDraftEvidenceProposal {
  proposalKey: string;
  recordKey: string;
  accountId: number;
  buyerAccountKey: string;
  commercialPoolKey: string;
  productFamily: FullPotentialPublicEvidenceRecord["productFamily"];
  evidenceType: "public_source" | "financial_assumption";
  title: string;
  summary: string;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceReference: string | null;
  observedAt: string | null;
  confidenceLevel: "high" | "medium" | "low";
  status: "draft";
}

export interface FullPotentialDraftModelProposal {
  proposalKey: string;
  accountId: number;
  buyerAccountKey: string;
  status: "draft";
  methodologyVersion: "fp-public-v1";
  assumptionsSummary: string;
}

export interface FullPotentialDraftLineProposal {
  proposalKey: string;
  recordKey: string;
  commercialPoolKey: string;
  accountId: number;
  buyerAccountKey: string;
  productFamily: FullPotentialPublicEvidenceRecord["productFamily"];
  productCell: string;
  valueClass: FullPotentialPublicEvidenceRecord["valueClass"];
  application: string;
  routeToMarket: RouteToMarket;
  estimatedTotalFleetUnits: number | null;
  annualReplacementUnits: number | null;
  averageSellingPriceAud: number;
  addressableSharePct: number;
  baseThreeYearUnits: number;
  basePotentialAud: number;
  confidenceLevel: "high" | "medium" | "low";
  assumptions: Record<string, unknown>;
  status: "draft";
}

export interface FullPotentialDraftImportManifest {
  version: 2;
  safetyMode: "draft_only_no_writes";
  generatedAt: string;
  generatedByRef: string;
  sourcePackRef: string;
  methodologyVersion: "fp-public-v1";
  publicObservationCount: number;
  restrictedPlanningCount: number;
  /** All source records that carry monetary scenarios, including unobserved allowances. */
  buyerCountingCount: number;
  /** Buyer-counting records eligible to become draft account model lines. */
  importEligibleBuyerCountingCount: number;
  distinctBuyerAccountCount: number;
  commercialPoolCount: number;
  managementOnlyRecordCount: number;
  /** Monetary allowances retained in management output but blocked from account import. */
  managementOnlyMonetaryRecordCount: number;
  evidenceProposals: FullPotentialDraftEvidenceProposal[];
  modelProposals: FullPotentialDraftModelProposal[];
  lineProposals: FullPotentialDraftLineProposal[];
  managementOnlyRecordKeys: string[];
  accountTargetSnapshot: Array<{
    buyerAccountKey: string;
    accountId: number;
    stableKey: string;
    routeToMarket: RouteToMarket;
  }>;
  invariants: {
    allStatusesDraft: true;
    oneModelPerAccount: true;
    multipleDistinctPoolsPerBuyerAllowed: true;
    unobservedAllowanceImportProposals: 0;
    approvalsProposed: 0;
    accountMutationsProposed: 0;
    crmWritesProposed: 0;
    pipelineInvocationsProposed: 0;
    providerCallsProposed: 0;
  };
  manifestSha256: string;
}

const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function confidence(grade: "A" | "B" | "C"): "high" | "medium" | "low" {
  if (grade === "A") return "high";
  if (grade === "B") return "medium";
  return "low";
}

function assertOpaque(value: string, field: string): void {
  if (!OPAQUE_REFERENCE_PATTERN.test(value)) {
    throw new Error(`${field} must be an opaque non-sensitive reference`);
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Full Potential import manifest contains duplicate ${label}`);
  }
}

function accountTargetMap(
  targets: FullPotentialImportAccountTarget[],
): Map<string, FullPotentialImportAccountTarget> {
  const result = new Map<string, FullPotentialImportAccountTarget>();
  const buyerKeyByAccountId = new Map<number, string>();
  const buyerKeyByStableKey = new Map<string, string>();

  for (const target of targets) {
    if (!target.buyerAccountKey.trim() || !target.stableKey.trim()) {
      throw new Error("account target requires buyerAccountKey and stableKey");
    }
    if (!Number.isInteger(target.accountId) || target.accountId <= 0) {
      throw new Error(`account target ${target.buyerAccountKey} requires a positive accountId`);
    }
    if (result.has(target.buyerAccountKey)) {
      throw new Error(`Duplicate account target ${target.buyerAccountKey}`);
    }
    if (
      target.rowClass !== "account"
      || !target.countsTowardPotential
      || ["merged", "parked", "excluded"].includes(target.recordStatus)
      || target.routeToMarket === "exclude"
    ) {
      throw new Error(`Account target ${target.buyerAccountKey} is not eligible for a draft model`);
    }

    const existingBuyerForAccount = buyerKeyByAccountId.get(target.accountId);
    if (existingBuyerForAccount && existingBuyerForAccount !== target.buyerAccountKey) {
      throw new Error(
        `Account target ${target.accountId} is assigned to distinct buyer keys ${existingBuyerForAccount} and ${target.buyerAccountKey}`,
      );
    }
    const existingBuyerForStableKey = buyerKeyByStableKey.get(target.stableKey);
    if (existingBuyerForStableKey && existingBuyerForStableKey !== target.buyerAccountKey) {
      throw new Error(
        `Stable account target ${target.stableKey} is assigned to distinct buyer keys ${existingBuyerForStableKey} and ${target.buyerAccountKey}`,
      );
    }

    buyerKeyByAccountId.set(target.accountId, target.buyerAccountKey);
    buyerKeyByStableKey.set(target.stableKey, target.buyerAccountKey);
    result.set(target.buyerAccountKey, target);
  }
  return result;
}

function publicEvidenceSummary(record: FullPotentialPublicEvidenceRecord): string {
  return [
    "Public observation:",
    record.publicObservation,
    "",
    "Transparent inference:",
    record.inference,
    "",
    `Evidence grade: ${record.evidenceGrade}`,
    `Model band: ${record.modelBand ?? "unbanded"}`,
    `Commercial pool: ${record.commercialPoolKey ?? "none"}`,
    `Counting treatment: ${record.countingTreatment}`,
    `Addressability status: ${record.addressabilityStatus}`,
  ].join("\n");
}

/**
 * Produce a deterministic proposal manifest only. This function does not open a
 * database connection, import evidence, create models, approve values, trigger
 * C4C, call a provider or invoke the production pipeline.
 *
 * One canonical buyer account may carry several genuinely distinct commercial
 * pools. The manifest therefore proposes one draft model per account and one
 * line per commercial pool. Unobserved allowances remain management-only until
 * replaced by named, reconciled buyer records.
 */
export function buildFullPotentialDraftImportManifest(
  input: FullPotentialDraftImportManifestInput,
): FullPotentialDraftImportManifest {
  assertOpaque(input.generatedByRef, "generatedByRef");
  assertOpaque(input.sourcePackRef, "sourcePackRef");
  if (Number.isNaN(Date.parse(input.generatedAt))) {
    throw new Error("generatedAt must be a valid date");
  }

  const materialized = materializeFullPotentialDraftPack(
    input.publicObservations,
    input.restrictedPlanning,
  );
  const targets = accountTargetMap(input.accountTargets);
  const envelopeByRecord = new Map(
    materialized.planningEnvelopes.map(envelope => [envelope.record.recordKey, envelope]),
  );

  const evidenceProposals: FullPotentialDraftEvidenceProposal[] = [];
  const modelProposalByAccountId = new Map<number, FullPotentialDraftModelProposal>();
  const lineProposals: FullPotentialDraftLineProposal[] = [];
  const managementOnlyRecordKeys: string[] = [];
  const managementOnlyMonetaryRecordKeys: string[] = [];
  const usedTargetsByAccountId = new Map<number, FullPotentialImportAccountTarget>();
  const commercialPoolKeys = new Set<string>();
  const sourceBuyerCountingCount = materialized.records.filter(
    record => record.countingTreatment === "buyer_counting",
  ).length;

  for (const record of materialized.records) {
    const isUnobservedAllowance = record.valueClass === "unobserved_allowance";
    if (record.countingTreatment !== "buyer_counting" || isUnobservedAllowance) {
      managementOnlyRecordKeys.push(record.recordKey);
      if (record.countingTreatment === "buyer_counting") {
        managementOnlyMonetaryRecordKeys.push(record.recordKey);
      }
      continue;
    }

    const buyerAccountKey = record.buyerAccountKey as string;
    const commercialPoolKey = record.commercialPoolKey as string;
    if (commercialPoolKeys.has(commercialPoolKey)) {
      throw new Error(`Duplicate import-eligible commercialPoolKey ${commercialPoolKey}`);
    }
    commercialPoolKeys.add(commercialPoolKey);

    const target = targets.get(buyerAccountKey);
    if (!target) {
      throw new Error(`No eligible account target for buyer ${buyerAccountKey}`);
    }
    const existingTarget = usedTargetsByAccountId.get(target.accountId);
    if (existingTarget && existingTarget.buyerAccountKey !== buyerAccountKey) {
      throw new Error(
        `Distinct public buyer identities target counting account ${target.accountId}`,
      );
    }
    usedTargetsByAccountId.set(target.accountId, target);

    const envelope = envelopeByRecord.get(record.recordKey);
    if (!envelope) {
      throw new Error(`No private planning envelope for ${record.recordKey}`);
    }
    const base = record.scenarios?.base;
    if (!base) throw new Error(`Base scenario missing for ${record.recordKey}`);
    const baseResult = calculateFullPotentialPublicScenario(record, "base");
    const estimatedTotalFleetUnits = record.scenarioBasis === "fleet_replacement"
      ? Number(base.estimatedFleetUnits ?? 0)
      : null;
    const annualReplacementUnits = baseResult.modelledThreeYearUnits > 0
      ? Math.round(((baseResult.modelledThreeYearUnits / 3) + Number.EPSILON) * 100) / 100
      : null;

    evidenceProposals.push({
      proposalKey: `evidence:${record.recordKey}:public`,
      recordKey: record.recordKey,
      accountId: target.accountId,
      buyerAccountKey,
      commercialPoolKey,
      productFamily: record.productFamily,
      evidenceType: "public_source",
      title: `${record.buyerName} public Full Potential evidence`,
      summary: publicEvidenceSummary(record),
      sourceName: record.sourceName,
      sourceUrl: record.sourceUrl,
      sourceReference: record.recordKey,
      observedAt: record.observedAt,
      confidenceLevel: confidence(record.evidenceGrade),
      status: "draft",
    });
    evidenceProposals.push({
      proposalKey: `evidence:${record.recordKey}:planning`,
      recordKey: record.recordKey,
      accountId: target.accountId,
      buyerAccountKey,
      commercialPoolKey,
      productFamily: record.productFamily,
      evidenceType: "financial_assumption",
      title: `${record.buyerName} restricted planning assumptions`,
      summary: "Restricted Low, Base and High planning assumptions. Values require admin review and remain draft; this record is not public customer evidence.",
      sourceName: null,
      sourceUrl: null,
      sourceReference: envelope.planningValueSetRef,
      observedAt: null,
      confidenceLevel: confidence(record.evidenceGrade),
      status: "draft",
    });

    if (!modelProposalByAccountId.has(target.accountId)) {
      modelProposalByAccountId.set(target.accountId, {
        proposalKey: `model:${buyerAccountKey}:public-v1`,
        accountId: target.accountId,
        buyerAccountKey,
        status: "draft",
        methodologyVersion: "fp-public-v1",
        assumptionsSummary: "Public observations and transparent inferences combined with restricted Low, Base and High planning sets. Distinct commercial pools are held as separate draft lines; no account value is approved by this manifest.",
      });
    }

    lineProposals.push({
      proposalKey: `line:${record.recordKey}:base`,
      recordKey: record.recordKey,
      commercialPoolKey,
      accountId: target.accountId,
      buyerAccountKey,
      productFamily: record.productFamily,
      productCell: record.productCell,
      valueClass: record.valueClass,
      application: record.application,
      routeToMarket: target.routeToMarket,
      estimatedTotalFleetUnits,
      annualReplacementUnits,
      averageSellingPriceAud: Number(base.averageSellingPriceAud),
      addressableSharePct: Number(base.addressableSharePct),
      baseThreeYearUnits: baseResult.modelledThreeYearUnits,
      basePotentialAud: baseResult.potentialAud,
      confidenceLevel: confidence(record.evidenceGrade),
      assumptions: toFullPotentialPrivatePlanningAssumptions(envelope),
      status: "draft",
    });
  }

  const modelProposals = [...modelProposalByAccountId.values()];
  const accountTargetSnapshot = [...usedTargetsByAccountId.values()]
    .map(target => ({
      buyerAccountKey: target.buyerAccountKey,
      accountId: target.accountId,
      stableKey: target.stableKey,
      routeToMarket: target.routeToMarket,
    }))
    .sort((left, right) => left.accountId - right.accountId);

  const unsigned = {
    version: 2 as const,
    safetyMode: "draft_only_no_writes" as const,
    generatedAt: new Date(input.generatedAt).toISOString(),
    generatedByRef: input.generatedByRef,
    sourcePackRef: input.sourcePackRef,
    methodologyVersion: "fp-public-v1" as const,
    publicObservationCount: materialized.publicObservationCount,
    restrictedPlanningCount: materialized.restrictedPlanningCount,
    buyerCountingCount: sourceBuyerCountingCount,
    importEligibleBuyerCountingCount: lineProposals.length,
    distinctBuyerAccountCount: modelProposals.length,
    commercialPoolCount: commercialPoolKeys.size,
    managementOnlyRecordCount: managementOnlyRecordKeys.length,
    managementOnlyMonetaryRecordCount: managementOnlyMonetaryRecordKeys.length,
    evidenceProposals: evidenceProposals.sort((left, right) => left.proposalKey.localeCompare(right.proposalKey)),
    modelProposals: modelProposals.sort((left, right) => left.proposalKey.localeCompare(right.proposalKey)),
    lineProposals: lineProposals.sort((left, right) => left.proposalKey.localeCompare(right.proposalKey)),
    managementOnlyRecordKeys: managementOnlyRecordKeys.sort(),
    accountTargetSnapshot,
    invariants: {
      allStatusesDraft: true as const,
      oneModelPerAccount: true as const,
      multipleDistinctPoolsPerBuyerAllowed: true as const,
      unobservedAllowanceImportProposals: 0 as const,
      approvalsProposed: 0 as const,
      accountMutationsProposed: 0 as const,
      crmWritesProposed: 0 as const,
      pipelineInvocationsProposed: 0 as const,
      providerCallsProposed: 0 as const,
    },
  };

  return {
    ...unsigned,
    manifestSha256: sha256(unsigned),
  };
}

export function verifyFullPotentialDraftImportManifest(
  manifest: FullPotentialDraftImportManifest,
): void {
  const { manifestSha256, ...unsigned } = manifest;
  if (!/^[a-f0-9]{64}$/.test(manifestSha256) || sha256(unsigned) !== manifestSha256) {
    throw new Error("Full Potential draft import manifest SHA-256 mismatch");
  }
  if (manifest.version !== 2 || manifest.safetyMode !== "draft_only_no_writes") {
    throw new Error("Full Potential import manifest has an unsupported version or safety mode");
  }
  if (
    manifest.evidenceProposals.some(row => row.status !== "draft")
    || manifest.modelProposals.some(row => row.status !== "draft")
    || manifest.lineProposals.some(row => row.status !== "draft")
  ) {
    throw new Error("Full Potential import manifest contains a non-draft proposal");
  }

  assertUnique(manifest.evidenceProposals.map(row => row.proposalKey), "evidence proposal keys");
  assertUnique(manifest.modelProposals.map(row => row.proposalKey), "model proposal keys");
  assertUnique(manifest.modelProposals.map(row => String(row.accountId)), "model account IDs");
  assertUnique(manifest.lineProposals.map(row => row.proposalKey), "line proposal keys");
  assertUnique(manifest.lineProposals.map(row => row.recordKey), "line record keys");
  assertUnique(manifest.lineProposals.map(row => row.commercialPoolKey), "line commercial-pool keys");
  assertUnique(manifest.accountTargetSnapshot.map(row => String(row.accountId)), "account target IDs");
  assertUnique(manifest.accountTargetSnapshot.map(row => row.buyerAccountKey), "account target buyer keys");

  const modelAccountIds = new Set(manifest.modelProposals.map(row => row.accountId));
  const targetAccountIds = new Set(manifest.accountTargetSnapshot.map(row => row.accountId));
  const lineRecordKeys = new Set(manifest.lineProposals.map(row => row.recordKey));
  for (const line of manifest.lineProposals) {
    if (!modelAccountIds.has(line.accountId) || !targetAccountIds.has(line.accountId)) {
      throw new Error(`Line proposal ${line.proposalKey} has no draft model or account target`);
    }
    if (line.valueClass === "unobserved_allowance") {
      throw new Error(`Unobserved allowance ${line.recordKey} must remain management-only`);
    }
  }
  for (const recordKey of manifest.managementOnlyRecordKeys) {
    if (lineRecordKeys.has(recordKey)) {
      throw new Error(`Management-only record ${recordKey} also appears as a draft line`);
    }
  }

  if (
    manifest.importEligibleBuyerCountingCount !== manifest.lineProposals.length
    || manifest.distinctBuyerAccountCount !== manifest.modelProposals.length
    || manifest.commercialPoolCount !== new Set(
      manifest.lineProposals.map(row => row.commercialPoolKey),
    ).size
    || manifest.managementOnlyRecordCount !== manifest.managementOnlyRecordKeys.length
    || manifest.buyerCountingCount !== (
      manifest.importEligibleBuyerCountingCount + manifest.managementOnlyMonetaryRecordCount
    )
  ) {
    throw new Error("Full Potential import manifest count reconciliation failed");
  }

  if (
    manifest.invariants.allStatusesDraft !== true
    || manifest.invariants.oneModelPerAccount !== true
    || manifest.invariants.multipleDistinctPoolsPerBuyerAllowed !== true
    || manifest.invariants.unobservedAllowanceImportProposals !== 0
    || manifest.invariants.approvalsProposed !== 0
    || manifest.invariants.accountMutationsProposed !== 0
    || manifest.invariants.crmWritesProposed !== 0
    || manifest.invariants.pipelineInvocationsProposed !== 0
    || manifest.invariants.providerCallsProposed !== 0
  ) {
    throw new Error("Full Potential import manifest violates the no-side-effect boundary");
  }
}
