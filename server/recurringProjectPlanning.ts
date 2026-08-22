import { createHash } from "node:crypto";
import {
  RECURRING_PROJECT_CONTRACT_VERSION,
  assertRecurringOccurrenceContract,
  assertRecurringProgrammeContract,
  buildRecurringWeeklyRecommendation,
  classifyRecurringOccurrenceCandidate,
  type RecurringOccurrenceContract,
  type RecurringProgrammeContract,
  type RecurringWeeklyRecommendation,
} from "../shared/recurringProjectContract";

export interface RecurringProjectExistingLinkSnapshot {
  projectId: number;
  occurrenceKey: string;
  relationshipType: "canonical" | "supporting_source" | "historic_duplicate" | "related_package";
}

export interface RecurringProjectLinkProposal {
  projectId: number;
  occurrenceKey: string;
  relationshipType: "canonical" | "supporting_source" | "historic_duplicate" | "related_package";
  reason: string;
}

export interface RecurringProjectPlanningInput {
  generatedAt: string;
  generatedByRef: string;
  sourceSnapshotRef: string;
  programmeId?: number | null;
  occurrenceId?: number | null;
  programme: RecurringProgrammeContract;
  existingOccurrences: RecurringOccurrenceContract[];
  candidateOccurrence: RecurringOccurrenceContract;
  existingProjectLinks: RecurringProjectExistingLinkSnapshot[];
  proposedProjectLinks: RecurringProjectLinkProposal[];
  asOfDate?: string | null;
  accountId?: number | null;
  signalId?: number | null;
  fullPotentialContext?: {
    accountName: string;
    productFamily?: string | null;
    application?: string | null;
  } | null;
}

export interface RecurringProjectOccurrenceProposal {
  operation: "create" | "update" | "none" | "manual_review";
  occurrenceKey: string;
  targetOccurrenceKey: string | null;
  reason: string;
  candidate: RecurringOccurrenceContract;
}

export interface RecurringProjectPlanningManifest {
  version: 1;
  contractVersion: typeof RECURRING_PROJECT_CONTRACT_VERSION;
  mode: "preview_only_no_writes";
  generatedAt: string;
  generatedByRef: string;
  sourceSnapshotRef: string;
  programme: RecurringProgrammeContract;
  programmeOperation: "create" | "reference_existing";
  occurrenceProposal: RecurringProjectOccurrenceProposal;
  projectLinkProposals: RecurringProjectLinkProposal[];
  weeklyRecommendation: RecurringWeeklyRecommendation | null;
  invariants: {
    databaseConnections: 0;
    databaseWrites: 0;
    projectDateMutations: 0;
    projectDeletes: 0;
    projectMerges: 0;
    fullPotentialMonetaryMutations: 0;
    durableActionsCreated: 0;
    crmC4cMutations: 0;
    providerCalls: 0;
    pipelineInvocations: 0;
  };
  manifestSha256: string;
}

const OPAQUE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function assertOpaque(value: string, field: string): void {
  if (!OPAQUE_REF.test(value)) throw new Error(`${field} must be an opaque non-sensitive reference`);
}

function assertPositiveId(value: number | null | undefined, field: string): void {
  if (value != null && (!Number.isInteger(value) || value <= 0)) {
    throw new Error(`${field} must be a positive integer when supplied`);
  }
}

function validateProjectLinks(
  existing: RecurringProjectExistingLinkSnapshot[],
  proposals: RecurringProjectLinkProposal[],
  occurrenceKey: string,
): RecurringProjectLinkProposal[] {
  const existingByProject = new Map<number, RecurringProjectExistingLinkSnapshot>();
  for (const row of existing) {
    if (!Number.isInteger(row.projectId) || row.projectId <= 0) throw new Error("existing project link has invalid projectId");
    if (existingByProject.has(row.projectId)) throw new Error(`project ${row.projectId} already has duplicate existing occurrence links`);
    existingByProject.set(row.projectId, row);
  }

  const proposedIds = new Set<number>();
  const canonicalIds = new Set<number>();
  const validated: RecurringProjectLinkProposal[] = [];
  for (const proposal of proposals) {
    if (!Number.isInteger(proposal.projectId) || proposal.projectId <= 0) throw new Error("proposed project link has invalid projectId");
    if (proposal.occurrenceKey !== occurrenceKey) throw new Error(`project ${proposal.projectId} targets the wrong occurrence key`);
    if (!proposal.reason.trim()) throw new Error(`project ${proposal.projectId} requires a link reason`);
    if (proposedIds.has(proposal.projectId)) throw new Error(`project ${proposal.projectId} is proposed more than once`);
    proposedIds.add(proposal.projectId);

    const prior = existingByProject.get(proposal.projectId);
    if (prior && prior.occurrenceKey !== occurrenceKey) {
      throw new Error(
        `project ${proposal.projectId} is already linked to occurrence ${prior.occurrenceKey}`,
      );
    }
    if (proposal.relationshipType === "canonical") canonicalIds.add(proposal.projectId);
    if (!prior || prior.relationshipType !== proposal.relationshipType) validated.push({ ...proposal });
  }
  if (canonicalIds.size > 1) throw new Error("one occurrence cannot have more than one canonical project proposal");
  return validated.sort((left, right) => left.projectId - right.projectId);
}

export function buildRecurringProjectPlanningManifest(
  input: RecurringProjectPlanningInput,
): RecurringProjectPlanningManifest {
  assertOpaque(input.generatedByRef, "generatedByRef");
  assertOpaque(input.sourceSnapshotRef, "sourceSnapshotRef");
  if (Number.isNaN(Date.parse(input.generatedAt))) throw new Error("generatedAt must be a valid date");
  assertPositiveId(input.programmeId, "programmeId");
  assertPositiveId(input.occurrenceId, "occurrenceId");
  assertPositiveId(input.accountId, "accountId");
  assertPositiveId(input.signalId, "signalId");
  assertRecurringProgrammeContract(input.programme);
  assertRecurringOccurrenceContract(input.candidateOccurrence);
  if (input.programme.programmeKey !== input.candidateOccurrence.programmeKey) {
    throw new Error("programme and candidate occurrence keys do not match");
  }
  input.existingOccurrences.forEach(assertRecurringOccurrenceContract);

  const classification = classifyRecurringOccurrenceCandidate({
    existingOccurrences: input.existingOccurrences,
    candidate: input.candidateOccurrence,
  });
  const operation: RecurringProjectOccurrenceProposal["operation"] = classification.decision === "create_new_occurrence"
    ? "create"
    : classification.decision === "update_existing_occurrence"
      ? "update"
      : classification.decision === "manual_review_separate_package"
        ? "manual_review"
        : "none";
  const projectLinkProposals = operation === "manual_review"
    ? []
    : validateProjectLinks(
      input.existingProjectLinks,
      input.proposedProjectLinks,
      input.candidateOccurrence.occurrenceKey,
    );

  const weeklyRecommendation = (
    input.asOfDate
    && input.programmeId
    && input.occurrenceId
    && operation !== "manual_review"
  )
    ? buildRecurringWeeklyRecommendation({
      programmeId: input.programmeId,
      occurrenceId: input.occurrenceId,
      programme: input.programme,
      occurrence: input.candidateOccurrence,
      asOfDate: input.asOfDate,
      accountId: input.accountId,
      projectId: input.candidateOccurrence.canonicalProjectId,
      signalId: input.signalId,
      fullPotentialContext: input.fullPotentialContext,
    })
    : null;

  const unsigned = {
    version: 1 as const,
    contractVersion: RECURRING_PROJECT_CONTRACT_VERSION,
    mode: "preview_only_no_writes" as const,
    generatedAt: new Date(input.generatedAt).toISOString(),
    generatedByRef: input.generatedByRef,
    sourceSnapshotRef: input.sourceSnapshotRef,
    programme: structuredClone(input.programme),
    programmeOperation: input.programmeId ? "reference_existing" as const : "create" as const,
    occurrenceProposal: {
      operation,
      occurrenceKey: input.candidateOccurrence.occurrenceKey,
      targetOccurrenceKey: classification.targetOccurrenceKey,
      reason: classification.reason,
      candidate: structuredClone(input.candidateOccurrence),
    },
    projectLinkProposals,
    weeklyRecommendation,
    invariants: {
      databaseConnections: 0 as const,
      databaseWrites: 0 as const,
      projectDateMutations: 0 as const,
      projectDeletes: 0 as const,
      projectMerges: 0 as const,
      fullPotentialMonetaryMutations: 0 as const,
      durableActionsCreated: 0 as const,
      crmC4cMutations: 0 as const,
      providerCalls: 0 as const,
      pipelineInvocations: 0 as const,
    },
  };

  return {
    ...unsigned,
    manifestSha256: sha256(unsigned),
  };
}

export function verifyRecurringProjectPlanningManifest(
  manifest: RecurringProjectPlanningManifest,
): void {
  const { manifestSha256, ...unsigned } = manifest;
  if (!/^[a-f0-9]{64}$/.test(manifestSha256) || sha256(unsigned) !== manifestSha256) {
    throw new Error("Recurring project planning manifest SHA-256 mismatch");
  }
  if (manifest.mode !== "preview_only_no_writes") {
    throw new Error("Recurring project planning manifest is not preview-only");
  }
  if (Object.values(manifest.invariants).some(value => value !== 0)) {
    throw new Error("Recurring project planning manifest violates the no-side-effect boundary");
  }
  if (manifest.weeklyRecommendation?.durableActionCreated !== false) {
    throw new Error("Recurring project weekly recommendation created a durable action");
  }
  if (manifest.weeklyRecommendation?.fullPotentialMonetaryImpactAud !== 0) {
    throw new Error("Recurring project weekly recommendation altered Full Potential value");
  }
}
