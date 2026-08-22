import {
  boolean,
  date,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Durable recurring commercial activity. A programme is not a project and does
 * not carry separate Full Potential value; it groups preserved project cycles.
 */
export const recurringProjectProgrammes = mysqlTable(
  "recurringProjectProgrammes",
  {
    id: int("id").autoincrement().primaryKey(),
    programmeKey: varchar("programmeKey", { length: 512 }).notNull(),
    programmeName: varchar("programmeName", { length: 512 }).notNull(),
    recurrenceType: mysqlEnum("recurrenceType", [
      "annual",
      "quarterly",
      "monthly",
      "rolling",
      "irregular",
    ]).notNull(),
    status: mysqlEnum("status", [
      "under_review",
      "active",
      "inactive",
      "archived",
    ]).notNull().default("under_review"),

    buyerName: varchar("buyerName", { length: 512 }),
    siteName: varchar("siteName", { length: 512 }),
    state: varchar("state", { length: 64 }),
    region: varchar("region", { length: 128 }),
    fullPotentialAccountId: int("fullPotentialAccountId"),
    routeToMarket: varchar("routeToMarket", { length: 128 }),
    ownerUserId: int("ownerUserId"),
    ownerName: varchar("ownerName", { length: 256 }),

    usualLeadTimeDays: int("usualLeadTimeDays").notNull().default(90),
    productFamilies: json("productFamilies").$type<string[]>(),
    applicationTags: json("applicationTags").$type<string[]>(),
    nextExpectedWindowStart: date("nextExpectedWindowStart", { mode: "string" }),
    nextExpectedWindowEnd: date("nextExpectedWindowEnd", { mode: "string" }),

    sourceName: varchar("sourceName", { length: 256 }),
    sourceUrl: varchar("sourceUrl", { length: 1024 }),
    sourceObservedAt: timestamp("sourceObservedAt"),
    confidenceLevel: mysqlEnum("confidenceLevel", [
      "high",
      "medium",
      "low",
      "unknown",
    ]).notNull().default("unknown"),

    createdBy: int("createdBy"),
    createdByName: varchar("createdByName", { length: 256 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    programmeKeyUnique: uniqueIndex("recurringProgramme_key_uq").on(table.programmeKey),
    programmeAccountIndex: index("recurringProgramme_account_idx").on(table.fullPotentialAccountId),
    programmeNextWindowIndex: index("recurringProgramme_nextWindow_idx").on(table.nextExpectedWindowStart),
    programmeOwnerIndex: index("recurringProgramme_owner_idx").on(table.ownerUserId),
  }),
);

export type RecurringProjectProgramme = typeof recurringProjectProgrammes.$inferSelect;
export type InsertRecurringProjectProgramme = typeof recurringProjectProgrammes.$inferInsert;

/**
 * One specific year, quarter, tender, shutdown, drilling phase or work package.
 * Prior occurrences are retained; creating the next cycle never advances dates
 * on the prior record.
 */
export const recurringProjectOccurrences = mysqlTable(
  "recurringProjectOccurrences",
  {
    id: int("id").autoincrement().primaryKey(),
    programmeId: int("programmeId").notNull(),
    occurrenceKey: varchar("occurrenceKey", { length: 512 }).notNull(),
    cycleLabel: varchar("cycleLabel", { length: 128 }).notNull(),
    packageKey: varchar("packageKey", { length: 128 }).notNull().default("primary"),
    priorOccurrenceId: int("priorOccurrenceId"),
    canonicalProjectId: int("canonicalProjectId"),

    status: mysqlEnum("status", [
      "anticipated",
      "planning",
      "confirmed",
      "in_progress",
      "completed",
      "cancelled",
      "superseded",
    ]).notNull().default("anticipated"),
    anticipatedStartDate: date("anticipatedStartDate", { mode: "string" }).notNull(),
    anticipatedEndDate: date("anticipatedEndDate", { mode: "string" }).notNull(),
    confirmedStartDate: date("confirmedStartDate", { mode: "string" }),
    confirmedEndDate: date("confirmedEndDate", { mode: "string" }),

    scopeFingerprint: varchar("scopeFingerprint", { length: 128 }).notNull(),
    sourceFingerprint: varchar("sourceFingerprint", { length: 128 }).notNull(),
    changesFromPrior: text("changesFromPrior"),
    sourceEvidence: json("sourceEvidence").$type<Array<{
      sourceName?: string | null;
      sourceUrl?: string | null;
      observedAt?: string | null;
      summary?: string | null;
    }>>(),

    createdBy: int("createdBy"),
    createdByName: varchar("createdByName", { length: 256 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    occurrenceKeyUnique: uniqueIndex("recurringOccurrence_key_uq").on(table.occurrenceKey),
    occurrenceProgrammeIndex: index("recurringOccurrence_programme_idx").on(table.programmeId),
    occurrenceWindowIndex: index("recurringOccurrence_window_idx").on(table.anticipatedStartDate),
    occurrenceProjectIndex: index("recurringOccurrence_canonicalProject_idx").on(table.canonicalProjectId),
  }),
);

export type RecurringProjectOccurrence = typeof recurringProjectOccurrences.$inferSelect;
export type InsertRecurringProjectOccurrence = typeof recurringProjectOccurrences.$inferInsert;

/**
 * Links preserved project rows to one occurrence. Several historical duplicate
 * project records may support one occurrence, but one project cannot belong to
 * several recurring occurrences.
 */
export const recurringProjectOccurrenceProjects = mysqlTable(
  "recurringProjectOccurrenceProjects",
  {
    id: int("id").autoincrement().primaryKey(),
    occurrenceId: int("occurrenceId").notNull(),
    projectId: int("projectId").notNull(),
    relationshipType: mysqlEnum("relationshipType", [
      "canonical",
      "supporting_source",
      "historic_duplicate",
      "related_package",
    ]).notNull().default("supporting_source"),
    linkedBy: int("linkedBy"),
    linkedByName: varchar("linkedByName", { length: 256 }),
    linkReason: text("linkReason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    projectUnique: uniqueIndex("recurringOccurrenceProject_project_uq").on(table.projectId),
    occurrenceProjectUnique: uniqueIndex("recurringOccurrenceProject_pair_uq").on(
      table.occurrenceId,
      table.projectId,
    ),
    occurrenceIndex: index("recurringOccurrenceProject_occurrence_idx").on(table.occurrenceId),
  }),
);

export type RecurringProjectOccurrenceProject = typeof recurringProjectOccurrenceProjects.$inferSelect;
export type InsertRecurringProjectOccurrenceProject = typeof recurringProjectOccurrenceProjects.$inferInsert;

/**
 * User decision on a weekly recurring-project suggestion. The suggestion itself
 * is not a durable sales action; only an explicit accepted decision may point to
 * a later project or Full Potential action.
 */
export const recurringProjectRecommendationDecisions = mysqlTable(
  "recurringProjectRecommendationDecisions",
  {
    id: int("id").autoincrement().primaryKey(),
    recommendationKey: varchar("recommendationKey", { length: 256 }).notNull(),
    programmeId: int("programmeId").notNull(),
    occurrenceId: int("occurrenceId").notNull(),
    accountId: int("accountId"),
    projectId: int("projectId"),
    signalId: int("signalId"),
    userId: int("userId").notNull(),
    decision: mysqlEnum("decision", [
      "accepted",
      "deferred",
      "not_relevant",
      "dismissed",
    ]).notNull(),
    decisionNote: text("decisionNote"),
    deferredUntil: date("deferredUntil", { mode: "string" }),
    createdProjectActionId: int("createdProjectActionId"),
    createdFullPotentialActionId: int("createdFullPotentialActionId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    recommendationUserUnique: uniqueIndex("recurringRecommendation_user_uq").on(
      table.recommendationKey,
      table.userId,
    ),
    occurrenceDecisionIndex: index("recurringRecommendation_occurrence_idx").on(table.occurrenceId),
  }),
);

export type RecurringProjectRecommendationDecision = typeof recurringProjectRecommendationDecisions.$inferSelect;
export type InsertRecurringProjectRecommendationDecision = typeof recurringProjectRecommendationDecisions.$inferInsert;

/** Immutable audit ledger for reviewed programme/occurrence corrections. */
export const recurringProjectAuditEvents = mysqlTable(
  "recurringProjectAuditEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    programmeId: int("programmeId"),
    occurrenceId: int("occurrenceId"),
    projectId: int("projectId"),
    eventType: mysqlEnum("eventType", [
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
    ]).notNull(),
    actorUserId: int("actorUserId"),
    actorName: varchar("actorName", { length: 256 }),
    reason: text("reason").notNull(),
    beforeState: json("beforeState").$type<Record<string, unknown> | null>(),
    afterState: json("afterState").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    programmeAuditIndex: index("recurringAudit_programme_idx").on(table.programmeId),
    occurrenceAuditIndex: index("recurringAudit_occurrence_idx").on(table.occurrenceId),
    projectAuditIndex: index("recurringAudit_project_idx").on(table.projectId),
  }),
);

export type RecurringProjectAuditEvent = typeof recurringProjectAuditEvents.$inferSelect;
export type InsertRecurringProjectAuditEvent = typeof recurringProjectAuditEvents.$inferInsert;

/**
 * First source release: migration and data writes remain separately gated.
 * This flag is consumed only by tests/documentation and must not enable runtime
 * mutation by itself.
 */
export const RECURRING_PROJECT_SCHEMA_VERSION = 1 as const;
export const RECURRING_PROJECT_RUNTIME_WRITES_ENABLED = false as const;
