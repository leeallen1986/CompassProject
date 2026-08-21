import { createHash } from "node:crypto";
import {
  calculateFullPotentialPublicScenario,
  toFullPotentialModelAssumptions,
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
  accountId: number;
  buyerAccountKey: string;
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
  accountId: number;
  buyerAccountKey: string;
  productFamily: FullPotentialPublicEvidenceRecord["productFamily"];
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
  version: 1;
  safetyMode: "draft_only_no_writes";
  generatedAt: string;
  generatedByRef: string;
  sourcePackRef: string;
  methodologyVersion: "fp-public-v1";
  publicObservationCount: number;
  restrictedPlanningCount: number;
  buyerCountingCount: number;
  managementOnlyRecordCount: number;
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

function accountTargetMap(
  targets: FullPotentialImportAccountTarget[],
): Map<string, FullPotentialImportAccountTarget> {
  const result = new Map<string, FullPotentialImportAccountTarget>();
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
    ) {
      throw new Error(`Account target ${target.buyerAccountKey} is not eligible for a draft model`);
    }
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
    `Counting treatment: ${record.countingTreatment}`,
    `Addressability status: ${record.addressabilityStatus}`,
  ].join("\n");
}

/**
 * Produce a deterministic proposal manifest only. This function does not open a
 * database connection, import evidence, create models, approve values, trigger
 * C4C, call a provider or invoke the production pipeline.
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
  const modelProposals: FullPotentialDraftModelProposal[] = [];
  const lineProposals: FullPotentialDraftLineProposal[] = [];
  const managementOnlyRecordKeys: string[] = [];
  const usedAccountIds = new Set<number>();

  for (const record of materialized.records) {
    if (record.countingTreatment !== "buyer_counting") {
      managementOnlyRecordKeys.push(record.recordKey);
      continue;
    }

    const buyerAccountKey = record.buyerAccountKey as string;
    const target = targets.get(buyerAccountKey);
    if (!target) {
      throw new Error(`No eligible account target for buyer ${buyerAccountKey}`);
    }
    if (usedAccountIds.has(target.accountId)) {
      throw new Error(
        `More than one buyer-counting public record targets account ${target.accountId}; split or consolidate the commercial pool before import`,
      );
    }
    usedAccountIds.add(target.accountId);

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
      accountId: target.accountId,
      buyerAccountKey,
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
      accountId: target.accountId,
      buyerAccountKey,
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
    modelProposals.push({
      proposalKey: `model:${buyerAccountKey}:public-v1`,
      accountId: target.accountId,
      buyerAccountKey,
      status: "draft",
      methodologyVersion: "fp-public-v1",
      assumptionsSummary: "Public observation and transparent inference combined with a restricted Low, Base and High planning set. No account value is approved by this manifest.",
    });
    lineProposals.push({
      proposalKey: `line:${record.recordKey}:base`,
      accountId: target.accountId,
      buyerAccountKey,
      productFamily: record.productFamily,
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

  const accountTargetSnapshot = [...usedAccountIds]
    .map(accountId => input.accountTargets.find(target => target.accountId === accountId) as FullPotentialImportAccountTarget)
    .map(target => ({
      buyerAccountKey: target.buyerAccountKey,
      accountId: target.accountId,
      stableKey: target.stableKey,
      routeToMarket: target.routeToMarket,
    }))
    .sort((left, right) => left.accountId - right.accountId);

  const unsigned = {
    version: 1 as const,
    safetyMode: "draft_only_no_writes" as const,
    generatedAt: new Date(input.generatedAt).toISOString(),
    generatedByRef: input.generatedByRef,
    sourcePackRef: input.sourcePackRef,
    methodologyVersion: "fp-public-v1" as const,
    publicObservationCount: materialized.publicObservationCount,
    restrictedPlanningCount: materialized.restrictedPlanningCount,
    buyerCountingCount: lineProposals.length,
    managementOnlyRecordCount: managementOnlyRecordKeys.length,
    evidenceProposals: evidenceProposals.sort((left, right) => left.proposalKey.localeCompare(right.proposalKey)),
    modelProposals: modelProposals.sort((left, right) => left.proposalKey.localeCompare(right.proposalKey)),
    lineProposals: lineProposals.sort((left, right) => left.proposalKey.localeCompare(right.proposalKey)),
    managementOnlyRecordKeys: managementOnlyRecordKeys.sort(),
    accountTargetSnapshot,
    invariants: {
      allStatusesDraft: true as const,
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
  if (manifest.safetyMode !== "draft_only_no_writes") {
    throw new Error("Full Potential import manifest is not draft-only");
  }
  if (
    manifest.evidenceProposals.some(row => row.status !== "draft")
    || manifest.modelProposals.some(row => row.status !== "draft")
    || manifest.lineProposals.some(row => row.status !== "draft")
  ) {
    throw new Error("Full Potential import manifest contains a non-draft proposal");
  }
  if (
    manifest.invariants.approvalsProposed !== 0
    || manifest.invariants.accountMutationsProposed !== 0
    || manifest.invariants.crmWritesProposed !== 0
    || manifest.invariants.pipelineInvocationsProposed !== 0
    || manifest.invariants.providerCallsProposed !== 0
  ) {
    throw new Error("Full Potential import manifest violates the no-side-effect boundary");
  }
}
