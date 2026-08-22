import {
  RECURRING_CANDIDATE_CLASSIFICATIONS,
  RECURRING_PROJECT_DISCOVERY_VERSION,
  type RecurringCandidateClassification,
  type RecurringCandidateConfidence,
  type RecurringCandidateGroup,
  type RecurringCandidateProject,
  type RecurringDiscoveryConfiguration,
  type RecurringDiscoveryReviewPackage,
  type RecurringProjectSnapshotDocument,
  type RecurringProjectSnapshotRow,
} from "@shared/recurringProjectDiscoveryContract";
import { canonicalSha256 } from "./recurringProjectSnapshotSafety";

export const DEFAULT_RECURRING_DISCOVERY_CONFIGURATION = Object.freeze({
  minimumGroupSize: 2,
  minimumDistinctCycles: 2,
  maximumProjectsPerGroup: 25,
}) satisfies RecurringDiscoveryConfiguration;

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

const GENERIC_IDENTITY_VALUES = new Set([
  "",
  "unknown",
  "tbc",
  "tbd",
  "various",
  "multiple",
  "australia",
  "national",
]);

const RECURRENCE_SIGNAL_PATTERNS: readonly [string, RegExp][] = [
  ["explicit_annual", /\b(?:annual|annually|yearly|biennial)\b/i],
  ["explicit_quarterly", /\bquarterly\b/i],
  ["explicit_monthly", /\bmonthly\b/i],
  ["explicit_recurring", /\b(?:recurring|recurrent|cycle|cyclical)\b/i],
  ["shutdown_turnaround", /\b(?:shutdown|turnaround|outage)\b/i],
  ["maintenance_overhaul", /\b(?:maintenance|overhaul|inspection)\b/i],
  ["tender_renewal", /\b(?:tender|retender|renewal|rebid|re-bid)\b/i],
  ["drilling_campaign", /\bdrill(?:ing)?\s+campaign\b/i],
  ["framework_contract", /\b(?:framework|panel|term contract)\b/i],
];

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function normaliseRecurringDiscoveryText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function identityKey(value: unknown): string {
  return normaliseRecurringDiscoveryText(value).replace(/\s+/g, "-");
}

function combinedProjectText(project: RecurringProjectSnapshotRow): string {
  return [
    project.name,
    project.timeline,
    project.completion,
    project.tenderNumber,
    ...project.sources.flatMap(source => [source.label, source.date]),
  ]
    .filter(Boolean)
    .join(" ");
}

function deriveRecurrenceEvidence(project: RecurringProjectSnapshotRow): string[] {
  const text = combinedProjectText(project);
  return RECURRENCE_SIGNAL_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
    ([code]) => code,
  );
}

function deriveQuarterCycles(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(/\b(20\d{2})\s*[-/]?\s*q([1-4])\b/gi)) {
    values.push(`${match[1]}-Q${match[2]}`);
  }
  for (const match of text.matchAll(/\bq([1-4])\s*[-/]?\s*(20\d{2})\b/gi)) {
    values.push(`${match[2]}-Q${match[1]}`);
  }
  return uniqueSorted(values);
}

function deriveMonthCycles(text: string): string[] {
  const values: string[] = [];
  const monthNames = Object.keys(MONTHS).join("|");
  const monthFirst = new RegExp(`\\b(${monthNames})\\s+(20\\d{2})\\b`, "gi");
  const yearFirst = new RegExp(`\\b(20\\d{2})\\s+(${monthNames})\\b`, "gi");
  for (const match of text.matchAll(monthFirst)) {
    values.push(`${match[2]}-${MONTHS[match[1].toLowerCase()]}`);
  }
  for (const match of text.matchAll(yearFirst)) {
    values.push(`${match[1]}-${MONTHS[match[2].toLowerCase()]}`);
  }
  return uniqueSorted(values);
}

function deriveYearCycles(text: string): string[] {
  return uniqueSorted([...text.matchAll(/\b(20\d{2})\b/g)].map(match => match[1]));
}

export function deriveRecurringCycleLabel(
  project: RecurringProjectSnapshotRow,
): { cycleLabel: string | null; evidenceCodes: string[] } {
  const text = combinedProjectText(project);
  const quarterCycles = deriveQuarterCycles(text);
  if (quarterCycles.length === 1) {
    return { cycleLabel: quarterCycles[0], evidenceCodes: ["explicit_quarter_cycle"] };
  }
  if (quarterCycles.length > 1) {
    return { cycleLabel: null, evidenceCodes: ["ambiguous_quarter_cycles"] };
  }

  const monthCycles = deriveMonthCycles(text);
  if (monthCycles.length === 1) {
    return { cycleLabel: monthCycles[0], evidenceCodes: ["explicit_month_cycle"] };
  }
  if (monthCycles.length > 1) {
    return { cycleLabel: null, evidenceCodes: ["ambiguous_month_cycles"] };
  }

  const yearCycles = deriveYearCycles(text);
  if (yearCycles.length === 1) {
    return { cycleLabel: yearCycles[0], evidenceCodes: ["explicit_year_cycle"] };
  }
  if (yearCycles.length > 1) {
    return { cycleLabel: null, evidenceCodes: ["ambiguous_year_cycles"] };
  }

  if (project.tenderCloseDate) {
    const match = project.tenderCloseDate.match(/^(20\d{2})-/);
    if (match) {
      return {
        cycleLabel: match[1],
        evidenceCodes: ["tender_close_year_cycle"],
      };
    }
  }
  return { cycleLabel: null, evidenceCodes: ["cycle_not_observed"] };
}

function removeCycleTokens(value: string): string {
  const monthNames = Object.keys(MONTHS).join("|");
  return value
    .replace(new RegExp(`\\b(?:${monthNames})\\s+20\\d{2}\\b`, "gi"), " ")
    .replace(new RegExp(`\\b20\\d{2}\\s+(?:${monthNames})\\b`, "gi"), " ")
    .replace(/\b20\d{2}\s*[-/]?\s*q[1-4]\b/gi, " ")
    .replace(/\bq[1-4]\s*[-/]?\s*20\d{2}\b/gi, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b(?:annual|annually|yearly|quarterly|monthly|recurring|recurrent)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PACKAGE_PATTERNS: readonly [string, RegExp][] = [
  ["work-package", /\bwork\s+package\s+([a-z0-9-]+)\b/i],
  ["package", /\bpackage\s+([a-z0-9-]+)\b/i],
  ["phase", /\bphase\s+([a-z0-9-]+)\b/i],
  ["stage", /\bstage\s+([a-z0-9-]+)\b/i],
  ["lot", /\blot\s+([a-z0-9-]+)\b/i],
  ["train", /\btrain\s+([a-z0-9-]+)\b/i],
  ["area", /\barea\s+([a-z0-9-]+)\b/i],
];

export function deriveRecurringPackageKey(projectName: string): string {
  const normalised = removeCycleTokens(normaliseRecurringDiscoveryText(projectName));
  const parts: string[] = [];
  for (const [label, pattern] of PACKAGE_PATTERNS) {
    const match = normalised.match(pattern);
    if (match) parts.push(`${label}-${match[1]}`);
  }
  return uniqueSorted(parts).join("+") || "primary";
}

function removePackageTokens(value: string): string {
  let result = value;
  for (const [, pattern] of PACKAGE_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, "gi"), " ");
  }
  return result.replace(/\s+/g, " ").trim();
}

export function deriveRecurringProgrammeCore(projectName: string): string {
  const withoutCycles = removeCycleTokens(normaliseRecurringDiscoveryText(projectName));
  const withoutPackages = removePackageTokens(withoutCycles);
  return withoutPackages.replace(/\b(?:project|programme|program)\b$/i, "").trim();
}

function cleanProgrammeName(projectName: string): string {
  const withoutCycles = removeCycleTokens(projectName);
  const withoutPackages = removePackageTokens(withoutCycles);
  return withoutPackages.replace(/\s+/g, " ").replace(/[-–—,:]+$/g, "").trim();
}

function sourceFingerprint(project: RecurringProjectSnapshotRow): string {
  return canonicalSha256({
    projectKey: project.projectKey,
    tenderNumber: project.tenderNumber,
    sourcePurpose: project.sourcePurpose,
    sources: project.sources,
  });
}

function scopeFingerprint(input: {
  project: RecurringProjectSnapshotRow;
  ownerKey: string;
  locationKey: string;
  programmeCore: string;
  packageKey: string;
}): string {
  return canonicalSha256({
    ownerKey: input.ownerKey,
    locationKey: input.locationKey,
    programmeCore: input.programmeCore,
    packageKey: input.packageKey,
    sector: input.project.sector,
    productLane: input.project.productLane,
    sourcePurpose: input.project.sourcePurpose,
  });
}

interface EnrichedProject {
  source: RecurringProjectSnapshotRow;
  ownerKey: string;
  locationKey: string;
  programmeCore: string;
  packageKey: string;
  cycleLabel: string | null;
  scopeFingerprint: string;
  sourceFingerprint: string;
  evidenceCodes: string[];
  groupKey: string;
}

function enrichProject(project: RecurringProjectSnapshotRow): EnrichedProject | null {
  const ownerKey = identityKey(project.owner);
  const locationKey = identityKey(project.projectState || project.location);
  const programmeCore = deriveRecurringProgrammeCore(project.name);
  if (!ownerKey || !locationKey || programmeCore.length < 4) return null;
  const packageKey = deriveRecurringPackageKey(project.name);
  const cycle = deriveRecurringCycleLabel(project);
  const recurrenceEvidence = deriveRecurrenceEvidence(project);
  const evidenceCodes = uniqueSorted([
    ...cycle.evidenceCodes,
    ...recurrenceEvidence,
    project.duplicateClusterId ? "existing_duplicate_cluster" : "",
    project.mergedIntoId ? "existing_merged_project" : "",
    project.duplicateDismissed ? "duplicate_previously_dismissed" : "",
  ].filter(Boolean));
  const groupIdentity = { ownerKey, locationKey, programmeCore };
  const groupKey = `recurring-group:${canonicalSha256(groupIdentity).slice(0, 24)}`;
  return {
    source: project,
    ownerKey,
    locationKey,
    programmeCore,
    packageKey,
    cycleLabel: cycle.cycleLabel,
    scopeFingerprint: scopeFingerprint({
      project,
      ownerKey,
      locationKey,
      programmeCore,
      packageKey,
    }),
    sourceFingerprint: sourceFingerprint(project),
    evidenceCodes,
    groupKey,
  };
}

function sharedDuplicateCluster(projects: EnrichedProject[]): boolean {
  const populated = projects
    .map(project => project.source.duplicateClusterId)
    .filter((value): value is string => Boolean(value));
  return populated.length >= 2 && new Set(populated).size === 1;
}

function exactNormalisedNameCount(projects: EnrichedProject[]): number {
  return new Set(projects.map(project => normaliseRecurringDiscoveryText(project.source.name))).size;
}

function classifyGroup(
  projects: EnrichedProject[],
  configuration: RecurringDiscoveryConfiguration,
): {
  classification: RecurringCandidateClassification;
  confidence: RecurringCandidateConfidence;
  evidenceCodes: string[];
  reasons: string[];
} {
  const cycleLabels = uniqueSorted(
    projects.map(project => project.cycleLabel).filter((value): value is string => Boolean(value)),
  );
  const packageKeys = uniqueSorted(projects.map(project => project.packageKey));
  const recurrenceEvidence = uniqueSorted(
    projects.flatMap(project =>
      project.evidenceCodes.filter(code =>
        RECURRENCE_SIGNAL_PATTERNS.some(([signalCode]) => signalCode === code),
      ),
    ),
  );
  const duplicateClusterShared = sharedDuplicateCluster(projects);
  const genericIdentity =
    GENERIC_IDENTITY_VALUES.has(projects[0].ownerKey) ||
    GENERIC_IDENTITY_VALUES.has(projects[0].locationKey);
  const evidenceCodes = uniqueSorted([
    ...projects.flatMap(project => project.evidenceCodes),
    cycleLabels.length >= configuration.minimumDistinctCycles
      ? "distinct_cycles_observed"
      : "",
    packageKeys.length > 1 ? "multiple_package_keys" : "",
    duplicateClusterShared ? "shared_duplicate_cluster" : "",
    genericIdentity ? "generic_owner_or_location" : "",
    projects.length > configuration.maximumProjectsPerGroup
      ? "group_exceeds_review_limit"
      : "",
  ].filter(Boolean));

  if (genericIdentity || projects.length > configuration.maximumProjectsPerGroup) {
    return {
      classification: "insufficient_evidence",
      confidence: "low",
      evidenceCodes,
      reasons: [
        genericIdentity
          ? "Owner or location identity is too generic for safe automatic grouping."
          : "The group is broader than the configured manual-review ceiling.",
      ],
    };
  }

  if (packageKeys.length > 1) {
    return {
      classification: "materially_different_package_review",
      confidence: cycleLabels.length > 0 ? "medium" : "low",
      evidenceCodes,
      reasons: [
        "The same proposed programme identity contains different phase, stage, lot, train, area or package keys.",
        "Do not overwrite or combine these records until the commercial package boundary is reviewed.",
      ],
    };
  }

  if (cycleLabels.length >= configuration.minimumDistinctCycles) {
    const highConfidence =
      cycleLabels.length >= 3 ||
      recurrenceEvidence.includes("explicit_annual") ||
      recurrenceEvidence.includes("explicit_quarterly") ||
      recurrenceEvidence.includes("explicit_monthly");
    return {
      classification: "likely_recurring_programme",
      confidence: highConfidence ? "high" : "medium",
      evidenceCodes,
      reasons: [
        `The same owner, location and programme core appear in ${cycleLabels.length} distinct explicit cycles.`,
        recurrenceEvidence.length > 0
          ? "Recurring/shutdown/tender/maintenance evidence reinforces the cycle pattern."
          : "The distinct cycles are sufficient for a recurrence review, but cadence still requires human confirmation.",
      ],
    };
  }

  if (cycleLabels.length === 1 || duplicateClusterShared) {
    return {
      classification: "same_cycle_duplicate_review",
      confidence:
        duplicateClusterShared || exactNormalisedNameCount(projects) === 1
          ? "high"
          : "medium",
      evidenceCodes,
      reasons: [
        cycleLabels.length === 1
          ? `Multiple records resolve to the same observed cycle ${cycleLabels[0]}.`
          : "The projects share one existing duplicate-cluster identity but do not expose a reliable cycle label.",
        "Treat them as possible supporting sources or historic duplicates, not as a new recurring occurrence.",
      ],
    };
  }

  return {
    classification: "insufficient_evidence",
    confidence: "low",
    evidenceCodes,
    reasons: [
      "At least two similar project records exist, but no distinct cycle or reliable same-cycle boundary is visible.",
      "Keep the group review-only and do not invent a recurrence cadence.",
    ],
  };
}

function assertConfiguration(
  input: RecurringDiscoveryConfiguration,
): RecurringDiscoveryConfiguration {
  if (
    !Number.isInteger(input.minimumGroupSize) ||
    input.minimumGroupSize < 2 ||
    input.minimumGroupSize > 10
  ) {
    throw new Error("RECURRING_DISCOVERY_MINIMUM_GROUP_SIZE_INVALID");
  }
  if (
    !Number.isInteger(input.minimumDistinctCycles) ||
    input.minimumDistinctCycles < 2 ||
    input.minimumDistinctCycles > 10
  ) {
    throw new Error("RECURRING_DISCOVERY_MINIMUM_CYCLES_INVALID");
  }
  if (
    !Number.isInteger(input.maximumProjectsPerGroup) ||
    input.maximumProjectsPerGroup < input.minimumGroupSize ||
    input.maximumProjectsPerGroup > 100
  ) {
    throw new Error("RECURRING_DISCOVERY_MAXIMUM_GROUP_INVALID");
  }
  return { ...input };
}

function candidateProject(project: EnrichedProject): RecurringCandidateProject {
  return {
    groupKey: project.groupKey,
    projectId: project.source.id,
    projectKey: project.source.projectKey,
    name: project.source.name,
    owner: project.source.owner,
    location: project.source.location,
    projectState: project.source.projectState,
    cycleLabel: project.cycleLabel,
    packageKey: project.packageKey,
    programmeCore: project.programmeCore,
    scopeFingerprint: project.scopeFingerprint,
    sourceFingerprint: project.sourceFingerprint,
    evidenceCodes: project.evidenceCodes,
    duplicateClusterId: project.source.duplicateClusterId,
    mergedIntoId: project.source.mergedIntoId,
  };
}

function candidateGroup(
  projects: EnrichedProject[],
  configuration: RecurringDiscoveryConfiguration,
): RecurringCandidateGroup {
  const sorted = [...projects].sort((left, right) => left.source.id - right.source.id);
  const classification = classifyGroup(sorted, configuration);
  const shortestName = [...sorted]
    .map(project => cleanProgrammeName(project.source.name) || project.source.name)
    .sort((left, right) => left.length - right.length || left.localeCompare(right))[0];
  const programmeIdentity = [
    sorted[0].ownerKey,
    sorted[0].locationKey,
    identityKey(sorted[0].programmeCore),
  ].filter(Boolean);
  return {
    groupKey: sorted[0].groupKey,
    classification: classification.classification,
    confidence: classification.confidence,
    programmeKeyProposal: `recurring:${programmeIdentity.join(":")}`.slice(0, 512),
    programmeNameProposal: shortestName,
    owner: sorted[0].source.owner,
    location: sorted[0].source.location,
    projectIds: sorted.map(project => project.source.id),
    cycleLabels: uniqueSorted(
      sorted.map(project => project.cycleLabel).filter((value): value is string => Boolean(value)),
    ),
    packageKeys: uniqueSorted(sorted.map(project => project.packageKey)),
    evidenceCodes: classification.evidenceCodes,
    reasons: classification.reasons,
    manualReviewRequired: true,
    countingTreatment: "application_overlay_non_counting",
    fullPotentialMonetaryImpactAud: 0,
  };
}

export function buildRecurringDiscoveryReviewPackage(input: {
  snapshot: RecurringProjectSnapshotDocument;
  snapshotSha256: string;
  configuration?: Partial<RecurringDiscoveryConfiguration>;
}): RecurringDiscoveryReviewPackage {
  if (!/^[0-9a-f]{64}$/.test(input.snapshotSha256)) {
    throw new Error("RECURRING_DISCOVERY_SNAPSHOT_SHA_INVALID");
  }
  const configuration = assertConfiguration({
    ...DEFAULT_RECURRING_DISCOVERY_CONFIGURATION,
    ...input.configuration,
  });
  const enriched = input.snapshot.projects
    .map(enrichProject)
    .filter((project): project is EnrichedProject => project !== null);
  const grouped = new Map<string, EnrichedProject[]>();
  for (const project of enriched) {
    const current = grouped.get(project.groupKey) ?? [];
    current.push(project);
    grouped.set(project.groupKey, current);
  }

  const eligibleGroups = [...grouped.values()]
    .filter(projects => projects.length >= configuration.minimumGroupSize)
    .sort((left, right) => left[0].groupKey.localeCompare(right[0].groupKey));
  const groups = eligibleGroups
    .map(projects => candidateGroup(projects, configuration))
    .sort((left, right) => left.groupKey.localeCompare(right.groupKey));
  const projects = eligibleGroups
    .flatMap(group => group.map(candidateProject))
    .sort(
      (left, right) =>
        left.groupKey.localeCompare(right.groupKey) ||
        left.projectId - right.projectId,
    );

  const classifications = Object.fromEntries(
    RECURRING_CANDIDATE_CLASSIFICATIONS.map(classification => [
      classification,
      groups.filter(group => group.classification === classification).length,
    ]),
  ) as Record<RecurringCandidateClassification, number>;
  const groupsSha256 = canonicalSha256(groups);
  const projectsSha256 = canonicalSha256(projects);

  return {
    groups,
    projects,
    summary: {
      version: RECURRING_PROJECT_DISCOVERY_VERSION,
      mode: "review_only_no_writes",
      sourceSha: input.snapshot.sourceSha,
      snapshotRef: input.snapshot.snapshotRef,
      snapshotSha256: input.snapshotSha256,
      configuration,
      projectCount: input.snapshot.projects.length,
      candidateProjectCount: projects.length,
      candidateGroupCount: groups.length,
      classifications,
      candidateGroupsSha256: groupsSha256,
      candidateProjectsSha256: projectsSha256,
      manualReviewRequired: true,
      completeForBackfillApply: false,
      safety: {
        databaseConnections: 0,
        databaseWrites: 0,
        projectDateMutations: 0,
        projectMerges: 0,
        projectDeletions: 0,
        recurringProgrammesCreated: 0,
        recurringOccurrencesCreated: 0,
        recurringProjectLinksCreated: 0,
        projectActionsCreated: 0,
        fullPotentialActionsCreated: 0,
        fullPotentialMonetaryMutations: 0,
        crmC4cMutations: 0,
        providerCalls: 0,
        pipelineInvocations: 0,
        deployments: 0,
      },
    },
  };
}
