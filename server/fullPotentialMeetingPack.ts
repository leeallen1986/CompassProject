import { createHash } from "node:crypto";
import {
  assertFullPotentialManagementViewReconciles,
  buildFullPotentialSeptemberManagementView,
  type FullPotentialManagementCurrentRevenueInput,
  type FullPotentialSeptemberManagementView,
} from "../shared/fullPotentialManagementView";
import {
  assessFullPotentialManagementReadiness,
  type FullPotentialManagementReadiness,
  type FullPotentialManagementReadinessInput,
} from "../shared/fullPotentialManagementReadiness";
import {
  buildFullPotentialManagementExportBundle,
  type FullPotentialManagementExportBundle,
  type FullPotentialManagementExportOptions,
} from "../shared/fullPotentialManagementExport";
import {
  materializeFullPotentialDraftPack,
  type FullPotentialPublicObservationRecord,
  type FullPotentialRestrictedScenarioRecord,
} from "../shared/fullPotentialPublicDraftPack";

export interface FullPotentialMeetingPackInput {
  publicObservations: FullPotentialPublicObservationRecord[];
  restrictedPlanning: FullPotentialRestrictedScenarioRecord[];
  currentRevenueInputs?: FullPotentialManagementCurrentRevenueInput[];
  readiness: FullPotentialManagementReadinessInput;
  exportOptions?: FullPotentialManagementExportOptions;
  generatedAt: string;
  sourcePackRef: string;
}

export interface FullPotentialMeetingPackManifest {
  version: 1;
  generatedAt: string;
  sourcePackRef: string;
  methodologyVersion: string;
  meetingStatus: FullPotentialManagementReadiness["meetingStatus"];
  publicObservationCount: number;
  restrictedPlanningCount: number;
  countingRecordCount: number;
  nonCountingRecordCount: number;
  outputs: {
    managementViewJsonSha256: string;
    readinessJsonSha256: string;
    markdownSha256: string;
    headlineCsvSha256: string;
    buyerSegmentsCsvSha256: string;
    productCellsCsvSha256: string;
    confidenceCsvSha256: string;
    qualificationGapsCsvSha256: string;
    qualificationUniverseCsvSha256: string;
    dataGapsCsvSha256: string;
  };
  invariants: {
    databaseConnections: 0;
    databaseWrites: 0;
    crmWrites: 0;
    pipelineInvocations: 0;
    providerCalls: 0;
    liveDeploymentRequired: false;
  };
  manifestSha256: string;
}

export interface FullPotentialMeetingPack {
  view: FullPotentialSeptemberManagementView;
  readiness: FullPotentialManagementReadiness;
  exportBundle: FullPotentialManagementExportBundle;
  manifest: FullPotentialMeetingPackManifest;
}

const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

function sha256(value: string | unknown): string {
  const content = typeof value === "string" ? value : canonical(value);
  return createHash("sha256").update(content).digest("hex");
}

export function buildFullPotentialMeetingPack(
  input: FullPotentialMeetingPackInput,
): FullPotentialMeetingPack {
  if (Number.isNaN(Date.parse(input.generatedAt))) {
    throw new Error("generatedAt must be a valid date");
  }
  if (!OPAQUE_REFERENCE_PATTERN.test(input.sourcePackRef)) {
    throw new Error("sourcePackRef must be an opaque non-sensitive reference");
  }
  if (input.readiness.liveDeploymentRequired) {
    throw new Error("Meeting pack must not require a live production deployment");
  }

  const materialized = materializeFullPotentialDraftPack(
    input.publicObservations,
    input.restrictedPlanning,
  );
  const view = buildFullPotentialSeptemberManagementView(
    materialized.records,
    input.currentRevenueInputs ?? [],
  );
  assertFullPotentialManagementViewReconciles(view);

  const readiness = assessFullPotentialManagementReadiness(view, {
    ...input.readiness,
    liveDeploymentRequired: false,
  });
  const exportBundle = buildFullPotentialManagementExportBundle(
    view,
    readiness,
    input.exportOptions,
  );

  const unsignedManifest = {
    version: 1 as const,
    generatedAt: new Date(input.generatedAt).toISOString(),
    sourcePackRef: input.sourcePackRef,
    methodologyVersion: view.methodologyVersion,
    meetingStatus: readiness.meetingStatus,
    publicObservationCount: materialized.publicObservationCount,
    restrictedPlanningCount: materialized.restrictedPlanningCount,
    countingRecordCount: view.countingRecordCount,
    nonCountingRecordCount: view.nonCountingRecordCount,
    outputs: {
      managementViewJsonSha256: sha256(view),
      readinessJsonSha256: sha256(readiness),
      markdownSha256: sha256(exportBundle.markdown),
      headlineCsvSha256: sha256(exportBundle.csv.headline),
      buyerSegmentsCsvSha256: sha256(exportBundle.csv.buyerSegments),
      productCellsCsvSha256: sha256(exportBundle.csv.productCells),
      confidenceCsvSha256: sha256(exportBundle.csv.confidence),
      qualificationGapsCsvSha256: sha256(exportBundle.csv.qualificationGaps),
      qualificationUniverseCsvSha256: sha256(exportBundle.csv.qualificationUniverse),
      dataGapsCsvSha256: sha256(exportBundle.csv.dataGaps),
    },
    invariants: {
      databaseConnections: 0 as const,
      databaseWrites: 0 as const,
      crmWrites: 0 as const,
      pipelineInvocations: 0 as const,
      providerCalls: 0 as const,
      liveDeploymentRequired: false as const,
    },
  };

  return {
    view,
    readiness,
    exportBundle,
    manifest: {
      ...unsignedManifest,
      manifestSha256: sha256(unsignedManifest),
    },
  };
}

export function verifyFullPotentialMeetingPack(
  pack: FullPotentialMeetingPack,
): void {
  assertFullPotentialManagementViewReconciles(pack.view);
  const { manifestSha256, ...unsignedManifest } = pack.manifest;
  if (!/^[a-f0-9]{64}$/.test(manifestSha256) || sha256(unsignedManifest) !== manifestSha256) {
    throw new Error("Full Potential meeting-pack manifest SHA-256 mismatch");
  }

  const expectedOutputs = {
    managementViewJsonSha256: sha256(pack.view),
    readinessJsonSha256: sha256(pack.readiness),
    markdownSha256: sha256(pack.exportBundle.markdown),
    headlineCsvSha256: sha256(pack.exportBundle.csv.headline),
    buyerSegmentsCsvSha256: sha256(pack.exportBundle.csv.buyerSegments),
    productCellsCsvSha256: sha256(pack.exportBundle.csv.productCells),
    confidenceCsvSha256: sha256(pack.exportBundle.csv.confidence),
    qualificationGapsCsvSha256: sha256(pack.exportBundle.csv.qualificationGaps),
    qualificationUniverseCsvSha256: sha256(pack.exportBundle.csv.qualificationUniverse),
    dataGapsCsvSha256: sha256(pack.exportBundle.csv.dataGaps),
  };
  if (canonical(expectedOutputs) !== canonical(pack.manifest.outputs)) {
    throw new Error("Full Potential meeting-pack output hash mismatch");
  }
  if (
    pack.manifest.invariants.databaseConnections !== 0
    || pack.manifest.invariants.databaseWrites !== 0
    || pack.manifest.invariants.crmWrites !== 0
    || pack.manifest.invariants.pipelineInvocations !== 0
    || pack.manifest.invariants.providerCalls !== 0
    || pack.manifest.invariants.liveDeploymentRequired !== false
  ) {
    throw new Error("Full Potential meeting pack violates the offline no-side-effect boundary");
  }
}
