import {
  FP_PRODUCT_FAMILY_LABELS,
  formatAud,
  numericValue,
  type CommercialModelLine,
  type CommercialWorkspace,
  type FpProductFamily,
} from "./fullPotentialCommercialModel";

export const TOP_FIVE_PILOT_ACCOUNTS = [
  {
    rank: 1,
    id: 272,
    name: "United Rentals",
    focus: "Validate the direct-versus-CEA buying path, fleet application and genuine incremental opportunity.",
  },
  {
    rank: 2,
    id: 415,
    name: "Onsite Rental Group",
    focus: "Confirm fleet change-out timing, channel responsibility and the evidence behind the national potential.",
  },
  {
    rank: 3,
    id: 269,
    name: "Coates Hire",
    focus: "Confirm the canonical commercial account and distinguish incremental potential from existing revenue.",
  },
  {
    rank: 4,
    id: 270,
    name: "Flexihire",
    focus: "Validate the large-air investment signal, configuration, timing and accountable buying team.",
  },
  {
    rank: 5,
    id: 275,
    name: "Tutt Bryant Hire",
    focus: "Confirm project context, buying entity, fleet requirement and next purchase decision point.",
  },
] as const;

export type TopFivePilotAccount = (typeof TOP_FIVE_PILOT_ACCOUNTS)[number];

export const ACTIVE_ATTRIBUTED_STATUSES = [
  "identified",
  "contacted",
  "meeting_booked",
  "qualified",
  "quoted",
  "deferred",
] as const;

export const PROGRESSED_ATTRIBUTED_STATUSES = [
  "contacted",
  "meeting_booked",
  "qualified",
  "quoted",
  "won",
] as const;

export interface PilotPipelineClaim {
  id: number;
  userId: number;
  sourceType: string;
  sourceAccountId?: number | null;
  productFamily?: string | null;
  application?: string | null;
  commercialHypothesis?: string | null;
  status: string;
  estimatedValueAud?: string | number | null;
  nextAction?: string | null;
  nextActionDate?: string | Date | null;
  contactName?: string | null;
  contactRole?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface PilotAccountSnapshot {
  accountId: number;
  loaded: boolean;
  evidenceCount: number;
  verifiedEvidenceCount: number;
  approvedModel: boolean;
  approvedLineCount: number;
  approvedPotentialAud: number;
  attributedClaimCount: number;
  progressedClaimCount: number;
  attributedValueAud: number;
  nextStep: string;
}

export interface PilotSummary {
  loadedAccounts: number;
  evidenceReadyAccounts: number;
  approvedModels: number;
  attributedPursuits: number;
  progressedPursuits: number;
  attributedValueAud: number;
}

export interface PursuitDraft {
  productFamily: FpProductFamily;
  application: string;
  commercialHypothesis: string;
  contactName: string;
  contactRole: string;
  nextAction: string;
  nextActionDate: string;
  estimatedValueAud: string;
  notes: string;
  confirmed: boolean;
}

function isActiveStatus(status: string): boolean {
  return (ACTIVE_ATTRIBUTED_STATUSES as readonly string[]).includes(status);
}

function isProgressedStatus(status: string): boolean {
  return (PROGRESSED_ATTRIBUTED_STATUSES as readonly string[]).includes(status);
}

export function fullPotentialClaims(claims: PilotPipelineClaim[]): PilotPipelineClaim[] {
  return claims.filter(claim => claim.sourceType === "full_potential");
}

export function approvedModelLines(workspace: CommercialWorkspace | null): CommercialModelLine[] {
  if (!workspace?.approvedModel) return [];
  return workspace.lines.filter(
    line => line.modelId === workspace.approvedModel?.id && numericValue(line.linePotentialAud) > 0,
  );
}

export function activeClaimForLine(
  claims: PilotPipelineClaim[],
  line: CommercialModelLine,
): PilotPipelineClaim | null {
  return fullPotentialClaims(claims).find(
    claim =>
      claim.productFamily === line.productFamily &&
      (claim.application ?? "").trim().toLowerCase() === line.application.trim().toLowerCase() &&
      isActiveStatus(claim.status),
  ) ?? null;
}

export function nextPilotStep(
  workspace: CommercialWorkspace | null,
  claims: PilotPipelineClaim[],
): string {
  if (!workspace) return "Load the account intelligence workspace";
  if (workspace.evidence.length === 0) return "Capture the first source-backed evidence record";
  if (!workspace.evidence.some(item => item.status === "verified")) {
    return "Verify the evidence that supports the commercial hypothesis";
  }
  if (!workspace.approvedModel) {
    const status = workspace.latestModel?.status;
    if (status === "submitted") return "Manager reviews the submitted commercial model";
    if (status === "returned") return "Resolve the manager return note and resubmit the model";
    if (status === "draft") return "Complete and submit the evidence-linked product-family model";
    return "Create the evidence-backed commercial model";
  }
  if (approvedModelLines(workspace).length === 0) {
    return "Correct the approved model so it contains a positive product-family line";
  }

  const attributed = fullPotentialClaims(claims);
  if (attributed.length === 0) return "Start one attributed commercial pursuit from an approved model line";
  if (!attributed.some(claim => isProgressedStatus(claim.status))) {
    return "Complete the first customer validation and record the outcome";
  }
  if (attributed.some(claim => ["qualified", "quoted", "won"].includes(claim.status))) {
    return "Maintain the formal opportunity, forecast and quote in C4C";
  }
  return "Continue customer validation; move to C4C only when genuinely qualified";
}

export function buildPilotSnapshot(
  accountId: number,
  workspace: CommercialWorkspace | null,
  claims: PilotPipelineClaim[],
): PilotAccountSnapshot {
  const attributed = fullPotentialClaims(claims);
  const progressed = attributed.filter(claim => isProgressedStatus(claim.status));
  const approvedLines = approvedModelLines(workspace);

  return {
    accountId,
    loaded: !!workspace,
    evidenceCount: workspace?.evidence.length ?? 0,
    verifiedEvidenceCount: workspace?.evidence.filter(item => item.status === "verified").length ?? 0,
    approvedModel: !!workspace?.approvedModel,
    approvedLineCount: approvedLines.length,
    approvedPotentialAud: numericValue(workspace?.approvedModel?.totalPotentialAud),
    attributedClaimCount: attributed.length,
    progressedClaimCount: progressed.length,
    attributedValueAud: attributed
      .filter(claim => !["lost", "not_relevant"].includes(claim.status))
      .reduce((sum, claim) => sum + numericValue(claim.estimatedValueAud), 0),
    nextStep: nextPilotStep(workspace, claims),
  };
}

export function calculatePilotSummary(snapshots: PilotAccountSnapshot[]): PilotSummary {
  return snapshots.reduce<PilotSummary>(
    (summary, snapshot) => ({
      loadedAccounts: summary.loadedAccounts + (snapshot.loaded ? 1 : 0),
      evidenceReadyAccounts:
        summary.evidenceReadyAccounts +
        (snapshot.verifiedEvidenceCount > 0 && snapshot.approvedLineCount > 0 ? 1 : 0),
      approvedModels: summary.approvedModels + (snapshot.approvedModel ? 1 : 0),
      attributedPursuits: summary.attributedPursuits + snapshot.attributedClaimCount,
      progressedPursuits: summary.progressedPursuits + snapshot.progressedClaimCount,
      attributedValueAud: summary.attributedValueAud + snapshot.attributedValueAud,
    }),
    {
      loadedAccounts: 0,
      evidenceReadyAccounts: 0,
      approvedModels: 0,
      attributedPursuits: 0,
      progressedPursuits: 0,
      attributedValueAud: 0,
    },
  );
}

function dateInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date.getTime() < today.getTime()) return "";
  return date.toISOString().slice(0, 10);
}

export function createPursuitDraft(
  workspace: CommercialWorkspace,
  line: CommercialModelLine,
): PursuitDraft {
  const model = workspace.approvedModel;
  const assumptions = model?.assumptionsSummary?.trim() ?? "";
  const accountNextAction = (workspace.account as CommercialWorkspace["account"] & {
    nextAction?: string | null;
    nextActionDate?: string | Date | null;
  });

  return {
    productFamily: line.productFamily,
    application: line.application,
    commercialHypothesis: assumptions,
    contactName: "",
    contactRole: "",
    nextAction: accountNextAction.nextAction?.trim() ?? "",
    nextActionDate: dateInputValue(accountNextAction.nextActionDate),
    estimatedValueAud: numericValue(line.linePotentialAud).toFixed(2),
    notes: model
      ? `Started from approved Full Potential model ${model.modelKey} and ${FP_PRODUCT_FAMILY_LABELS[line.productFamily]} line ${line.lineKey}.`
      : "",
    confirmed: false,
  };
}

export function pursuitDraftErrors(draft: PursuitDraft): string[] {
  const errors: string[] = [];
  if (!draft.application.trim()) errors.push("Application is required");
  if (draft.commercialHypothesis.trim().length < 3) errors.push("Commercial hypothesis is required");
  if (!draft.contactName.trim() && !draft.contactRole.trim()) {
    errors.push("Add a customer contact name or the target customer role");
  }
  if (draft.nextAction.trim().length < 3) errors.push("Next action is required");
  if (!draft.nextActionDate) errors.push("Next-action date is required");
  if (numericValue(draft.estimatedValueAud) <= 0) errors.push("Confirm a positive pursuit estimate");
  if (!draft.confirmed) {
    errors.push("Confirm that Compass is starting an attributed pursuit, not creating the formal C4C opportunity");
  }
  return errors;
}

export function pilotStatusLabel(snapshot: PilotAccountSnapshot): string {
  if (!snapshot.loaded) return "Loading";
  if (!snapshot.approvedModel) return "Model required";
  if (snapshot.attributedClaimCount === 0) return "Ready to activate";
  if (snapshot.progressedClaimCount === 0) return "Pursuit started";
  return "Commercially progressing";
}

export function pilotValueLabel(snapshot: PilotAccountSnapshot): string {
  return snapshot.attributedClaimCount > 0
    ? formatAud(snapshot.attributedValueAud)
    : formatAud(snapshot.approvedPotentialAud);
}
