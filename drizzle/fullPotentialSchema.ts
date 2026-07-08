import { boolean, decimal, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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

  // Geography and segmentation
  country: varchar("country", { length: 2 }).notNull().default("AU"),
  state: varchar("state", { length: 64 }),
  region: varchar("region", { length: 128 }),
  segment: varchar("segment", { length: 128 }),
  subsegment: varchar("subsegment", { length: 128 }),
  applicationPlays: json("applicationPlays").$type<string[]>(),

  // Route-to-market and ownership
  routeToMarket: mysqlEnum("routeToMarket", [
    "direct_ape_ryan",
    "direct_ape_paul_lueth",
    "direct_ape_dan",
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

  // Full Potential operating status
  fpStatus: mysqlEnum("fpStatus", [
    "active_target",
    "develop",
    "watch",
    "qualify",
    "channel_managed",
    "park",
    "exclude",
  ]).notNull().default("qualify"),
  priorityTier: mysqlEnum("priorityTier", ["tier_a", "tier_b", "tier_c", "tier_d", "unassigned"]).notNull().default("unassigned"),
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
  confidenceLevel: mysqlEnum("confidenceLevel", ["high", "medium", "low", "unknown"]).notNull().default("unknown"),
  currentSupplier: varchar("currentSupplier", { length: 256 }),
  installedBaseStatus: mysqlEnum("installedBaseStatus", ["known", "partial", "unknown", "not_applicable"]).notNull().default("unknown"),
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
  confidenceLevel: mysqlEnum("confidenceLevel", ["high", "medium", "low", "unknown"]).notNull().default("unknown"),
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
  confidenceLevel: mysqlEnum("confidenceLevel", ["high", "medium", "low", "unknown"]).notNull().default("unknown"),
  suggestedAction: varchar("suggestedAction", { length: 512 }),
  status: mysqlEnum("status", ["new", "reviewed", "promoted", "dismissed", "archived"]).notNull().default("new"),
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
