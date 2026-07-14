import {
  boolean,
  decimal,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Full Potential account universe.
 *
 * This is the strategic account layer for APE Full Potential. It is intentionally
 * separate from accountPriors, which was created for an earlier WA Top 100 / account-prior use case.
 *
 * The table supports accounts, site-context records, channel-managed rows,
 * competitor-watch rows and cluster/signal rows from the quality-gated workbook.
 */
export const fullPotentialAccounts = mysqlTable("fullPotentialAccounts", {
  id: int("id").autoincrement().primaryKey(),

  // Stable import/update key generated from workbook canonicalization.
  // Recommended format: lower(canonicalName|rowClass|country|state|routeToMarket)
  stableKey: varchar("stableKey", { length: 512 }).notNull().unique(),

  // Identity
  canonicalName: varchar("canonicalName", { length: 512 }).notNull(),
  displayName: varchar("displayName", { length: 512 }),
  parentGroup: varchar("parentGroup", { length: 256 }),
  rowClass: mysqlEnum("rowClass", [
    "account",
    "site_context",
    "channel_managed",
    "competitor_watch",
    "cluster_signal",
  ]).notNull().default("account"),

  // Canonical relationship and counting controls.
  // These fields preserve branch/division/site context without double-counting
  // Full Potential or hard-deleting imported records.
  parentAccountId: int("parentAccountId"),
  mergedIntoAccountId: int("mergedIntoAccountId"),
  relationshipType: mysqlEnum("relationshipType", [
    "standalone",
    "parent",
    "division",
    "branch",
    "site",
    "service_unit",
    "strategic_context",
    "duplicate",
  ]).notNull().default("standalone"),
  recordStatus: mysqlEnum("recordStatus", [
    "active",
    "under_review",
    "merged",
    "parked",
    "excluded",
  ]).notNull().default("active"),
  countsTowardPotential: boolean("countsTowardPotential").notNull().default(true),

  // Geography and segmentation
  country: varchar("country", { length: 2 }).notNull().default("AU"),
  state: varchar("state", { length: 64 }),
  region: varchar("region", { length: 128 }),
  segment: varchar("segment", { length: 128 }),
  subsegment: varchar("subsegment", { length: 128 }),
  applicationPlays: json("applicationPlays").$type<string[]>(),

  // Route-to-market and ownership.
  // Keep route values role/channel based; individual rep assignment belongs in ownerName/userId.
  routeToMarket: mysqlEnum("routeToMarket", [
    "direct_ape",
    "cea",
    "cp_aps",
    "cp_blastone",
    "cp_pneumatic_engineering",
    "cp_more_air",
    "nz_distributor",
    "png_oceania",
    "hybrid_strategic",
    "product_support",
    "manual_review",
    "exclude",
  ]).notNull().default("manual_review"),
  ownerName: varchar("ownerName", { length: 256 }),
  channelOwner: varchar("channelOwner", { length: 256 }),

  // Full Potential operating status.
  // Channel ownership is expressed by rowClass + routeToMarket, not fpStatus.
  fpStatus: mysqlEnum("fpStatus", [
    "active_target",
    "develop",
    "watch",
    "qualify",
    "park",
    "exclude",
  ]).notNull().default("qualify"),
  priorityTier: mysqlEnum("priorityTier", [
    "tier_a",
    "tier_b",
    "tier_c",
    "tier_d",
    "unassigned",
  ]).notNull().default("unassigned"),
  platformPushDecision: mysqlEnum("platformPushDecision", [
    "push_now",
    "push_context",
    "channel_view",
    "qualify_first",
    "park_do_not_push",
  ]).notNull().default("qualify_first"),

  // Financials. Decimal values are stored as strings by drizzle/mysql2 unless parsed upstream.
  currentRevenueAud: decimal("currentRevenueAud", { precision: 15, scale: 2 }),
  fullPotentialAud: decimal("fullPotentialAud", { precision: 15, scale: 2 }),
  target2026Aud: decimal("target2026Aud", { precision: 15, scale: 2 }),
  remainingPotentialAud: decimal("remainingPotentialAud", { precision: 15, scale: 2 }),

  // Evidence and confidence
  evidenceSources: json("evidenceSources").$type<string[]>(),
  confidenceLevel: mysqlEnum("confidenceLevel", [
    "high",
    "medium",
    "low",
    "unknown",
  ]).notNull().default("unknown"),
  currentSupplier: varchar("currentSupplier", { length: 256 }),
  installedBaseStatus: mysqlEnum("installedBaseStatus", [
    "known",
    "partial",
    "unknown",
    "not_applicable",
  ]).notNull().default("unknown"),
  installedBaseNotes: text("installedBaseNotes"),

  // Downstream CRM state — Compass should not bulk-create C4C records before qualification.
  c4cStatus: mysqlEnum("c4cStatus", [
    "not_in_c4c",
    "lead",
    "prospect",
    "opportunity",
    "quote",
    "won",
    "lost",
    "unknown",
  ]).notNull().default("unknown"),

  // Operating action fields
  nextAction: varchar("nextAction", { length: 512 }),
  nextActionDate: timestamp("nextActionDate"),
  activeInMyWeek: boolean("activeInMyWeek").notNull().default(false),

  // Import traceability
  sourceWorkbookVersion: varchar("sourceWorkbookVersion", { length: 32 }),
  sourceSheet: varchar("sourceSheet", { length: 128 }),
  sourceRowNumber: int("sourceRowNumber"),
  rawSourceJson: json("rawSourceJson").$type<Record<string, unknown>>(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FullPotentialAccount = typeof fullPotentialAccounts.$inferSelect;
export type InsertFullPotentialAccount = typeof fullPotentialAccounts.$inferInsert;

/**
 * Aliases map workbook/C4C/project/scraper naming variants back to a canonical Full Potential account.
 */
export const fullPotentialAccountAliases = mysqlTable("fullPotentialAccountAliases", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  aliasName: varchar("aliasName", { length: 512 }).notNull(),
  aliasType: mysqlEnum("aliasType", [
    "legal_name",
    "trading_name",
    "abbreviation",
    "misspelling",
    "site_name",
    "crm_name",
    "project_owner",
    "contractor_name",
    "other",
  ]).notNull().default("other"),
  source: varchar("source", { length: 128 }),
  confidenceLevel: mysqlEnum("confidenceLevel", [
    "high",
    "medium",
    "low",
    "unknown",
  ]).notNull().default("unknown"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FullPotentialAccountAlias = typeof fullPotentialAccountAliases.$inferSelect;
export type InsertFullPotentialAccountAlias = typeof fullPotentialAccountAliases.$inferInsert;

/**
 * Market/project/customer signals that activate or support Full Potential account work.
 */
export const fullPotentialSignals = mysqlTable("fullPotentialSignals", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId"),
  projectId: int("projectId"),
  signalType: mysqlEnum("signalType", [
    "drilling_campaign",
    "awarded_project",
    "live_tender",
    "shutdown_turnaround",
    "pipeline_commissioning",
    "mine_site_activity",
    "civil_application",
    "rental_fleet_signal",
    "competitor_channel_signal",
    "installed_base_signal",
    "contact_discovery_signal",
    "manual",
    "other",
  ]).notNull().default("other"),
  signalTitle: varchar("signalTitle", { length: 512 }).notNull(),
  signalSummary: text("signalSummary"),
  sourceUrl: varchar("sourceUrl", { length: 1024 }),
  sourceName: varchar("sourceName", { length: 256 }),
  signalDate: timestamp("signalDate"),
  state: varchar("state", { length: 64 }),
  applicationPlay: varchar("applicationPlay", { length: 128 }),
  routeToMarket: varchar("routeToMarket", { length: 128 }),
  urgency: mysqlEnum("urgency", ["hot", "warm", "cold", "unknown"]).notNull().default("unknown"),
  confidenceLevel: mysqlEnum("confidenceLevel", [
    "high",
    "medium",
    "low",
    "unknown",
  ]).notNull().default("unknown"),
  suggestedAction: varchar("suggestedAction", { length: 512 }),
  status: mysqlEnum("status", [
    "new",
    "reviewed",
    "promoted",
    "dismissed",
    "archived",
  ]).notNull().default("new"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FullPotentialSignal = typeof fullPotentialSignals.$inferSelect;
export type InsertFullPotentialSignal = typeof fullPotentialSignals.$inferInsert;

/**
 * Account-level actions created from Full Potential records and activated signals.
 * These are separate from projectActions, which remain project-specific.
 */
export const fullPotentialActions = mysqlTable("fullPotentialActions", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  projectId: int("projectId"),
  signalId: int("signalId"),
  userId: int("userId"),
  ownerName: varchar("ownerName", { length: 256 }),
  actionType: mysqlEnum("actionType", [
    "account_review",
    "contact_discovery",
    "customer_call",
    "site_visit",
    "channel_handover",
    "installed_base_validation",
    "c4c_create_update",
    "proposal_followup",
    "manager_review",
    "other",
  ]).notNull().default("account_review"),
  recommendedAction: varchar("recommendedAction", { length: 512 }),
  dueDate: timestamp("dueDate"),
  status: mysqlEnum("status", [
    "not_started",
    "in_progress",
    "contacted",
    "meeting_booked",
    "quoted",
    "won",
    "lost",
    "deferred",
    "not_relevant",
    "completed",
  ]).notNull().default("not_started"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type FullPotentialAction = typeof fullPotentialActions.$inferSelect;
export type InsertFullPotentialAction = typeof fullPotentialActions.$inferInsert;

/**
 * Structured evidence register for Full Potential commercial modelling.
 * Evidence is retained independently from model versions so it can be reused,
 * verified, rejected or superseded without rewriting history.
 */
export const fullPotentialEvidence = mysqlTable("fullPotentialEvidence", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  productFamily: mysqlEnum("productFamily", [
    "portable_air_small_medium",
    "portable_air_large",
    "specialty_air_boosters",
    "e_air",
    "dryers",
    "nitrogen",
    "dewatering",
    "generators",
    "bess",
    "lighting",
    "other",
  ]),
  evidenceType: mysqlEnum("evidenceType", [
    "internal_order_history",
    "crm_history",
    "service_warranty",
    "fleetlink",
    "distributor_channel",
    "customer_discovery",
    "public_source",
    "tender_project",
    "financial_assumption",
    "other",
  ]).notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  summary: text("summary").notNull(),
  sourceName: varchar("sourceName", { length: 256 }),
  sourceUrl: varchar("sourceUrl", { length: 1024 }),
  sourceReference: varchar("sourceReference", { length: 512 }),
  observedAt: timestamp("observedAt"),
  capturedBy: int("capturedBy"),
  capturedByName: varchar("capturedByName", { length: 256 }),
  confidenceLevel: mysqlEnum("confidenceLevel", [
    "high",
    "medium",
    "low",
    "unknown",
  ]).notNull().default("unknown"),
  status: mysqlEnum("status", [
    "draft",
    "verified",
    "rejected",
    "superseded",
  ]).notNull().default("draft"),
  reviewNote: text("reviewNote"),
  reviewedBy: int("reviewedBy"),
  reviewedByName: varchar("reviewedByName", { length: 256 }),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FullPotentialEvidence = typeof fullPotentialEvidence.$inferSelect;
export type InsertFullPotentialEvidence = typeof fullPotentialEvidence.$inferInsert;

/**
 * Versioned account-level commercial model header.
 * The approved account potential is derived from approved line items; it is not
 * manually written directly into fullPotentialAccounts.
 */
export const fullPotentialModels = mysqlTable("fullPotentialModels", {
  id: int("id").autoincrement().primaryKey(),
  modelKey: varchar("modelKey", { length: 128 }).notNull().unique(),
  accountId: int("accountId").notNull(),
  versionNumber: int("versionNumber").notNull(),
  status: mysqlEnum("status", [
    "draft",
    "submitted",
    "returned",
    "approved",
    "superseded",
  ]).notNull().default("draft"),
  methodologyVersion: varchar("methodologyVersion", { length: 32 }).notNull().default("fp-v1"),
  currentRevenueAud: decimal("currentRevenueAud", { precision: 15, scale: 2 }),
  totalPotentialAud: decimal("totalPotentialAud", { precision: 15, scale: 2 }),
  remainingPotentialAud: decimal("remainingPotentialAud", { precision: 15, scale: 2 }),
  confidenceLevel: mysqlEnum("confidenceLevel", [
    "high",
    "medium",
    "low",
    "unknown",
  ]).notNull().default("unknown"),
  assumptionsSummary: text("assumptionsSummary"),
  createdBy: int("createdBy").notNull(),
  createdByName: varchar("createdByName", { length: 256 }),
  submittedBy: int("submittedBy"),
  submittedByName: varchar("submittedByName", { length: 256 }),
  submittedAt: timestamp("submittedAt"),
  reviewedBy: int("reviewedBy"),
  reviewedByName: varchar("reviewedByName", { length: 256 }),
  reviewedAt: timestamp("reviewedAt"),
  reviewNotes: text("reviewNotes"),
  approvedAt: timestamp("approvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FullPotentialModel = typeof fullPotentialModels.$inferSelect;
export type InsertFullPotentialModel = typeof fullPotentialModels.$inferInsert;

/**
 * Product-family and application-level model lines.
 * linePotentialAud is computed by the server from explicit fleet, replacement,
 * price, addressable-share and specialty assumptions.
 */
export const fullPotentialModelLines = mysqlTable("fullPotentialModelLines", {
  id: int("id").autoincrement().primaryKey(),
  lineKey: varchar("lineKey", { length: 512 }).notNull().unique(),
  modelId: int("modelId").notNull(),
  accountId: int("accountId").notNull(),
  productFamily: mysqlEnum("productFamily", [
    "portable_air_small_medium",
    "portable_air_large",
    "specialty_air_boosters",
    "e_air",
    "dryers",
    "nitrogen",
    "dewatering",
    "generators",
    "bess",
    "lighting",
    "other",
  ]).notNull(),
  application: varchar("application", { length: 256 }).notNull(),
  routeToMarket: mysqlEnum("routeToMarket", [
    "direct_ape",
    "cea",
    "cp_aps",
    "cp_blastone",
    "cp_pneumatic_engineering",
    "cp_more_air",
    "nz_distributor",
    "png_oceania",
    "hybrid_strategic",
    "product_support",
    "manual_review",
    "exclude",
  ]).notNull(),
  currentSupplier: varchar("currentSupplier", { length: 256 }),
  currentRevenueAud: decimal("currentRevenueAud", { precision: 15, scale: 2 }),
  knownAtlasFleetUnits: int("knownAtlasFleetUnits"),
  estimatedTotalFleetUnits: int("estimatedTotalFleetUnits"),
  replacementCycleYears: decimal("replacementCycleYears", { precision: 6, scale: 2 }),
  annualReplacementUnits: decimal("annualReplacementUnits", { precision: 10, scale: 2 }),
  averageSellingPriceAud: decimal("averageSellingPriceAud", { precision: 15, scale: 2 }),
  addressableSharePct: decimal("addressableSharePct", { precision: 5, scale: 2 }),
  equipmentPotentialAud: decimal("equipmentPotentialAud", { precision: 15, scale: 2 }),
  specialtyPotentialAud: decimal("specialtyPotentialAud", { precision: 15, scale: 2 }),
  linePotentialAud: decimal("linePotentialAud", { precision: 15, scale: 2 }).notNull().default("0"),
  replacementCycleSource: varchar("replacementCycleSource", { length: 512 }),
  assumptions: json("assumptions").$type<Record<string, unknown>>(),
  confidenceLevel: mysqlEnum("confidenceLevel", [
    "high",
    "medium",
    "low",
    "unknown",
  ]).notNull().default("unknown"),
  createdBy: int("createdBy").notNull(),
  updatedBy: int("updatedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FullPotentialModelLine = typeof fullPotentialModelLines.$inferSelect;
export type InsertFullPotentialModelLine = typeof fullPotentialModelLines.$inferInsert;

/** Evidence-to-model and evidence-to-line linkage for traceable calculations. */
export const fullPotentialModelEvidenceLinks = mysqlTable("fullPotentialModelEvidenceLinks", {
  id: int("id").autoincrement().primaryKey(),
  linkKey: varchar("linkKey", { length: 128 }).notNull().unique(),
  modelId: int("modelId").notNull(),
  modelLineId: int("modelLineId"),
  evidenceId: int("evidenceId").notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FullPotentialModelEvidenceLink = typeof fullPotentialModelEvidenceLinks.$inferSelect;
export type InsertFullPotentialModelEvidenceLink = typeof fullPotentialModelEvidenceLinks.$inferInsert;

/** Immutable workflow history for model submit/return/approve actions. */
export const fullPotentialModelReviews = mysqlTable("fullPotentialModelReviews", {
  id: int("id").autoincrement().primaryKey(),
  modelId: int("modelId").notNull(),
  accountId: int("accountId").notNull(),
  action: mysqlEnum("action", [
    "created",
    "submitted",
    "returned",
    "approved",
    "reopened",
    "superseded",
  ]).notNull(),
  fromStatus: varchar("fromStatus", { length: 32 }),
  toStatus: varchar("toStatus", { length: 32 }).notNull(),
  userId: int("userId").notNull(),
  userName: varchar("userName", { length: 256 }),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FullPotentialModelReview = typeof fullPotentialModelReviews.$inferSelect;
export type InsertFullPotentialModelReview = typeof fullPotentialModelReviews.$inferInsert;

/**
 * Import audit log for workbook/platform import runs.
 */
export const fullPotentialImports = mysqlTable("fullPotentialImports", {
  id: int("id").autoincrement().primaryKey(),
  workbookVersion: varchar("workbookVersion", { length: 32 }).notNull(),
  sourceFileName: varchar("sourceFileName", { length: 512 }),
  importedBy: int("importedBy"),
  importedByName: varchar("importedByName", { length: 256 }),
  rowCount: int("rowCount").notNull().default(0),
  createdCount: int("createdCount").notNull().default(0),
  updatedCount: int("updatedCount").notNull().default(0),
  skippedCount: int("skippedCount").notNull().default(0),
  errorCount: int("errorCount").notNull().default(0),
  importSummary: json("importSummary").$type<Record<string, unknown>>(),
  importedAt: timestamp("importedAt").defaultNow().notNull(),
});

export type FullPotentialImport = typeof fullPotentialImports.$inferSelect;
export type InsertFullPotentialImport = typeof fullPotentialImports.$inferInsert;
