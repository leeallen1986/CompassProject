export const RECURRING_PROJECT_SCHEMA_CONTRACT_VERSION = 1 as const;
export const RECURRING_PROJECT_RUNTIME_WRITES_ENABLED = false as const;
export const RECURRING_PROJECT_MIGRATION_INCLUDED = false as const;

export type RecurringSchemaColumnType =
  | "int"
  | "varchar"
  | "text"
  | "date"
  | "timestamp"
  | "json"
  | "enum";

export interface RecurringSchemaColumnContract {
  name: string;
  type: RecurringSchemaColumnType;
  required: boolean;
  values?: readonly string[];
  defaultValue?: string | number | boolean | null;
  description: string;
}

export interface RecurringSchemaUniqueContract {
  name: string;
  columns: readonly string[];
  reason: string;
}

export interface RecurringSchemaTableContract {
  name: string;
  purpose: string;
  columns: readonly RecurringSchemaColumnContract[];
  uniqueConstraints: readonly RecurringSchemaUniqueContract[];
  indexes: readonly (readonly string[])[];
}

const programmeColumns: readonly RecurringSchemaColumnContract[] = [
  { name: "id", type: "int", required: true, description: "Surrogate primary key." },
  { name: "programmeKey", type: "varchar", required: true, description: "Stable recurring programme identity." },
  { name: "programmeName", type: "varchar", required: true, description: "Human-readable programme label." },
  {
    name: "recurrenceType",
    type: "enum",
    required: true,
    values: ["annual", "quarterly", "monthly", "rolling", "irregular"],
    description: "Reviewed recurrence cadence; rolling and irregular require explicit windows.",
  },
  {
    name: "status",
    type: "enum",
    required: true,
    values: ["under_review", "active", "inactive", "archived"],
    defaultValue: "under_review",
    description: "Programme governance state.",
  },
  { name: "buyerName", type: "varchar", required: false, description: "Public or governed buyer label." },
  { name: "siteName", type: "varchar", required: false, description: "Site or programme location label." },
  { name: "state", type: "varchar", required: false, description: "State/territory context." },
  { name: "region", type: "varchar", required: false, description: "Commercial region context." },
  { name: "fullPotentialAccountId", type: "int", required: false, description: "Optional governed Full Potential account reference." },
  { name: "routeToMarket", type: "varchar", required: false, description: "Resolved commercial route." },
  { name: "ownerUserId", type: "int", required: false, description: "Optional platform user owner." },
  { name: "ownerName", type: "varchar", required: false, description: "Auditable owner label." },
  { name: "usualLeadTimeDays", type: "int", required: true, defaultValue: 90, description: "Commercial planning lead time." },
  { name: "productFamilies", type: "json", required: false, description: "Relevant product families; analytical only." },
  { name: "applicationTags", type: "json", required: false, description: "Recurring applications; non-counting overlays." },
  { name: "nextExpectedWindowStart", type: "date", required: false, description: "Reviewed next expected window start." },
  { name: "nextExpectedWindowEnd", type: "date", required: false, description: "Reviewed next expected window end." },
  { name: "sourceName", type: "varchar", required: false, description: "Evidence source label." },
  { name: "sourceUrl", type: "varchar", required: false, description: "Evidence source URL." },
  { name: "sourceObservedAt", type: "timestamp", required: false, description: "Evidence observation time." },
  {
    name: "confidenceLevel",
    type: "enum",
    required: true,
    values: ["high", "medium", "low", "unknown"],
    defaultValue: "unknown",
    description: "Confidence in recurring identity and cadence.",
  },
  { name: "createdBy", type: "int", required: false, description: "Creating user ID." },
  { name: "createdByName", type: "varchar", required: false, description: "Creating user label." },
  { name: "createdAt", type: "timestamp", required: true, description: "Creation timestamp." },
  { name: "updatedAt", type: "timestamp", required: true, description: "Last audited update timestamp." },
];

const occurrenceColumns: readonly RecurringSchemaColumnContract[] = [
  { name: "id", type: "int", required: true, description: "Surrogate primary key." },
  { name: "programmeId", type: "int", required: true, description: "Parent programme reference." },
  { name: "occurrenceKey", type: "varchar", required: true, description: "Stable programme-cycle-package identity." },
  { name: "cycleLabel", type: "varchar", required: true, description: "Year, quarter, month or reviewed explicit cycle." },
  { name: "packageKey", type: "varchar", required: true, defaultValue: "primary", description: "Distinguishes materially different packages in one cycle." },
  { name: "priorOccurrenceId", type: "int", required: false, description: "Prior preserved cycle reference." },
  { name: "canonicalProjectId", type: "int", required: false, description: "Canonical project row for this occurrence." },
  {
    name: "status",
    type: "enum",
    required: true,
    values: ["anticipated", "planning", "confirmed", "in_progress", "completed", "cancelled", "superseded"],
    defaultValue: "anticipated",
    description: "Occurrence lifecycle state.",
  },
  { name: "anticipatedStartDate", type: "date", required: true, description: "Anticipated cycle start." },
  { name: "anticipatedEndDate", type: "date", required: true, description: "Anticipated cycle end." },
  { name: "confirmedStartDate", type: "date", required: false, description: "Confirmed cycle start." },
  { name: "confirmedEndDate", type: "date", required: false, description: "Confirmed cycle end." },
  { name: "scopeFingerprint", type: "varchar", required: true, description: "Material-scope change detector." },
  { name: "sourceFingerprint", type: "varchar", required: true, description: "Source-repeat change detector." },
  { name: "changesFromPrior", type: "text", required: false, description: "Material changes from the prior occurrence." },
  { name: "sourceEvidence", type: "json", required: false, description: "Bounded public/project evidence ledger." },
  { name: "createdBy", type: "int", required: false, description: "Creating user ID." },
  { name: "createdByName", type: "varchar", required: false, description: "Creating user label." },
  { name: "createdAt", type: "timestamp", required: true, description: "Creation timestamp." },
  { name: "updatedAt", type: "timestamp", required: true, description: "Last audited update timestamp." },
];

export const RECURRING_PROJECT_SCHEMA_CONTRACT = {
  version: RECURRING_PROJECT_SCHEMA_CONTRACT_VERSION,
  migrationIncluded: RECURRING_PROJECT_MIGRATION_INCLUDED,
  runtimeWritesEnabled: RECURRING_PROJECT_RUNTIME_WRITES_ENABLED,
  tables: {
    programmes: {
      name: "recurringProjectProgrammes",
      purpose: "Durable recurring commercial identity; non-monetary by itself.",
      columns: programmeColumns,
      uniqueConstraints: [
        {
          name: "recurringProgramme_key_uq",
          columns: ["programmeKey"],
          reason: "One durable record per recurring programme identity.",
        },
      ],
      indexes: [["fullPotentialAccountId"], ["nextExpectedWindowStart"], ["ownerUserId"]],
    },
    occurrences: {
      name: "recurringProjectOccurrences",
      purpose: "One preserved cycle, tender, shutdown, phase or package.",
      columns: occurrenceColumns,
      uniqueConstraints: [
        {
          name: "recurringOccurrence_key_uq",
          columns: ["occurrenceKey"],
          reason: "Same programme-cycle-package updates instead of duplicating.",
        },
      ],
      indexes: [["programmeId"], ["anticipatedStartDate"], ["canonicalProjectId"]],
    },
    occurrenceProjects: {
      name: "recurringProjectOccurrenceProjects",
      purpose: "Preserved project links with one recurring occurrence per project.",
      columns: [
        { name: "id", type: "int", required: true, description: "Surrogate primary key." },
        { name: "occurrenceId", type: "int", required: true, description: "Occurrence reference." },
        { name: "projectId", type: "int", required: true, description: "Existing preserved project row." },
        {
          name: "relationshipType",
          type: "enum",
          required: true,
          values: ["canonical", "supporting_source", "historic_duplicate", "related_package"],
          defaultValue: "supporting_source",
          description: "Project role inside the occurrence.",
        },
        { name: "linkedBy", type: "int", required: false, description: "Linking user ID." },
        { name: "linkedByName", type: "varchar", required: false, description: "Linking user label." },
        { name: "linkReason", type: "text", required: false, description: "Audited link rationale." },
        { name: "createdAt", type: "timestamp", required: true, description: "Creation timestamp." },
      ],
      uniqueConstraints: [
        {
          name: "recurringOccurrenceProject_project_uq",
          columns: ["projectId"],
          reason: "A project can belong to exactly one recurring occurrence.",
        },
        {
          name: "recurringOccurrenceProject_pair_uq",
          columns: ["occurrenceId", "projectId"],
          reason: "No duplicate project link inside one occurrence.",
        },
      ],
      indexes: [["occurrenceId"]],
    },
    recommendationDecisions: {
      name: "recurringProjectRecommendationDecisions",
      purpose: "Accept/defer/not-relevant decisions; recommendation alone creates no action.",
      columns: [
        { name: "id", type: "int", required: true, description: "Surrogate primary key." },
        { name: "recommendationKey", type: "varchar", required: true, description: "Stable projected recommendation key." },
        { name: "programmeId", type: "int", required: true, description: "Programme reference." },
        { name: "occurrenceId", type: "int", required: true, description: "Occurrence reference." },
        { name: "accountId", type: "int", required: false, description: "Optional Full Potential account reference." },
        { name: "projectId", type: "int", required: false, description: "Optional project reference." },
        { name: "signalId", type: "int", required: false, description: "Optional market-signal reference." },
        { name: "userId", type: "int", required: true, description: "User receiving the recommendation." },
        {
          name: "decision",
          type: "enum",
          required: true,
          values: ["accepted", "deferred", "not_relevant", "dismissed"],
          description: "Explicit user decision.",
        },
        { name: "decisionNote", type: "text", required: false, description: "Optional decision rationale." },
        { name: "deferredUntil", type: "date", required: false, description: "Re-presentation date." },
        { name: "createdProjectActionId", type: "int", required: false, description: "Action created only after acceptance." },
        { name: "createdFullPotentialActionId", type: "int", required: false, description: "Full Potential action created only after acceptance." },
        { name: "createdAt", type: "timestamp", required: true, description: "Creation timestamp." },
        { name: "updatedAt", type: "timestamp", required: true, description: "Last audited update timestamp." },
      ],
      uniqueConstraints: [
        {
          name: "recurringRecommendation_user_uq",
          columns: ["recommendationKey", "userId"],
          reason: "One current decision per user and projected recommendation.",
        },
      ],
      indexes: [["occurrenceId"]],
    },
    auditEvents: {
      name: "recurringProjectAuditEvents",
      purpose: "Immutable programme, occurrence, link and recommendation-decision audit trail.",
      columns: [
        { name: "id", type: "int", required: true, description: "Surrogate primary key." },
        { name: "programmeId", type: "int", required: false, description: "Programme reference." },
        { name: "occurrenceId", type: "int", required: false, description: "Occurrence reference." },
        { name: "projectId", type: "int", required: false, description: "Project reference." },
        {
          name: "eventType",
          type: "enum",
          required: true,
          values: [
            "programme_created",
            "programme_updated",
            "occurrence_created",
            "occurrence_updated",
            "project_linked",
            "project_unlinked",
            "recurrence_rejected",
            "next_occurrence_planned",
            "recommendation_decided",
            "correction",
          ],
          description: "Audited event type.",
        },
        { name: "actorUserId", type: "int", required: false, description: "Actor user ID." },
        { name: "actorName", type: "varchar", required: false, description: "Actor label." },
        { name: "reason", type: "text", required: true, description: "Required audit rationale." },
        { name: "beforeState", type: "json", required: false, description: "Bounded prior state." },
        { name: "afterState", type: "json", required: false, description: "Bounded resulting state." },
        { name: "createdAt", type: "timestamp", required: true, description: "Immutable event timestamp." },
      ],
      uniqueConstraints: [],
      indexes: [["programmeId"], ["occurrenceId"], ["projectId"]],
    },
  } satisfies Record<string, RecurringSchemaTableContract>,
} as const;

export function assertRecurringProjectSchemaContract(): void {
  if (RECURRING_PROJECT_SCHEMA_CONTRACT.migrationIncluded) {
    throw new Error("First recurring-project source release must not include a migration");
  }
  if (RECURRING_PROJECT_SCHEMA_CONTRACT.runtimeWritesEnabled) {
    throw new Error("First recurring-project source release must not enable runtime writes");
  }
  const tableNames = new Set<string>();
  for (const table of Object.values(RECURRING_PROJECT_SCHEMA_CONTRACT.tables)) {
    if (tableNames.has(table.name)) throw new Error(`Duplicate recurring schema table ${table.name}`);
    tableNames.add(table.name);
    const columnNames = new Set(table.columns.map(column => column.name));
    if (!columnNames.has("id")) throw new Error(`${table.name} is missing id`);
    for (const unique of table.uniqueConstraints) {
      if (unique.columns.length === 0) throw new Error(`${unique.name} has no columns`);
      for (const column of unique.columns) {
        if (!columnNames.has(column)) throw new Error(`${unique.name} references missing column ${column}`);
      }
    }
    for (const indexColumns of table.indexes) {
      for (const column of indexColumns) {
        if (!columnNames.has(column)) throw new Error(`${table.name} index references missing column ${column}`);
      }
    }
  }
}
