export const RECURRING_PROJECT_DISCOVERY_VERSION =
  "recurring-project-discovery-v1" as const;
export const RECURRING_PROJECT_SNAPSHOT_VERSION = 1 as const;

export const RECURRING_CANDIDATE_CLASSIFICATIONS = [
  "likely_recurring_programme",
  "same_cycle_duplicate_review",
  "materially_different_package_review",
  "insufficient_evidence",
] as const;

export type RecurringCandidateClassification =
  (typeof RECURRING_CANDIDATE_CLASSIFICATIONS)[number];

export type RecurringCandidateConfidence = "high" | "medium" | "low";

export interface RecurringSnapshotSource {
  label: string;
  url: string | null;
  date: string | null;
}

/**
 * Bounded, non-contact project projection used only for recurring-project review.
 * Contact, email, phone, CRM payload and outreach fields are deliberately absent.
 */
export interface RecurringProjectSnapshotRow {
  id: number;
  reportId: number;
  projectKey: string;
  name: string;
  location: string;
  owner: string;
  sector: string;
  stage: string | null;
  stageCode: string | null;
  lifecycleStatus: string;
  projectType: string | null;
  productLane: string | null;
  sourcePurpose: string | null;
  tenderNumber: string | null;
  tenderCloseDate: string | null;
  timeline: string | null;
  completion: string | null;
  sources: RecurringSnapshotSource[];
  duplicateClusterId: string | null;
  mergedIntoId: number | null;
  duplicateDismissed: boolean;
  suppressed: boolean;
  projectCountry: string | null;
  projectState: string | null;
  sourceLastSeenAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface RecurringProjectSnapshotDocument {
  version: typeof RECURRING_PROJECT_SNAPSHOT_VERSION;
  mode: "read_only_project_snapshot";
  sourceSha: string;
  snapshotRef: string;
  rowBounds: {
    fromProjectId: number;
    toProjectId: number;
    maximumRows: number;
  };
  projects: RecurringProjectSnapshotRow[];
}

export interface RecurringProjectSnapshotManifest {
  version: typeof RECURRING_PROJECT_SNAPSHOT_VERSION;
  mode: "read_only_project_snapshot_manifest";
  sourceSha: string;
  snapshotRef: string;
  generatedAt: string;
  queryManifestSha256: string;
  snapshotSha256: string;
  projectCount: number;
  minimumProjectId: number | null;
  maximumProjectId: number | null;
  database: {
    engineVersion: string;
    engineComment: string;
    currentUserSha256: string;
    targetIdentitySha256: string;
    grantProfileSha256: string;
    grantProfile: "select_only";
  };
  safety: {
    databaseWriteStatementsExecuted: 0;
    projectMutations: 0;
    projectMerges: 0;
    projectDeletions: 0;
    recurringProgrammesCreated: 0;
    recurringOccurrencesCreated: 0;
    projectActionsCreated: 0;
    fullPotentialActionsCreated: 0;
    fullPotentialMonetaryMutations: 0;
    crmC4cMutations: 0;
    providerCalls: 0;
    pipelineInvocations: 0;
  };
}

export interface RecurringCandidateProject {
  groupKey: string;
  projectId: number;
  projectKey: string;
  name: string;
  owner: string;
  location: string;
  projectState: string | null;
  cycleLabel: string | null;
  packageKey: string;
  programmeCore: string;
  scopeFingerprint: string;
  sourceFingerprint: string;
  evidenceCodes: string[];
  duplicateClusterId: string | null;
  mergedIntoId: number | null;
}

export interface RecurringCandidateGroup {
  groupKey: string;
  classification: RecurringCandidateClassification;
  confidence: RecurringCandidateConfidence;
  programmeKeyProposal: string;
  programmeNameProposal: string;
  owner: string;
  location: string;
  projectIds: number[];
  cycleLabels: string[];
  packageKeys: string[];
  evidenceCodes: string[];
  reasons: string[];
  manualReviewRequired: true;
  countingTreatment: "application_overlay_non_counting";
  fullPotentialMonetaryImpactAud: 0;
}

export interface RecurringDiscoveryConfiguration {
  minimumGroupSize: number;
  minimumDistinctCycles: number;
  maximumProjectsPerGroup: number;
}

export interface RecurringDiscoveryReviewSummary {
  version: typeof RECURRING_PROJECT_DISCOVERY_VERSION;
  mode: "review_only_no_writes";
  sourceSha: string;
  snapshotRef: string;
  snapshotSha256: string;
  configuration: RecurringDiscoveryConfiguration;
  projectCount: number;
  candidateProjectCount: number;
  candidateGroupCount: number;
  classifications: Record<RecurringCandidateClassification, number>;
  candidateGroupsSha256: string;
  candidateProjectsSha256: string;
  manualReviewRequired: true;
  completeForBackfillApply: false;
  safety: {
    databaseConnections: 0;
    databaseWrites: 0;
    projectDateMutations: 0;
    projectMerges: 0;
    projectDeletions: 0;
    recurringProgrammesCreated: 0;
    recurringOccurrencesCreated: 0;
    recurringProjectLinksCreated: 0;
    projectActionsCreated: 0;
    fullPotentialActionsCreated: 0;
    fullPotentialMonetaryMutations: 0;
    crmC4cMutations: 0;
    providerCalls: 0;
    pipelineInvocations: 0;
    deployments: 0;
  };
}

export interface RecurringDiscoveryReviewPackage {
  groups: RecurringCandidateGroup[];
  projects: RecurringCandidateProject[];
  summary: RecurringDiscoveryReviewSummary;
}
