import type { FullPotentialSeptemberManagementView } from "./fullPotentialManagementView";

export const FP_MANAGEMENT_PLANNING_STATUSES = [
  "provisional",
  "reviewed",
  "approved",
] as const;
export const FP_MANAGEMENT_LOCALISATION_STATUSES = [
  "tbc",
  "estimated",
  "costed",
] as const;
export const FP_MANAGEMENT_RECONCILIATION_STATUSES = [
  "not_run",
  "partial",
  "complete",
] as const;

export type FullPotentialManagementPlanningStatus =
  typeof FP_MANAGEMENT_PLANNING_STATUSES[number];
export type FullPotentialManagementLocalisationStatus =
  typeof FP_MANAGEMENT_LOCALISATION_STATUSES[number];
export type FullPotentialManagementReconciliationStatus =
  typeof FP_MANAGEMENT_RECONCILIATION_STATUSES[number];

export interface FullPotentialManagementReadinessInput {
  expectedCurrentRevenueSegments: string[];
  planningStatus: FullPotentialManagementPlanningStatus;
  localisationCostStatus: FullPotentialManagementLocalisationStatus;
  accountReconciliationStatus: FullPotentialManagementReconciliationStatus;
  /** Whether the meeting pack depends on a live production deployment. Default false. */
  liveDeploymentRequired?: boolean;
}

export interface FullPotentialManagementDataGap {
  key: string;
  severity: "information" | "caution" | "blocker";
  blocksHeadline: boolean;
  blocksCurrentVsPotentialGap: boolean;
  blocksDraftImport: boolean;
  label: string;
  treatment: string;
}

export interface FullPotentialManagementReadiness {
  meetingStatus: "ready" | "ready_with_declared_gaps" | "blocked";
  headlineAvailable: boolean;
  currentVsPotentialGapAvailable: boolean;
  draftImportReady: boolean;
  missingCurrentRevenueSegments: string[];
  dataGaps: FullPotentialManagementDataGap[];
  meetingNotes: string[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort();
}

/**
 * Assess whether the September management story can proceed without waiting for
 * every internal input. Missing aggregate revenue never becomes zero and does
 * not block the Full Potential headline; it blocks only the current-versus-gap
 * comparison for the affected buyer segment.
 */
export function assessFullPotentialManagementReadiness(
  view: FullPotentialSeptemberManagementView,
  input: FullPotentialManagementReadinessInput,
): FullPotentialManagementReadiness {
  const expectedSegments = uniqueSorted(input.expectedCurrentRevenueSegments);
  const revenueBySegment = new Map(
    view.buyerSegments.map(row => [row.key, row.currentRevenueAud]),
  );
  const missingCurrentRevenueSegments = expectedSegments.filter(
    segment => revenueBySegment.get(segment) === null || revenueBySegment.get(segment) === undefined,
  );

  const dataGaps: FullPotentialManagementDataGap[] = [];
  if (missingCurrentRevenueSegments.length > 0) {
    dataGaps.push({
      key: "aggregate_current_revenue_pending",
      severity: "caution",
      blocksHeadline: false,
      blocksCurrentVsPotentialGap: true,
      blocksDraftImport: false,
      label: "Aggregate current revenue pending",
      treatment: `Show Full Potential Low/Base/High now; mark current revenue and remaining gap as pending for ${missingCurrentRevenueSegments.join(", ")}.`,
    });
  }

  if (input.planningStatus === "provisional") {
    dataGaps.push({
      key: "planning_values_provisional",
      severity: "caution",
      blocksHeadline: false,
      blocksCurrentVsPotentialGap: false,
      blocksDraftImport: false,
      label: "Planning values are provisional",
      treatment: "Present Low/Base/High as an internal sensitivity and label the Base case as a planning assumption, not an approved account value.",
    });
  }

  if (input.localisationCostStatus === "tbc") {
    dataGaps.push({
      key: "localisation_cost_tbc",
      severity: "caution",
      blocksHeadline: false,
      blocksCurrentVsPotentialGap: false,
      blocksDraftImport: false,
      label: "Local engineering cost remains TBC",
      treatment: "Show Tough Stationary machine-only potential separately from unresolved local-engineering and compliance uplift.",
    });
  }

  if (input.accountReconciliationStatus !== "complete") {
    dataGaps.push({
      key: "canonical_account_reconciliation_incomplete",
      severity: "caution",
      blocksHeadline: false,
      blocksCurrentVsPotentialGap: false,
      blocksDraftImport: true,
      label: "Canonical account reconciliation incomplete",
      treatment: "Use the public named-account model for the meeting, but do not create a production draft import until every buyer is matched or explicitly resolved.",
    });
  }

  if (input.liveDeploymentRequired) {
    dataGaps.push({
      key: "live_deployment_dependency",
      severity: "blocker",
      blocksHeadline: true,
      blocksCurrentVsPotentialGap: true,
      blocksDraftImport: true,
      label: "Meeting pack depends on live deployment",
      treatment: "Remove the deployment dependency and generate the meeting pack from the governed source and restricted planning snapshot.",
    });
  }

  const headlineAvailable = view.headline.total.baseAud > 0
    && !dataGaps.some(gap => gap.blocksHeadline);
  const currentVsPotentialGapAvailable = missingCurrentRevenueSegments.length === 0
    && !dataGaps.some(gap => gap.blocksCurrentVsPotentialGap && gap.severity === "blocker");
  const draftImportReady = input.accountReconciliationStatus === "complete"
    && !dataGaps.some(gap => gap.blocksDraftImport && gap.severity === "blocker");

  const meetingStatus = !headlineAvailable
    ? "blocked"
    : dataGaps.length > 0
      ? "ready_with_declared_gaps"
      : "ready";

  return {
    meetingStatus,
    headlineAvailable,
    currentVsPotentialGapAvailable,
    draftImportReady,
    missingCurrentRevenueSegments,
    dataGaps,
    meetingNotes: [
      "Do not substitute zero for missing current revenue.",
      "The Full Potential headline may proceed from public evidence and transparent assumptions.",
      "Current revenue and remaining potential are shown only where an aggregate source is available.",
      "Production import remains a separate gate from meeting readiness.",
    ],
  };
}
