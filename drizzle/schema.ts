import { int, float, decimal, json, mysqlEnum, mysqlTable, text, mediumtext, timestamp, varchar, boolean } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  passwordHash: varchar("passwordHash", { length: 256 }),
  authMethod: mysqlEnum("authMethod", ["oauth", "email"]).default("oauth").notNull(),
  role: mysqlEnum("role", ["user", "admin", "distributor"]).default("user").notNull(),
  campaignAccess: boolean("campaignAccess").default(false).notNull(),
  invitedBy: int("invitedBy"),
  inviteToken: varchar("inviteToken", { length: 128 }),
  inviteExpiresAt: timestamp("inviteExpiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * User profiles — onboarding preferences that drive personalized filtering.
 * One row per user. Created during the onboarding wizard.
 */
export const userProfiles = mysqlTable("userProfiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),

  // Company info (Step 0)
  companyName: varchar("companyName", { length: 256 }),
  companyWebsite: varchar("companyWebsite", { length: 512 }),

  // Screen 1: Territory + industries
  territories: json("territories").$type<string[]>(),         // e.g. ["WA", "NT", "QLD"]
  remoteMetroOnly: varchar("remoteMetroOnly", { length: 16 }), // "remote", "metro", "both"
  industries: json("industries").$type<string[]>(),            // e.g. ["mining_exploration", "mining_production"]

  // Screen 2: Offer category + customer type
  offerCategories: json("offerCategories").$type<string[]>(),  // e.g. ["equipment", "rentals", "services"]
  customerTypes: json("customerTypes").$type<string[]>(),      // e.g. ["principal_contractor", "owner_operator"]

  // Screen 3: Deal size + stage timing
  dealSizeMin: varchar("dealSizeMin", { length: 32 }),         // e.g. "$25k"
  dealSizeMax: varchar("dealSizeMax", { length: 32 }),         // e.g. "$500k+"
  stageTiming: json("stageTiming").$type<string[]>(),          // e.g. ["early_signal", "awarded_mobilizing"]

  // Screen 4: Contact roles
  buyerRoles: json("buyerRoles").$type<string[]>(),            // e.g. ["procurement", "project_manager", "engineering"]

  // Screen 5 (optional): Key accounts + exclusions
  keyAccounts: json("keyAccounts").$type<string[]>(),          // company names to prioritize
  excludeAccounts: json("excludeAccounts").$type<string[]>(),  // company names to exclude

  // Atlas Copco business line assignments (e.g. ["Portable Air", "Nitrogen", "BESS"])
  assignedBusinessLines: json("assignedBusinessLines").$type<string[]>(),
  // Optional sector focus — overrides industries for ranking (e.g. ["mining", "oil_gas"])
  sectorFocus: json("sectorFocus").$type<string[]>(),
  /**
   * Sales-motion profile for this rep.
   * GLOBAL RULE: This platform is for direct-sale reps only.
   * direct_only  — direct CAPEX sale only (system default — applies to all reps)
   * mixed        — direct + adjacent motions valid (e.g. cross-sell / service path)
   *
   * rental_led has been removed. Rental/hire projects are suppressed from Must Act
   * and Closing Soon globally regardless of rep profile.
   */
  salesMotion: mysqlEnum("salesMotion", ["direct_only", "mixed"]).default("direct_only"),
  // AI-generated segments (Screen 6)
  aiSegments: json("aiSegments").$type<{ name: string; description: string; expectedLeads: number }[]>(),

  // Metadata
  onboardingCompleted: boolean("onboardingCompleted").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertUserProfile = typeof userProfiles.$inferInsert;

/**
 * Project feedback — thumbs up/down per project per user.
 * Powers the learning loop for personalization.
 */
export const projectFeedback = mysqlTable("projectFeedback", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId").notNull(),
  reportId: int("reportId").notNull(),
  vote: mysqlEnum("vote", ["up", "down"]).notNull(),
  reason: varchar("reason", { length: 128 }),  // e.g. "wrong_region", "too_small", "wrong_market", "not_our_buyer", "too_early", "great_fit"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProjectFeedback = typeof projectFeedback.$inferSelect;
export type InsertProjectFeedback = typeof projectFeedback.$inferInsert;

/**
 * Weekly intelligence reports — one row per weekly run.
 */
export const reports = mysqlTable("reports", {
  id: int("id").autoincrement().primaryKey(),
  weekEnding: varchar("weekEnding", { length: 32 }).notNull(),
  generatedTime: varchar("generatedTime", { length: 64 }).notNull(),
  totalProjects: int("totalProjects").notNull().default(0),
  hotProjects: int("hotProjects").notNull().default(0),
  warmProjects: int("warmProjects").notNull().default(0),
  coldProjects: int("coldProjects").notNull().default(0),
  confirmedContractors: int("confirmedContractors").notNull().default(0),
  predictedContractors: int("predictedContractors").notNull().default(0),
  capexOpportunities: int("capexOpportunities").notNull().default(0),
  totalContacts: int("totalContacts").notNull().default(0),
  sourcesSearched: varchar("sourcesSearched", { length: 64 }).notNull().default("20+"),
  newProjectsCount: int("newProjectsCount").notNull().default(0),
  executiveSummaryMain: text("executiveSummaryMain"),
  executiveSummaryChanges: text("executiveSummaryChanges"),
  actionItems: json("actionItems").$type<string[]>(),
  researchPasses: json("researchPasses").$type<{ pass: string; focus: string; rawProjects: number; keySources: string }[]>(),
  sourceCategories: json("sourceCategories").$type<{ name: string; type: string }[]>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Report = typeof reports.$inferSelect;
export type InsertReport = typeof reports.$inferInsert;

/**
 * Projects discovered in each weekly report.
 */
export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  reportId: int("reportId").notNull(),
  projectKey: varchar("projectKey", { length: 128 }).notNull(),
  name: varchar("name", { length: 512 }).notNull(),
  location: varchar("location", { length: 256 }).notNull(),
  value: varchar("value", { length: 64 }).notNull(),
  owner: varchar("owner", { length: 256 }).notNull(),
  priority: mysqlEnum("priority", ["hot", "warm", "cold"]).notNull(),
  capexGrade: mysqlEnum("capexGrade", ["A", "B", "Unknown"]).notNull().default("Unknown"),
  opportunityRoute: mysqlEnum("opportunityRoute", ["Direct CAPEX", "Fleet CAPEX", "OPEX/Monitor"]).notNull(),
  sector: mysqlEnum("sector", ["mining", "oil_gas", "infrastructure", "energy", "defence"]).notNull(),
  isNew: boolean("isNew").notNull().default(false),
  stage: varchar("stage", { length: 256 }),
  overview: text("overview"),
  equipmentSignals: json("equipmentSignals").$type<string[]>(),
  contractors: json("contractors").$type<{ name: string; status: string; confidence?: number; detail?: string }[]>(),
  opportunityNote: text("opportunityNote"),
  sources: json("sources").$type<{ label: string; url: string; date?: string }[]>(),
  timeline: varchar("timeline", { length: 256 }),
  completion: varchar("completion", { length: 256 }),
  matchedBusinessLines: json("matchedBusinessLines").$type<number[]>(),
  lifecycleStatus: mysqlEnum("lifecycleStatus", ["active", "stale", "archived", "awarded", "completed"]).notNull().default("active"),
  lastActivityAt: timestamp("lastActivityAt").defaultNow(),
  archivedBy: int("archivedBy"),
  archivedAt: timestamp("archivedAt"),
  projectoryEnriched: boolean("projectoryEnriched").default(false),
  actionTier: mysqlEnum("actionTier", ["tier1_actionable", "tier2_warm", "tier3_monitor"]).default("tier3_monitor"),
  /** Stage 5A: primary freshness signal — updated whenever a source mentions this project */
  sourceLastSeenAt: timestamp("sourceLastSeenAt"),
  /** Stage 5A: human-readable reason why this project was marked stale/archived */
  staleReason: varchar("staleReason", { length: 256 }),
  /** Stage 5A: manual keep flag — prevents bulk archival even if old and uncorroborated */
  keepFlag: boolean("keepFlag").default(false),
  /** Stage 5C: UUID grouping all near-duplicate variants of the same real-world project */
  duplicateClusterId: varchar("duplicateClusterId", { length: 36 }),
  /** Stage 5C: ID of the canonical project this one was merged into (null = not merged / is canonical) */
  mergedIntoId: int("mergedIntoId"),
  /** Stage 5C: reviewer dismissed this cluster pair as a false positive (not a real duplicate) */
  duplicateDismissed: boolean("duplicateDismissed").default(false),
  /** Stage 5D: high-level project type classification */
  projectType: mysqlEnum("projectType", ["opportunity", "background_account", "macro_item", "program_wrapper"]).default("opportunity"),
  /** Stage 5D: normalised lifecycle stage code derived from free-text stage field */
  stageCode: mysqlEnum("stageCode", [
    "exploration", "feasibility", "planning", "design", "procurement",
    "awarded", "construction", "commissioning", "operational",
    "completed", "cancelled", "unknown"
  ]).default("unknown"),
  /** Stage 5D: confidence in the stageCode assignment (0.0–1.0) */
  stageConfidence: float("stageConfidence").default(0.5),
  /** Stage 5D: human-readable reason why this project is suppressed from the default rep view */
  suppressionReason: varchar("suppressionReason", { length: 512 }),
  /** Stage 5D: true = excluded from default rep-facing brief (macro, background, completed, etc.) */
  suppressed: boolean("suppressed").default(false),
  /** PT Capital Sales Sprint: primary PT equipment lane for this opportunity */
  productLane: mysqlEnum("productLane", ["portable_air", "pumps", "pal", "bess", "multi_lane_pt"]),
  /** Source Expansion Sprint: purpose of the primary source that created this project */
  sourcePurpose: mysqlEnum("sourcePurpose", [
    "live_tender",      // Active tender on a government portal — highest urgency
    "forward_plan",     // Planned procurement in next 1-2 years — plan ahead
    "project_signal",   // Project announced but not yet tendered — watch this
    "contractor_path",  // ICN/subcontract opportunity — approach contractor
    "awarded",          // Contract awarded — contractor confirmed
  ]).default("project_signal"),
  /** Source Expansion Sprint: government tender number for dedup (e.g. WAT-2024-12345, NT-2024-0001) */
  tenderNumber: varchar("tenderNumber", { length: 64 }),
  /** Source Expansion Sprint: tender closing date for urgency sorting */
  tenderCloseDate: timestamp("tenderCloseDate"),
  /**
   * Enrichment Repair Sprint: explicit reason why Apollo enrichment was blocked for this project.
   * null = not yet evaluated or enrichment succeeded.
   * Values:
   *   blocked_government_owner_manual_discovery — owner is a government/public authority; Apollo blocked, manual discovery needed
   *   blocked_unknown_owner                     — owner is missing, "Unknown", TBC, or similar
   *   blocked_dirty_owner_string                — owner field contains contractor scope text, not a company name
   *   blocked_no_usable_domain                  — owner is private but domain inference produced no usable result
   */
  enrichmentBlockedReason: mysqlEnum("enrichmentBlockedReason", [
    "blocked_government_owner_manual_discovery",
    "blocked_unknown_owner",
    "blocked_dirty_owner_string",
    "blocked_no_usable_domain",
  ]),
  govFallbackStatus: mysqlEnum("govFallbackStatus", [
    "government_fallback_contact_found",
    "government_fallback_named_person_no_email",
    "government_fallback_role_only",
    "government_fallback_no_result",
    "government_fallback_manual_review_required",
  ]),
  /** Australia Location Guard: derived country of the project site (ISO 3166-1 alpha-2) */
  projectCountry: varchar("projectCountry", { length: 2 }),
  /** Australia Location Guard: derived state/region of the project site (e.g. WA, QLD, NSW) */
  projectState: varchar("projectState", { length: 64 }),
  /** Australia Location Guard: confidence in the geography classification (0.0–1.0) */
  locationConfidence: float("locationConfidence"),
  /** Australia Location Guard: if non-null, the project is blocked from rep-facing views */
  geoBlockedReason: mysqlEnum("geoBlockedReason", [
    "blocked_non_australian_project",
    "blocked_location_unclear",
    "blocked_cross_border_signal",
  ]),
  /**
   * Contact Discovery Operating Model: unified project-level discovery state.
   * Tracks where this project is in the contact discovery lifecycle.
   */
  discoveryStatus: mysqlEnum("discoveryStatus", [
    "no_contacts",                // No contacts at all — needs discovery
    "discovery_queued",           // Discovery job created, waiting to run
    "discovery_running",          // Discovery job currently executing
    "role_only",                  // Only generic role titles found (e.g. "Procurement Manager"), no named person
    "named_contact_no_email",     // Named person found but no email address
    "send_ready_contact",         // At least one named person with verified email
    "blocked_government_owner",   // Government/public owner — Apollo blocked, needs gov fallback
    "blocked_dirty_owner",        // Owner field is garbage (contractor scope text, etc.)
    "blocked_no_usable_domain",   // Private owner but no domain could be inferred
    "watchlist_monitor",          // Structurally weak for current digest — monitor for future recovery
  ]).default("no_contacts"),
  /**
   * Contact Discovery Operating Model: priority tier for discovery queue.
   * A = hot/tender/actioned/digest, B = warm/strategic, C = cold/backlog
   */
  discoveryPriority: mysqlEnum("discoveryPriority", ["A", "B", "C"]).default("C"),
  /** Contact Discovery Operating Model: timestamp of last discovery attempt */
  lastDiscoveryAt: timestamp("lastDiscoveryAt"),
  /** Contact Discovery Operating Model: number of discovery attempts made */
  discoveryAttempts: int("discoveryAttempts").default(0),
  /**
   * ICN Gateway Upsert Engine: timestamp of the last time this project was seen in an ICN scraper run.
   * null = never seen by ICN scraper (non-ICN project, or inserted before this field was added).
   * Used to detect staleness: if lastIcnSeenAt is older than 21 days (3 missed weekly runs),
   * the project is treated as dropped from ICN and its lastActivityAt is frozen (not refreshed).
   */
  lastIcnSeenAt: timestamp("lastIcnSeenAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/**
 * Contacts associated with each weekly report.
 */
export const contacts = mysqlTable("contacts", {
  id: int("id").autoincrement().primaryKey(),
  reportId: int("reportId").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  company: varchar("company", { length: 256 }).notNull(),
  project: varchar("project", { length: 512 }).notNull(),
  priority: mysqlEnum("priority", ["hot", "warm", "cold"]).notNull(),
  roleBucket: varchar("roleBucket", { length: 128 }).notNull(),
  email: varchar("email", { length: 320 }),
  linkedin: varchar("linkedin", { length: 512 }),
  phone: varchar("phone", { length: 64 }),
  enrichmentStatus: mysqlEnum("enrichmentStatus", ["pending", "enriched", "not_found", "failed"]).default("pending"),
  enrichmentSource: mysqlEnum("enrichmentSource", ["linkedin", "llm", "manual", "apollo", "web_search", "lusha"]).default("linkedin"),
  sourceUrl: varchar("sourceUrl", { length: 1024 }),
  enrichedAt: timestamp("enrichedAt"),
  linkedinHeadline: varchar("linkedinHeadline", { length: 512 }),
  linkedinLocation: varchar("linkedinLocation", { length: 256 }),
  linkedinProfilePic: varchar("linkedinProfilePic", { length: 1024 }),
  verificationStatus: mysqlEnum("verificationStatus", ["verified", "ai_suggested", "unverified"]).default("unverified"),
  confidenceScore: mysqlEnum("confidenceScore", ["high", "medium", "low"]).default("medium"),
  linkedinSearchUrl: varchar("linkedinSearchUrl", { length: 1024 }),
  linkedinProfileUrl: varchar("linkedinProfileUrl", { length: 1024 }),
  verificationScore: int("verificationScore").default(0),
  roleRelevance: mysqlEnum("roleRelevance", ["high", "medium", "low"]).default("medium"),
  emailVerified: boolean("emailVerified").default(false),
  verifiedByUserId: int("verifiedByUserId"),
  verifiedAt: timestamp("verifiedAt"),
  verifiedLinkedinUrl: varchar("verifiedLinkedinUrl", { length: 1024 }),
  rejectedByUserId: int("rejectedByUserId"),
  rejectedAt: timestamp("rejectedAt"),
  rejectionReason: varchar("rejectionReason", { length: 256 }),
  // CRM import fields
  crmId: varchar("crmId", { length: 64 }),
  crmAccountId: varchar("crmAccountId", { length: 64 }),
  department: varchar("department", { length: 128 }),
  mobilePhone: varchar("mobilePhone", { length: 64 }),
  crmOwner: varchar("crmOwner", { length: 128 }),
  lastCrmModified: timestamp("lastCrmModified"),
  source: mysqlEnum("source", ["scraper", "crm", "manual", "apollo"]).default("scraper"),
  sectorTag: varchar("sectorTag", { length: 64 }),
  enrichmentPriority: mysqlEnum("enrichmentPriority", ["high", "medium", "low"]).default("medium"),
  // Geographic filtering fields
  regionClassification: mysqlEnum("regionClassification", ["australia", "non_australia", "unknown"]).default("unknown"),
  geoFilterReason: varchar("geoFilterReason", { length: 256 }),
  // Three-tier contact trust model
  // send_ready: verified email + project linked + non-LLM source
  // named_unverified: named person, email missing/unverified, or not yet linked
  // llm_inferred: source is llm/llm_fallback/llm_contact_fallback/llm_inference
  contactTrustTier: mysqlEnum("contactTrustTier", ["send_ready", "named_unverified", "llm_inferred"]).default("named_unverified"),
  // CRM graph cleanup: true = imported from CRM/manual with no project linkage
  // Excluded from all project-level queries; preserved for CRM review / manual linking
  crmOrphan: boolean("crmOrphan").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Contact = typeof contacts.$inferSelect;
export type InsertContact = typeof contacts.$inferInsert;

/**
 * Junction table linking contacts to multiple projects.
 * One contact can be relevant to many projects.
 */
export const contactProjects = mysqlTable("contactProjects", {
  id: int("id").autoincrement().primaryKey(),
  contactId: int("contactId").notNull(),
  projectId: int("projectId").notNull(),
  projectName: varchar("projectName", { length: 512 }).notNull(),
  relevance: mysqlEnum("relevance", ["primary", "secondary"]).default("primary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ContactProject = typeof contactProjects.$inferSelect;
export type InsertContactProject = typeof contactProjects.$inferInsert;

/**
 * Drilling campaigns from each weekly report.
 */
export const drillingCampaigns = mysqlTable("drillingCampaigns", {
  id: int("id").autoincrement().primaryKey(),
  reportId: int("reportId").notNull(),
  campaign: varchar("campaign", { length: 256 }).notNull(),
  operator: varchar("operator", { length: 256 }).notNull(),
  location: varchar("location", { length: 256 }).notNull(),
  drillType: varchar("drillType", { length: 128 }).notNull(),
  timing: varchar("timing", { length: 128 }).notNull(),
  airRequirement: varchar("airRequirement", { length: 128 }).notNull(),
  sourceLabel: varchar("sourceLabel", { length: 256 }),
  sourceUrl: varchar("sourceUrl", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DrillingCampaign = typeof drillingCampaigns.$inferSelect;
export type InsertDrillingCampaign = typeof drillingCampaigns.$inferInsert;

/**
 * Awarded projects from each weekly report.
 */
export const awardedProjects = mysqlTable("awardedProjects", {
  id: int("id").autoincrement().primaryKey(),
  reportId: int("reportId").notNull(),
  project: varchar("project", { length: 256 }).notNull(),
  value: varchar("value", { length: 64 }).notNull(),
  winningContractor: varchar("winningContractor", { length: 256 }).notNull(),
  location: varchar("location", { length: 256 }).notNull(),
  stage: varchar("stage", { length: 128 }).notNull(),
  opportunity: mysqlEnum("opportunity", ["Direct", "Fleet", "Monitor"]).notNull(),
  sourceLabel: varchar("sourceLabel", { length: 256 }),
  sourceUrl: varchar("sourceUrl", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AwardedProject = typeof awardedProjects.$inferSelect;
export type InsertAwardedProject = typeof awardedProjects.$inferInsert;

/**
 * Pipeline claims — sales reps claim projects and track outreach status.
 * Status flow: identified → contacted → meeting_booked → quoted → won | lost
 */
export const pipelineClaims = mysqlTable("pipelineClaims", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),

  // Project-sourced claims link here; account/signal/AI claims leave these null.
  projectId: int("projectId"),
  reportId: int("reportId"),

  sourceType: mysqlEnum("sourceType", [
    "project",
    "full_potential",
    "signal",
    "ai_recommendation",
    "manual",
    "legacy",
  ]).notNull().default("project"),

  // Logical references are validated in the service layer.
  sourceAccountId: int("sourceAccountId"),
  sourceSignalId: int("sourceSignalId"),
  sourceRecommendationKey: varchar("sourceRecommendationKey", {
    length: 128,
  }),

  productFamily: varchar("productFamily", { length: 64 }),
  application: varchar("application", { length: 128 }),
  commercialHypothesis: text("commercialHypothesis"),

  status: mysqlEnum("status", [
    "identified",
    "contacted",
    "meeting_booked",
    "qualified",
    "quoted",
    "won",
    "lost",
    "deferred",
    "not_relevant",
  ]).notNull().default("identified"),

  notes: text("notes"),

  // Legacy free-text value is retained for historic project claims.
  estimatedValue: varchar("estimatedValue", { length: 64 }),
  estimatedValueAud: decimal("estimatedValueAud", {
    precision: 14,
    scale: 2,
  }),
  quoteValueAud: decimal("quoteValueAud", {
    precision: 14,
    scale: 2,
  }),

  nextAction: varchar("nextAction", { length: 512 }),
  nextActionDate: timestamp("nextActionDate"),

  contactName: varchar("contactName", { length: 256 }),
  contactId: int("contactId"),
  contactRole: varchar("contactRole", { length: 128 }),

  meetingObjective: text("meetingObjective"),
  customerNeed: text("customerNeed"),
  decisionTiming: varchar("decisionTiming", { length: 256 }),
  competitivePosition: text("competitivePosition"),

  closeDate: timestamp("closeDate"),
  qualifiedAt: timestamp("qualifiedAt"),

  /**
   * Non-null only while an FP opportunity cycle is active or deferred.
   * The unique constraint makes concurrent duplicate creation safe.
   * Terminal transitions clear this key, allowing a later legitimate cycle.
   */
  openDedupeKey: varchar("openDedupeKey", {
    length: 512,
  }).unique(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PipelineClaim = typeof pipelineClaims.$inferSelect;
export type InsertPipelineClaim = typeof pipelineClaims.$inferInsert;

/**
 * Pipeline activity log — tracks status changes and notes history.
 */
export const pipelineActivity = mysqlTable("pipelineActivity", {
  id: int("id").autoincrement().primaryKey(),
  claimId: int("claimId").notNull(),
  userId: int("userId").notNull(),
  fromStatus: varchar("fromStatus", { length: 32 }),
  toStatus: varchar("toStatus", { length: 32 }).notNull(),
  note: text("note"),
  /** Structured event type for analytics (e.g. "stage_advance", "note_added") */
  eventType: varchar("eventType", { length: 64 }),
  /** Arbitrary JSON payload for event-specific metadata */
  metadataJson: json("metadataJson").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PipelineActivityRow = typeof pipelineActivity.$inferSelect;
export type InsertPipelineActivity = typeof pipelineActivity.$inferInsert;

/**
 * Email digest preferences — per-user settings for weekly email summaries.
 */
export const emailDigestPrefs = mysqlTable("emailDigestPrefs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  frequency: mysqlEnum("frequency", ["weekly", "fortnightly", "daily", "none"]).notNull().default("weekly"),
  includeHotOnly: boolean("includeHotOnly").notNull().default(false),
  includeContacts: boolean("includeContacts").notNull().default(true),
  includePipelineUpdates: boolean("includePipelineUpdates").notNull().default(true),
  lastSentAt: timestamp("lastSentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmailDigestPref = typeof emailDigestPrefs.$inferSelect;
export type InsertEmailDigestPref = typeof emailDigestPrefs.$inferInsert;

/**
 * Digest schedule log — tracks when Monday/Thursday digests are sent for recovery from restarts.
 * Used by persistent scheduler to detect missed sends and recover gracefully.
 */
export const digestScheduleLog = mysqlTable("digestScheduleLog", {
  id: int("id").autoincrement().primaryKey(),
  digestType: mysqlEnum("digestType", ["monday", "thursday"]).notNull(),
  scheduledFor: timestamp("scheduledFor").notNull(),
  sentAt: timestamp("sentAt"),
  status: mysqlEnum("status", ["pending", "sent", "failed"]).notNull().default("pending"),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DigestScheduleLog = typeof digestScheduleLog.$inferSelect;
export type InsertDigestScheduleLog = typeof digestScheduleLog.$inferInsert;

/**
 * Per-user email send log — prevents duplicate emails to the same person.
 * Each row records that a specific user received a specific digest type on a specific date.
 * The unique constraint on (userId, digestType, sentDate) ensures at most one email per user per type per day.
 */
export const userEmailSendLog = mysqlTable("userEmailSendLog", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  digestType: mysqlEnum("digestType", ["monday", "thursday", "manager_rollup"]).notNull(),
  sentDate: varchar("sentDate", { length: 10 }).notNull(), // YYYY-MM-DD in UTC
  weekKey: varchar("weekKey", { length: 8 }),              // ISO week e.g. 2026W17
  sentAt: timestamp("sentAt").defaultNow().notNull(),
  status: mysqlEnum("status", ["sent", "failed", "dry_run", "pending"]).notNull().default("sent"),
  itemCount: int("itemCount").default(0),                  // number of projects/actions in email
  dryRun: boolean("dryRun").notNull().default(false),      // true = preview only, not sent
  error: text("error"),
});

export type UserEmailSendLog = typeof userEmailSendLog.$inferSelect;
export type InsertUserEmailSendLog = typeof userEmailSendLog.$inferInsert;

/**
 * Business lines — each Atlas Copco division with its own keyword dictionary.
 */
export const businessLines = mysqlTable("businessLines", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull().unique(),
  description: text("description"),
  keywords: json("keywords").$type<string[]>(),
  sectors: json("sectors").$type<string[]>(),
  equipmentTypes: json("equipmentTypes").$type<string[]>(),
  defaultTerritories: json("defaultTerritories").$type<string[]>(),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BusinessLine = typeof businessLines.$inferSelect;
export type InsertBusinessLine = typeof businessLines.$inferInsert;

/**
 * Per-project business line relevance scores.
 * Each project gets scored (0-100) across all 9 scoring dimensions with a short explanation.
 * Scoring dimensions: Portable Air, PAL, BESS, Pump/Dewatering, Generators, Nitrogen, Booster, Service Potential, Rental Influence
 */
export const projectBusinessLineScores = mysqlTable("projectBusinessLineScores", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  scoringDimension: varchar("scoringDimension", { length: 64 }).notNull(),
  score: int("score").notNull().default(0),
  explanation: text("explanation"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProjectBusinessLineScore = typeof projectBusinessLineScores.$inferSelect;
export type InsertProjectBusinessLineScore = typeof projectBusinessLineScores.$inferInsert;

/**
 * RSS source registry — configurable feeds per business line.
 */
export const rssSources = mysqlTable("rssSources", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  feedUrl: varchar("feedUrl", { length: 512 }).notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  isActive: boolean("isActive").notNull().default(true),
  lastFetchedAt: timestamp("lastFetchedAt"),
  lastFetchCount: int("lastFetchCount").default(0),
  totalArticles: int("totalArticles").default(0),
  successCount: int("successCount").default(0),
  failureCount: int("failureCount").default(0),
  consecutiveErrors: int("consecutiveErrors").default(0),
  errorCount: int("errorCount").default(0),
  lastError: text("lastError"),
  lastErrorAt: timestamp("lastErrorAt"),
  lastSuccessAt: timestamp("lastSuccessAt"),
  /** Stage 5A: admin-controlled quarantine flag — skips source in harvester without deleting it */
  quarantined: boolean("quarantined").default(false),
  quarantineReason: varchar("quarantineReason", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RssSource = typeof rssSources.$inferSelect;
export type InsertRssSource = typeof rssSources.$inferInsert;

/**
 * Raw articles — harvested from RSS feeds before AI extraction.
 */
export const rawArticles = mysqlTable("rawArticles", {
  id: int("id").autoincrement().primaryKey(),
  sourceId: int("sourceId").notNull(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull().unique(),
  title: varchar("title", { length: 512 }).notNull(),
  summary: text("summary"),
  url: varchar("url", { length: 512 }).notNull(),
  publishedAt: timestamp("publishedAt"),
  matchedKeywords: json("matchedKeywords").$type<string[]>(),
  matchedBusinessLines: json("matchedBusinessLines").$type<number[]>(),
  status: mysqlEnum("status", ["pending", "queued", "extracted", "skipped", "failed"]).notNull().default("pending"),
  extractedData: json("extractedData").$type<Record<string, unknown>>(),
  extractedAt: timestamp("extractedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RawArticle = typeof rawArticles.$inferSelect;
export type InsertRawArticle = typeof rawArticles.$inferInsert;

/**
 * Feedback weight adjustments — per-user learned weights from thumbs up/down.
 * Powers the ML relevance ranker without any AI credits.
 */
export const feedbackWeights = mysqlTable("feedbackWeights", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  territoryWeights: json("territoryWeights").$type<Record<string, number>>(),
  industryWeights: json("industryWeights").$type<Record<string, number>>(),
  sectorWeights: json("sectorWeights").$type<Record<string, number>>(),
  dealSizeWeights: json("dealSizeWeights").$type<Record<string, number>>(),
  totalFeedbackCount: int("totalFeedbackCount").notNull().default(0),
  lastUpdatedAt: timestamp("lastUpdatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FeedbackWeight = typeof feedbackWeights.$inferSelect;
export type InsertFeedbackWeight = typeof feedbackWeights.$inferInsert;

/**
 * Outreach emails — tracks AI-generated outreach emails sent to contacts.
 * Prevents duplicate outreach and provides history for the team.
 */
export const outreachEmails = mysqlTable("outreachEmails", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  contactId: int("contactId"),
  contactName: varchar("contactName", { length: 256 }).notNull(),
  contactEmail: varchar("contactEmail", { length: 320 }),
  projectId: int("projectId"),
  projectName: varchar("projectName", { length: 512 }),
  /** FK → pipelineClaims.id — links email to a pipeline claim for attribution (Sprint 2A) */
  claimId: int("claimId"),
  /** FK → fullPotentialAccounts.id — links email to FP account for attribution (Sprint 2A) */
  sourceAccountId: int("sourceAccountId"),
  subject: varchar("subject", { length: 512 }).notNull(),
  body: text("body").notNull(),
  tone: mysqlEnum("tone", ["professional", "consultative", "direct", "contractor_focused", "owner_epc_focused", "procurement_led", "engineering_led", "first_touch"]).notNull(),
  status: mysqlEnum("status", ["drafted", "opened_in_email", "sent"]).notNull().default("drafted"),
  /** Timestamp when the email was opened in the mail client (Sprint 2A) */
  openedInEmailAt: timestamp("openedInEmailAt"),
  /** Timestamp when the email was marked as sent (Sprint 2A) */
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OutreachEmail = typeof outreachEmails.$inferSelect;
export type InsertOutreachEmail = typeof outreachEmails.$inferInsert;

/**
 * Project enrichment cache — tracks which projects have been enriched,
 * when, by whom, and what roles were searched. Prevents duplicate
 * LinkedIn API calls for the same project.
 * Cache TTL: 7 days (re-enrichment allowed after expiry).
 */
export const projectEnrichmentCache = mysqlTable("projectEnrichmentCache", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId"),                                     // null = auto-enrichment (scraper)
  rolesSearched: json("rolesSearched").$type<string[]>(),     // which roles were searched
  companiesSearched: json("companiesSearched").$type<string[]>(), // which companies were searched
  contactsFound: int("contactsFound").notNull().default(0),
  contactsNew: int("contactsNew").notNull().default(0),       // newly created (not duplicates)
  apiCallsMade: int("apiCallsMade").notNull().default(0),     // LinkedIn API calls consumed
  enrichedAt: timestamp("enrichedAt").defaultNow().notNull(),
});

export type ProjectEnrichmentCacheRow = typeof projectEnrichmentCache.$inferSelect;
export type InsertProjectEnrichmentCache = typeof projectEnrichmentCache.$inferInsert;

/**
 * Apollo credit usage log — tracks every Apollo API credit consumed.
 * Used for billing, usage dashboards, and plan limit alerts.
 * Actions: reveal (1 credit), enrich_project (1/contact), verify_email (1 credit)
 */
export const apolloCreditLog = mysqlTable("apolloCreditLog", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  userName: varchar("userName", { length: 256 }),
  action: mysqlEnum("action", ["reveal", "enrich_project", "verify_email"]).notNull(),
  creditsUsed: int("creditsUsed").notNull().default(1),
  contactId: int("contactId"),
  contactName: varchar("contactName", { length: 256 }),
  projectId: int("projectId"),
  projectName: varchar("projectName", { length: 512 }),
  apolloPersonId: varchar("apolloPersonId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ApolloCreditLogRow = typeof apolloCreditLog.$inferSelect;
export type InsertApolloCreditLog = typeof apolloCreditLog.$inferInsert;

/**
 * Outreach email templates — reusable email templates saved by sales reps.
 * Templates can be filtered by role bucket, sector, tone, and tags.
 * Usage count tracks popularity for sorting.
 */
export const outreachTemplates = mysqlTable("outreachTemplates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  description: varchar("description", { length: 512 }),
  subject: varchar("subject", { length: 512 }).notNull(),
  body: text("body").notNull(),
  tone: mysqlEnum("tone", ["professional", "consultative", "direct", "contractor_focused", "owner_epc_focused", "procurement_led", "engineering_led", "first_touch"]).notNull(),
  roleBucket: varchar("roleBucket", { length: 128 }),
  sector: varchar("sector", { length: 128 }),
  tags: json("tags").$type<string[]>(),
  usageCount: int("usageCount").notNull().default(0),
  createdBy: int("createdBy").notNull(),
  createdByName: varchar("createdByName", { length: 256 }),
  isShared: boolean("isShared").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OutreachTemplate = typeof outreachTemplates.$inferSelect;
export type InsertOutreachTemplate = typeof outreachTemplates.$inferInsert;

/**
 * Step-level tracking for pipeline runs.
 */
export interface PipelineStep {
  name: string;
  status: "completed" | "failed" | "skipped";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  counts?: Record<string, number>;
  error?: string;
}

/**
 * Pipeline run logs — tracks every execution of the daily/weekly pipeline.
 * Records timing, article counts, project counts, errors, and source-level stats.
 * Used for the Admin dashboard pipeline health monitoring.
 */
export const pipelineRuns = mysqlTable("pipelineRuns", {
  id: int("id").autoincrement().primaryKey(),
  runType: mysqlEnum("runType", ["daily", "weekly", "manual"]).notNull(),
  status: mysqlEnum("status", ["running", "completed", "failed"]).notNull().default("running"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  durationMs: int("durationMs"),
  // RSS harvest stats
  feedsFetched: int("feedsFetched").default(0),
  feedErrors: int("feedErrors").default(0),
  articlesIngested: int("articlesIngested").default(0),
  articlesSkippedKeyword: int("articlesSkippedKeyword").default(0),
  articlesDuplicate: int("articlesDuplicate").default(0),
  // Extraction stats
  articlesExtracted: int("articlesExtracted").default(0),
  projectsCreated: int("projectsCreated").default(0),
  projectsDuplicate: int("projectsDuplicate").default(0),
  drillingCampaignsCreated: int("drillingCampaignsCreated").default(0),
  awardedProjectsCreated: int("awardedProjectsCreated").default(0),
  // Scraper stats
  austenderContracts: int("austenderContracts").default(0),
  dmirsProjects: int("dmirsProjects").default(0),
  // Contact enrichment stats
  contactsEnriched: int("contactsEnriched").default(0),
  apolloCreditsUsed: int("apolloCreditsUsed").default(0),
  // Projectory enrichment stats
  projectoryEnriched: int("projectoryEnriched").default(0),
  // Scraper stats (additional)
  projectoryProjects: int("projectoryProjects").default(0),
  govProjects: int("govProjects").default(0),
  aemoProjects: int("aemoProjects").default(0),
  icnProjects: int("icnProjects").default(0),
  // Step-level tracking
  steps: json("steps").$type<PipelineStep[]>(),
  // Error details
  errors: json("errors").$type<string[]>(),
  // Source-level breakdown
  sourceStats: json("sourceStats").$type<Record<string, { fetched: number; ingested: number; errors: number }>>(),
  triggeredBy: varchar("triggeredBy", { length: 256 }),
  // Live progress observability — written on every intermediate checkpoint
  // lastProgressAt: timestamp of the most recent writeProgressCheckpoint call.
  //   Used for stall detection: if status=running and lastProgressAt > 45 min ago, the run is stalled.
  lastProgressAt: timestamp("lastProgressAt"),
  // currentStep: name of the step currently executing (written at step START, not end).
  //   Cleared to null on run completion.
  currentStep: varchar("currentStep", { length: 128 }),
  // lastActivityNote: human-readable summary of the most recent completed action.
  //   e.g. "Harvest: 14 new articles from 26 sources"
  lastActivityNote: varchar("lastActivityNote", { length: 512 }),
});

export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type InsertPipelineRun = typeof pipelineRuns.$inferInsert;

/**
 * Projectory enrichment log — tracks each enrichment attempt per project.
 * Records what was found: contractors, consultants, timeline signals, stage updates.
 */
export const projectoryEnrichmentLog = mysqlTable("projectoryEnrichmentLog", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  projectName: varchar("projectName", { length: 512 }).notNull(),
  projectoryUrl: varchar("projectoryUrl", { length: 512 }),
  status: mysqlEnum("status", ["matched", "not_found", "auth_expired", "error"]).notNull(),
  // What was extracted
  contractorsFound: json("contractorsFound").$type<{ name: string; role: string; detail?: string }[]>(),
  consultantsFound: json("consultantsFound").$type<{ name: string; role: string; detail?: string }[]>(),
  stakeholdersFound: json("stakeholdersFound").$type<{ name: string; position: string; organisation: string; email?: string }[]>(),
  stageUpdate: varchar("stageUpdate", { length: 256 }),
  valueUpdate: varchar("valueUpdate", { length: 128 }),
  timelineSignals: json("timelineSignals").$type<{ phase: string; signal: string; date?: string }[]>(),
  // Metadata
  searchQuery: varchar("searchQuery", { length: 512 }),
  enrichedAt: timestamp("enrichedAt").defaultNow().notNull(),
  errorMessage: text("errorMessage"),
});

export type ProjectoryEnrichmentLogRow = typeof projectoryEnrichmentLog.$inferSelect;
export type InsertProjectoryEnrichmentLog = typeof projectoryEnrichmentLog.$inferInsert;

/**
 * Projectory contractor frequency — aggregated contractor appearances across projects.
 * Updated after each enrichment run. Powers the "Contractor Network" analysis.
 */
export const projectoryContractorFrequency = mysqlTable("projectoryContractorFrequency", {
  id: int("id").autoincrement().primaryKey(),
  contractorName: varchar("contractorName", { length: 256 }).notNull(),
  role: varchar("role", { length: 128 }).notNull(),  // EPC, design, subcontractor, etc.
  projectCount: int("projectCount").notNull().default(1),
  projectIds: json("projectIds").$type<number[]>(),
  sectors: json("sectors").$type<string[]>(),
  states: json("states").$type<string[]>(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProjectoryContractorFrequencyRow = typeof projectoryContractorFrequency.$inferSelect;
export type InsertProjectoryContractorFrequency = typeof projectoryContractorFrequency.$inferInsert;

/**
 * Contractor registry — master list of all companies discovered across projects.
 * Each company has a canonical name, classified role(s), and frequency metrics
 * broken down by sector, state, project stage, and time period.
 */
export const contractorRegistry = mysqlTable("contractorRegistry", {
  id: int("id").autoincrement().primaryKey(),
  canonicalName: varchar("canonicalName", { length: 256 }).notNull().unique(),
  aliases: json("aliases").$type<string[]>(),
  primaryRole: mysqlEnum("primaryRole", [
    "owner", "epc", "contractor", "subcontractor",
    "consultant", "supplier", "rental", "government", "unknown"
  ]).notNull().default("unknown"),
  additionalRoles: json("additionalRoles").$type<string[]>(),
  // Frequency by dimension
  projectCount: int("projectCount").notNull().default(0),
  confirmedCount: int("confirmedCount").notNull().default(0),
  predictedCount: int("predictedCount").notNull().default(0),
  sectorBreakdown: json("sectorBreakdown").$type<Record<string, number>>(),   // { mining: 12, energy: 5 }
  stateBreakdown: json("stateBreakdown").$type<Record<string, number>>(),     // { WA: 8, QLD: 4 }
  stageBreakdown: json("stageBreakdown").$type<Record<string, number>>(),     // { awarded: 5, tendering: 3 }
  // Recent activity
  recentProjectIds: json("recentProjectIds").$type<number[]>(),
  firstSeenAt: timestamp("firstSeenAt"),
  lastSeenAt: timestamp("lastSeenAt"),
  // Scoring
  momentumScore: int("momentumScore").default(0),       // 0-100: how active recently
  recurrenceScore: int("recurrenceScore").default(0),   // 0-100: how often they appear
  atlasRelevanceScore: int("atlasRelevanceScore").default(0), // 0-100: relevance to Atlas business lines
  earlySignalScore: int("earlySignalScore").default(0), // 0-100: how often they appear in early-stage projects
  compositeScore: int("compositeScore").default(0),     // weighted combination
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ContractorRegistryRow = typeof contractorRegistry.$inferSelect;
export type InsertContractorRegistry = typeof contractorRegistry.$inferInsert;

/**
 * Contractor-project links — junction table linking contractors to projects with role classification.
 * One contractor can appear on many projects; one project can have many contractors.
 */
export const contractorProjectLinks = mysqlTable("contractorProjectLinks", {
  id: int("id").autoincrement().primaryKey(),
  contractorId: int("contractorId").notNull(),
  projectId: int("projectId").notNull(),
  role: mysqlEnum("role", [
    "owner", "epc", "contractor", "subcontractor",
    "consultant", "supplier", "rental", "government", "unknown"
  ]).notNull().default("unknown"),
  status: mysqlEnum("status", ["confirmed", "predicted", "tendering", "historical"]).notNull().default("predicted"),
  detail: text("detail"),
  confidence: int("confidence").default(50), // 0-100
  source: varchar("source", { length: 128 }),  // e.g. "seed_data", "projectory", "austender", "rss"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ContractorProjectLinkRow = typeof contractorProjectLinks.$inferSelect;
export type InsertContractorProjectLink = typeof contractorProjectLinks.$inferInsert;

/**
 * Contractor pairings — detected recurring relationships between companies.
 * Tracks owner/EPC, contractor/consultant, contractor/region, etc.
 */
export const contractorPairings = mysqlTable("contractorPairings", {
  id: int("id").autoincrement().primaryKey(),
  companyAId: int("companyAId").notNull(),
  companyAName: varchar("companyAName", { length: 256 }).notNull(),
  companyARoleInPairing: varchar("companyARoleInPairing", { length: 64 }).notNull(),
  companyBId: int("companyBId").notNull(),
  companyBName: varchar("companyBName", { length: 256 }).notNull(),
  companyBRoleInPairing: varchar("companyBRoleInPairing", { length: 64 }).notNull(),
  pairingType: mysqlEnum("pairingType", [
    "owner_epc", "owner_contractor", "contractor_consultant",
    "contractor_subcontractor", "contractor_region", "epc_subcontractor", "other"
  ]).notNull(),
  coOccurrenceCount: int("coOccurrenceCount").notNull().default(1),
  projectIds: json("projectIds").$type<number[]>(),
  sectors: json("sectors").$type<string[]>(),
  states: json("states").$type<string[]>(),
  strengthScore: int("strengthScore").default(0),  // 0-100
  lastSeenAt: timestamp("lastSeenAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ContractorPairingRow = typeof contractorPairings.$inferSelect;
export type InsertContractorPairing = typeof contractorPairings.$inferInsert;

/**
 * Emerging patterns — detected signals from contractor/delivery-chain analysis.
 * These are practical opportunity signals for the weekly brief.
 */
export const emergingPatterns = mysqlTable("emergingPatterns", {
  id: int("id").autoincrement().primaryKey(),
  patternType: mysqlEnum("patternType", [
    "contractor_surge",       // Company appearing on multiple new projects
    "sector_clustering",      // Multiple projects in same sector/region
    "pairing_activation",     // Known pairing appearing on new project
    "stage_progression",      // Multiple projects advancing stage
    "new_entrant",           // New company appearing for first time
    "regional_momentum",     // Cluster of activity in a region
    "supply_chain_signal"    // Equipment/rental demand pattern
  ]).notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  description: text("description").notNull(),
  signalStrength: mysqlEnum("signalStrength", ["strong", "moderate", "emerging"]).notNull(),
  // Linked entities
  contractorIds: json("contractorIds").$type<number[]>(),
  projectIds: json("projectIds").$type<number[]>(),
  pairingIds: json("pairingIds").$type<number[]>(),
  // Context
  sectors: json("sectors").$type<string[]>(),
  states: json("states").$type<string[]>(),
  atlasRelevance: text("atlasRelevance"),  // Why this matters for Atlas Copco
  suggestedAction: text("suggestedAction"), // What sales should do
  // Lifecycle
  detectedAt: timestamp("detectedAt").defaultNow().notNull(),
  reportId: int("reportId"),  // linked to weekly report when included
  isActive: boolean("isActive").notNull().default(true),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmergingPatternRow = typeof emergingPatterns.$inferSelect;
export type InsertEmergingPattern = typeof emergingPatterns.$inferInsert;

/**
 * User activity tracking — measures system engagement per salesperson.
 * Tracks: projects viewed, contacts opened, outreach actions, pipeline movements.
 */
export const userActivity = mysqlTable("userActivity", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  actionType: mysqlEnum("actionType", [
    "project_viewed",
    "contact_viewed",
    "contact_enriched",
    "outreach_drafted",
    "outreach_sent",
    "pipeline_claimed",
    "pipeline_stage_advanced",
    "pipeline_status_changed",
    "pipeline_meeting_logged",
    "pipeline_quote_uploaded",
    "search_performed",
    "project_exported",
  ]).notNull(),
  // Optional references
  projectId: int("projectId"),
  contactId: int("contactId"),
  claimId: int("claimId"),
  // Context
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type UserActivityRow = typeof userActivity.$inferSelect;
export type InsertUserActivity = typeof userActivity.$inferInsert;


/**
 * Collateral items — product flyers, case studies, and solution briefs uploaded by sales reps.
 * Each item is stored in S3 and tagged with applications, sectors, and product lines
 * to enable automatic matching against projects for outreach.
 */
export const collateralItems = mysqlTable("collateralItems", {
  id: int("id").autoincrement().primaryKey(),
  // Core metadata
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  productLine: mysqlEnum("productLine", [
    "portable_air", "dewatering", "generators", "bess", "nitrogen", "lighting", "other"
  ]).notNull().default("portable_air"),
  // File storage
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 1024 }).notNull(),
  fileName: varchar("fileName", { length: 256 }).notNull(),
  fileMimeType: varchar("fileMimeType", { length: 128 }).notNull().default("application/pdf"),
  fileSizeBytes: int("fileSizeBytes"),
  // Thumbnail (auto-generated or uploaded)
  thumbnailUrl: varchar("thumbnailUrl", { length: 1024 }),
  // Matching tags
  applicationTags: json("applicationTags").$type<string[]>(),  // e.g. ["rc_drilling", "waterwell", "exploration"]
  sectorTags: json("sectorTags").$type<string[]>(),            // e.g. ["mining", "oil_gas"]
  keywordTags: json("keywordTags").$type<string[]>(),          // free-form keywords for matching
  // Size filter — restrict matching to projects above a certain scale
  minProjectSize: mysqlEnum("minProjectSize", ["any", "large", "mega"]).notNull().default("any"),  // any=all projects, large=$50M+/Grade A, mega=$500M+
  // Usage tracking
  matchCount: int("matchCount").notNull().default(0),          // how many times matched to a project
  attachCount: int("attachCount").notNull().default(0),        // how many times attached to an outreach email
  // Ownership
  uploadedBy: int("uploadedBy").notNull(),
  uploadedByName: varchar("uploadedByName", { length: 256 }),
  // Lifecycle
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CollateralItem = typeof collateralItems.$inferSelect;
export type InsertCollateralItem = typeof collateralItems.$inferInsert;

/**
 * Collateral-project matches — tracks which collateral items have been matched to which projects.
 * Used for outreach email attachment suggestions and analytics.
 */
export const collateralProjectMatches = mysqlTable("collateralProjectMatches", {
  id: int("id").autoincrement().primaryKey(),
  collateralId: int("collateralId").notNull(),
  projectId: int("projectId").notNull(),
  matchScore: int("matchScore").notNull().default(0),  // 0-100 relevance score
  matchReason: text("matchReason"),                     // why this was matched
  wasUsedInOutreach: boolean("wasUsedInOutreach").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CollateralProjectMatch = typeof collateralProjectMatches.$inferSelect;
export type InsertCollateralProjectMatch = typeof collateralProjectMatches.$inferInsert;


/**
 * Campaigns — tracks targeted outreach campaigns (e.g., XAVS1800 Blasting Campaign).
 * Each campaign links to a collateral item and has a sender identity.
 */
export const campaigns = mysqlTable("campaigns", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  // Linked collateral item (e.g., XAVS1800 flyer)
  collateralId: int("collateralId"),
  collateralName: varchar("collateralName", { length: 256 }),
  // Sender identity
  senderName: varchar("senderName", { length: 128 }).notNull(),
  senderEmail: varchar("senderEmail", { length: 320 }).notNull(),
  senderTitle: varchar("senderTitle", { length: 256 }),
  // Campaign targeting
  targetSegment: varchar("targetSegment", { length: 128 }),  // e.g., "blasting", "painting", "corrosion"
  targetRoles: json("targetRoles").$type<string[]>(),  // e.g., ["rc_driller", "operations"]
  customRoleKeywords: json("customRoleKeywords").$type<string[]>(),  // user-typed keywords saved for search
  // Status
  status: mysqlEnum("status", ["draft", "active", "paused", "completed"]).notNull().default("draft"),
  // Stats (denormalized for quick display)
  totalContacts: int("totalContacts").notNull().default(0),
  enrichedContacts: int("enrichedContacts").notNull().default(0),
  emailsDrafted: int("emailsDrafted").notNull().default(0),
  emailsApproved: int("emailsApproved").notNull().default(0),
  emailsSent: int("emailsSent").notNull().default(0),
  // Ownership
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = typeof campaigns.$inferInsert;

/**
 * Campaign contacts — individual contacts imported into a campaign.
 * Scored and tiered for prioritised outreach.
 */
export const campaignContacts = mysqlTable("campaignContacts", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  // Contact identity
  firstName: varchar("firstName", { length: 128 }),
  lastName: varchar("lastName", { length: 128 }),
  title: varchar("title", { length: 256 }),
  company: varchar("company", { length: 256 }).notNull(),
  reviewedCompanyName: varchar("reviewedCompanyName", { length: 256 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 64 }),
  mobile: varchar("mobile", { length: 64 }),
  // Scoring
  score: int("score").notNull().default(0),  // 0-100 composite score
  tier: mysqlEnum("tier", ["tier1_hot", "tier2_warm", "tier3_enrich", "tier4_low", "excluded"]).notNull().default("tier3_enrich"),
  titleRelevance: mysqlEnum("titleRelevance", ["blasting_specialist", "decision_maker", "operations", "other", "unknown"]).notNull().default("unknown"),
  // Enrichment
  enrichmentStatus: mysqlEnum("enrichmentStatus", ["not_needed", "pending", "enriched", "not_found", "failed"]).notNull().default("pending"),
  enrichmentSource: mysqlEnum("enrichmentSource_cc", ["apollo", "hunter", "manual", "import"]),
  apolloPersonId: varchar("apolloPersonId", { length: 128 }),
  enrichedEmail: varchar("enrichedEmail", { length: 320 }),
  enrichedTitle: varchar("enrichedTitle", { length: 256 }),
  enrichedLinkedin: varchar("enrichedLinkedin", { length: 512 }),
  hunterConfidence: int("hunterConfidence"),  // Hunter.io confidence score 0-100
  hunterVerificationStatus: varchar("hunterVerificationStatus", { length: 32 }),  // valid, accept_all, unknown, invalid
  enrichedAt: timestamp("enrichedAt"),
  // Project intelligence match
  matchedProjectIds: json("matchedProjectIds").$type<number[]>(),
  matchedProjectCount: int("matchedProjectCount").notNull().default(0),
  // Outreach status
  outreachStatus: mysqlEnum("outreachStatus", ["not_started", "email_drafted", "pending_approval", "approved", "rejected", "sent", "replied", "bounced", "opted_out"]).notNull().default("not_started"),
  draftSubject: text("draftSubject"),
  draftBody: text("draftBody"),
  draftKeyPoints: json("draftKeyPoints").$type<string[]>(),
  draftTone: varchar("draftTone", { length: 64 }),
  draftGeneratedAt: timestamp("draftGeneratedAt"),
  approvedAt: timestamp("approvedAt"),
  approvedBy: int("approvedBy"),
  sentAt: timestamp("sentAt"),
  sentEmailId: varchar("sentEmailId", { length: 128 }),  // Resend email ID
  // Source tracking
  sourceRow: int("sourceRow"),  // Original row number in the spreadsheet
  // Stage 1 carry-forward: record type from ingestion (person | company_target)
  // company_target rows MUST NOT enter person scoring or enrichment
  recordType: varchar("recordType", { length: 32 }).notNull().default("person"),
  roleBucket: varchar("roleBucket", { length: 128 }),  // Granular role category (c_suite, director, senior_manager, manager, procurement, engineering, operations, site_workshop, other)
  scoreBreakdown: json("scoreBreakdown"),  // ScoreBreakdown object for explainability
  // Stage 3: post-enrichment QA
  enrichmentQA: json("enrichmentQA"),  // EnrichmentQAResult — full QA output
  sendReadiness: varchar("sendReadiness", { length: 32 }),  // send_ready | review_before_send | blocked_from_send
  nameCheckStatus: varchar("nameCheckStatus", { length: 128 }),
  reviewNotes: text("reviewNotes"),
  // Stage 6A: Emarsys export eligibility fields
  // doNotContact: set by admin or inferred from opted_out/bounced status
  doNotContact: boolean("doNotContact").notNull().default(false),
  doNotContactReason: varchar("doNotContactReason", { length: 256 }),
  // emarsysApproved: explicitly approved for Emarsys marketing send
  emarsysApproved: boolean("emarsysApproved").notNull().default(false),
  emarsysApprovedAt: timestamp("emarsysApprovedAt"),
  emarsysApprovedBy: int("emarsysApprovedBy"),
  // lastExportedAt: timestamp of most recent Emarsys export inclusion
  lastExportedAt: timestamp("lastExportedAt"),
  lastExportLogId: int("lastExportLogId"),
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CampaignContact = typeof campaignContacts.$inferSelect;
export type InsertCampaignContact = typeof campaignContacts.$inferInsert;


/**
 * Dismissed/completed suggested actions — tracks which actions a user has
 * dismissed or completed so they don't keep reappearing week after week.
 */
export const dismissedActions = mysqlTable("dismissedActions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  // Unique key for the action: hash of type + projectId + contactId
  actionKey: varchar("actionKey", { length: 128 }).notNull(),
  // What type of dismissal
  reason: mysqlEnum("reason", ["dismissed", "completed", "not_relevant"]).notNull().default("dismissed"),
  // The week this was dismissed (YYYY-MM-DD Monday date)
  weekLabel: varchar("weekLabel", { length: 16 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type DismissedAction = typeof dismissedActions.$inferSelect;
export type InsertDismissedAction = typeof dismissedActions.$inferInsert;


/**
 * Campaign email templates — reusable outreach email templates per campaign.
 * Supports merge fields like {{firstName}}, {{company}}, {{projectName}} etc.
 * One active template per campaign (upsert pattern).
 */
export const campaignEmailTemplates = mysqlTable("campaignEmailTemplates", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  name: varchar("name", { length: 256 }).notNull().default("Default Template"),
  // Template content with merge field tokens
  subjectTemplate: text("subjectTemplate").notNull(),
  bodyTemplate: text("bodyTemplate").notNull(),
  // Style options
  greetingStyle: varchar("greetingStyle", { length: 64 }).notNull().default("Hi {{firstName}},"),
  signOffStyle: varchar("signOffStyle", { length: 64 }).notNull().default("Kind regards,"),
  senderSignature: text("senderSignature"),
  // HTML template support
  templateMode: mysqlEnum("templateMode", ["plaintext", "html"]).notNull().default("plaintext"),
  htmlTemplate: mediumtext("htmlTemplate"),
  // Available merge fields metadata (stored for UI reference)
  mergeFields: json("mergeFields").$type<string[]>(),
  // Status
  isActive: boolean("isActive").notNull().default(true),
  // Ownership
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CampaignEmailTemplate = typeof campaignEmailTemplates.$inferSelect;
export type InsertCampaignEmailTemplate = typeof campaignEmailTemplates.$inferInsert;

/**
 * campaignStagedContacts — Stage 1 pre-waterfall ingestion staging table.
 *
 * Every uploaded file lands here first. No row proceeds to scoring,
 * enrichment, or outreach until it has been committed from staging.
 *
 * Lifecycle:
 *   upload → staged (pending) → reviewed → committed (→ campaignContacts)
 *                                        → discarded
 */
export const campaignStagedContacts = mysqlTable("campaignStagedContacts", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),

  // Batch tracking
  batchId: varchar("batchId", { length: 64 }).notNull(),
  uploadFileType: varchar("uploadFileType", { length: 32 }).notNull().default("unknown"),
  batchStatus: varchar("batchStatus", { length: 32 }).notNull().default("pending"),

  // Identity (normalized)
  firstName: varchar("firstName", { length: 128 }),
  lastName: varchar("lastName", { length: 128 }),
  fullNameRaw: varchar("fullNameRaw", { length: 256 }),
  title: varchar("title", { length: 256 }),
  titleRaw: varchar("titleRaw", { length: 256 }),
  company: varchar("company", { length: 256 }),
  companyRaw: varchar("companyRaw", { length: 256 }),
  companyCanonical: varchar("companyCanonical", { length: 256 }),
  jointVentureLabel: varchar("jointVentureLabel", { length: 512 }),
  domain: varchar("domain", { length: 256 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 64 }),
  mobile: varchar("mobile", { length: 64 }),
  linkedin: varchar("linkedin", { length: 512 }),
  notes: text("notes"),

  // Record type — drives routing to person vs company enrichment branch
  recordType: varchar("recordType", { length: 32 }).notNull().default("person"),

  // Classification
  classification: varchar("classification", { length: 32 }).notNull().default("review_needed"),
  reviewFlags: json("reviewFlags").$type<string[]>(),
  rejectionReason: text("rejectionReason"),
  duplicateOf: varchar("duplicateOf", { length: 512 }),

  // Human review
  reviewStatus: varchar("reviewStatus", { length: 32 }).notNull().default("pending"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  reviewComment: text("reviewComment"),

  // Provenance
  sourceRow: int("sourceRow"),
  uploadedBy: int("uploadedBy").notNull(),

  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CampaignStagedContact = typeof campaignStagedContacts.$inferSelect;
export type InsertCampaignStagedContact = typeof campaignStagedContacts.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3: Approved Domain Overrides
// Allows operators to manually approve a domain for a specific company,
// bypassing the heuristic domain-derivation logic in enrichmentQA.ts.
// ─────────────────────────────────────────────────────────────────────────────
export const campaignDomainOverrides = mysqlTable("campaignDomainOverrides", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  // The canonical company name (normalised lowercase) this override applies to
  companyNameNormalised: varchar("companyNameNormalised", { length: 256 }).notNull(),
  // The approved email domain for this company in this campaign
  approvedDomain: varchar("approvedDomain", { length: 256 }).notNull(),
  // Optional: restrict override to a specific subsidiary or trading name
  subsidiaryName: varchar("subsidiaryName", { length: 256 }),
  // Reason for the override (audit trail)
  reason: text("reason"),
  // Who approved it
  approvedBy: int("approvedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CampaignDomainOverride = typeof campaignDomainOverrides.$inferSelect;
export type InsertCampaignDomainOverride = typeof campaignDomainOverrides.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Stage 6A: Emarsys Export Log
// Records every Atlas → Emarsys export event for audit trail.
// ─────────────────────────────────────────────────────────────────────────────
export const emarsysExportLogs = mysqlTable("emarsysExportLogs", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  campaignName: varchar("campaignName", { length: 256 }).notNull(),
  // Export mode: curated_marketing_export | sales_direct_export
  exportMode: mysqlEnum("exportMode", ["curated_marketing_export", "sales_direct_export"]).notNull(),
  // Configurable defaults applied at export time
  divisionLabel: varchar("divisionLabel", { length: 128 }).notNull().default("Atlas Copco"),
  salesOrg: varchar("salesOrg", { length: 32 }).notNull().default("AU30"),
  languageTag: varchar("languageTag", { length: 16 }).notNull().default("en"),
  countryRegion: varchar("countryRegion", { length: 64 }).notNull().default("Australia"),
  collateralName: varchar("collateralName", { length: 256 }),
  // Counts
  totalCampaignContacts: int("totalCampaignContacts").notNull().default(0),
  exportedCount: int("exportedCount").notNull().default(0),
  excludedCount: int("excludedCount").notNull().default(0),
  // Exclusion breakdown (JSON map of reason → count)
  exclusionBreakdown: json("exclusionBreakdown").$type<Record<string, number>>(),
  // Template version used
  templateVersion: varchar("templateVersion", { length: 32 }).notNull().default("6A-v1"),
  // File reference (S3 key of the generated CSV)
  exportFileKey: varchar("exportFileKey", { length: 512 }),
  exportFileUrl: varchar("exportFileUrl", { length: 1024 }),
  // Ownership
  exportedBy: int("exportedBy").notNull(),
  exportedByName: varchar("exportedByName", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type EmarsysExportLog = typeof emarsysExportLogs.$inferSelect;
export type InsertEmarsysExportLog = typeof emarsysExportLogs.$inferInsert;


// ─────────────────────────────────────────────────────────────────────────────
// Part D — Action Tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * projectActions — tracks rep responses to weekly shortlisted opportunities.
 *
 * Design decisions:
 *  - projectFeedback is retained as-is for ML personalization signal.
 *  - projectActions is the authoritative outcome-tracking table for PT Capital
 *    Sales reporting. It does NOT replace projectFeedback.
 *  - actionId is a deterministic short code: ACT-{weekKey}-{userId6}-{projectId6}
 *    where weekKey = ISO year + week (e.g. "2026W17"). Same userId+projectId+weekKey
 *    upserts the existing record; a new week creates a new instance.
 *  - Lifecycle rules (enforced in db.ts helpers):
 *      won / lost         → completedAt set, action closed
 *      not_relevant       → completedAt set, action closed unless manually reopened
 *      already_active     → suppress new prompts for 14-day cooling period
 *      deferred           → action open, lower urgency
 *      contact_discovery_needed → action open, flagged awaiting data
 */
export const projectActions = mysqlTable("projectActions", {
  id: int("id").autoincrement().primaryKey(),

  // Core linkage
  projectId: int("projectId").notNull(),
  contactId: int("contactId"),          // nullable — no contact yet
  campaignId: int("campaignId"),        // nullable — not tied to campaign
  userId: int("userId").notNull(),      // rep who owns this action

  // Stable reference code for email / weekly brief linking
  // Format: ACT-{weekKey}-{userId6}-{projectId6}  e.g. ACT-2026W17-000042-000317
  actionId: varchar("actionId", { length: 64 }).notNull().unique(),

  // Where the action originated
  sourceContext: mysqlEnum("sourceContext", [
    "weekly_email",
    "dashboard",
    "campaign",
    "emarsys_followup",
    "manual",
  ]).notNull().default("dashboard"),

  // PT lane at time of action creation (snapshot — project lane may change later)
  productLane: mysqlEnum("productLane", [
    "portable_air",
    "pumps",
    "pal",
    "bess",
    "multi_lane_pt",
  ]),

  // What the system suggested the rep should do
  recommendedAction: varchar("recommendedAction", { length: 256 }),

  // Rep's recorded outcome
  outcomeCode: mysqlEnum("outcomeCode", [
    "not_started",
    "contacted",
    "meeting_booked",
    "proposal_sent",
    "won",
    "lost",
    "deferred",
    "not_relevant",
    "already_active",
    "contact_discovery_needed",
  ]).notNull().default("not_started"),

  // Optional free-text note (not mandatory)
  outcomeNotes: text("outcomeNotes"),

  // ISO week key used for deduplication: e.g. "2026W17"
  weekKey: varchar("weekKey", { length: 8 }).notNull(),

  // Visibility
  managerVisible: boolean("managerVisible").notNull().default(true),

  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  // Set when action is closed (won / lost / not_relevant)
  completedAt: timestamp("completedAt"),
});

export type ProjectAction = typeof projectActions.$inferSelect;
export type InsertProjectAction = typeof projectActions.$inferInsert;

// ── Manager Rollup Recipients ──
// Configurable list of users who receive the manager rollup email.
// If this table is empty, sendManagerRollupEmail falls back to all role='admin' users.
export const managerRollupRecipients = mysqlTable("managerRollupRecipients", {
  id: int("id").primaryKey().autoincrement(),
  userId: int("userId").notNull(),
  addedBy: int("addedBy").notNull(),
  addedAt: timestamp("addedAt").defaultNow().notNull(),
});

export type ManagerRollupRecipient = typeof managerRollupRecipients.$inferSelect;
export type InsertManagerRollupRecipient = typeof managerRollupRecipients.$inferInsert;


/**
 * Account Attack Phase 2 — AI research run cache.
 * Stores structured LLM synthesis results (stakeholder map, sales brief, recommended actions)
 * keyed by account + objective + lens + lane + depth + optional project/tender.
 * TTL varies by objective (7–30 days). One fresh run per cache key at a time.
 */
export const accountResearchRuns = mysqlTable("accountResearchRuns", {
  id: int("id").primaryKey().autoincrement(),

  // Cache key components
  accountName: varchar("accountName", { length: 512 }).notNull(),
  objective: varchar("objective", { length: 128 }).notNull(),
  lensMode: varchar("lensMode", { length: 32 }).notNull(),
  ptLaneFocus: varchar("ptLaneFocus", { length: 128 }),
  researchDepth: mysqlEnum("researchDepth", ["quick", "standard", "deep"]).default("quick").notNull(),
  knownProjectId: int("knownProjectId"),
  sellerLaneContext: text("sellerLaneContext"),

  // Run metadata
  userId: int("userId").notNull(),
  status: mysqlEnum("status", ["pending", "running", "complete", "failed"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),

  // Structured output (JSON blobs)
  stakeholderMap: json("stakeholderMap"),
  salesBrief: json("salesBrief"),
  recommendedActions: json("recommendedActions"),

  // Input context snapshot (for audit / reproducibility)
  inputContext: json("inputContext"),

  // Token usage
  promptTokens: int("promptTokens"),
  completionTokens: int("completionTokens"),
  totalTokens: int("totalTokens"),

  // TTL
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AccountResearchRun = typeof accountResearchRuns.$inferSelect;
export type InsertAccountResearchRun = typeof accountResearchRuns.$inferInsert;


// ─────────────────────────────────────────────────────────────────────────────
// Contact Validation Workflow
// Reps and admins can Accept / Reject / Wrong company / Wrong role / Backup only
// Accepted named_unverified contacts are promoted to send_ready.
// LLM contacts remain llm_inferred unless independently verified.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * contactValidationActions — audit log of every rep/admin validation decision.
 * One row per decision. Multiple decisions per contact are allowed (history).
 */
export const contactValidationActions = mysqlTable("contactValidationActions", {
  id: int("id").autoincrement().primaryKey(),
  contactId: int("contactId").notNull(),
  projectId: int("projectId"),               // context project (optional)
  userId: int("userId").notNull(),            // who made the decision
  userName: varchar("userName", { length: 256 }),

  // The decision
  action: mysqlEnum("action", [
    "accept",            // Contact is correct — promote to send_ready if email present
    "reject",            // Contact is wrong — demote, do not use
    "wrong_company",     // Name is right but company is wrong — flag for re-search
    "wrong_role",        // Person exists but role is not relevant — keep as backup
    "backup_only",       // Valid contact but not primary — keep as named_unverified
    "verify_email",      // Rep confirmed email is correct — promote to send_ready
  ]).notNull(),

  // What tier the contact was in BEFORE this action
  previousTier: mysqlEnum("previousTier", ["send_ready", "named_unverified", "llm_inferred"]),
  // What tier the contact moved to AFTER this action
  newTier: mysqlEnum("newTier", ["send_ready", "named_unverified", "llm_inferred"]),

  // Optional note from rep
  note: text("note"),

  // Whether this was triggered by Hunter email verification
  hunterVerified: boolean("hunterVerified").notNull().default(false),
  hunterConfidence: int("hunterConfidence"),   // 0-100 Hunter confidence score
  hunterStatus: varchar("hunterStatus", { length: 32 }), // valid | accept_all | unknown | invalid

  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ContactValidationAction = typeof contactValidationActions.$inferSelect;
export type InsertContactValidationAction = typeof contactValidationActions.$inferInsert;

/**
 * contactCandidateSlates — the structured 5-slot candidate slate per project.
 *
 * For each hot/warm project, the waterfall engine produces:
 *   slot 1: primary (highest confidence, send_ready preferred)
 *   slot 2: backup_1 (second-best, named_unverified OK)
 *   slot 3: backup_2 (third-best)
 *   slot 4: commercial (procurement / commercial / contracts role)
 *   slot 5: technical (operations / maintenance / engineering role)
 *
 * Slates are regenerated when discovery runs or a validation action changes a contact tier.
 */
export const contactCandidateSlates = mysqlTable("contactCandidateSlates", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),

  // Slot assignments — contactId for each slot (nullable = not yet found)
  primaryContactId: int("primaryContactId"),
  backup1ContactId: int("backup1ContactId"),
  backup2ContactId: int("backup2ContactId"),
  commercialContactId: int("commercialContactId"),
  technicalContactId: int("technicalContactId"),

  // Slot metadata (JSON snapshots for display without extra joins)
  primarySnapshot: json("primarySnapshot").$type<SlotSnapshot | null>(),
  backup1Snapshot: json("backup1Snapshot").$type<SlotSnapshot | null>(),
  backup2Snapshot: json("backup2Snapshot").$type<SlotSnapshot | null>(),
  commercialSnapshot: json("commercialSnapshot").$type<SlotSnapshot | null>(),
  technicalSnapshot: json("technicalSnapshot").$type<SlotSnapshot | null>(),

  // Coverage summary
  totalSlotsFilled: int("totalSlotsFilled").notNull().default(0),  // 0-5
  sendReadySlots: int("sendReadySlots").notNull().default(0),       // slots with send_ready contacts
  namedUnverifiedSlots: int("namedUnverifiedSlots").notNull().default(0),
  llmSlots: int("llmSlots").notNull().default(0),

  // Source waterfall used to generate this slate
  sourcesUsed: json("sourcesUsed").$type<string[]>(),  // e.g. ["apollo", "web_search", "hunter_fallback"]

  // Lifecycle
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
  generatedBy: mysqlEnum("generatedBy", ["waterfall_engine", "manual", "admin"]).notNull().default("waterfall_engine"),
  isStale: boolean("isStale").notNull().default(false),  // true when contacts have changed since generation
  staleSince: timestamp("staleSince"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ContactCandidateSlate = typeof contactCandidateSlates.$inferSelect;
export type InsertContactCandidateSlate = typeof contactCandidateSlates.$inferInsert;

/**
 * Snapshot type for a single slate slot — stored as JSON in contactCandidateSlates.
 * Avoids N+1 joins when rendering the slate card.
 */
export interface SlotSnapshot {
  contactId: number;
  name: string;
  title: string;
  company: string;
  email: string | null;
  linkedin: string | null;
  enrichmentSource: string;
  contactTrustTier: "send_ready" | "named_unverified" | "llm_inferred";
  confidenceScore: string;
  roleRelevance: string;
  roleLane: "primary" | "commercial" | "technical" | "backup";
}

/**
 * hunterVerificationLog — tracks every Hunter.io API call for named_unverified contacts.
 * Hunter is ONLY used as a fallback verifier for already-named people, not for discovery.
 */
export const hunterVerificationLog = mysqlTable("hunterVerificationLog", {
  id: int("id").autoincrement().primaryKey(),
  contactId: int("contactId").notNull(),
  projectId: int("projectId"),

  // What was queried
  queryType: mysqlEnum("queryType", [
    "email_finder",     // Hunter Email Finder: first + last + domain → email
    "email_verifier",   // Hunter Email Verifier: verify an existing email address
  ]).notNull(),
  queryInput: json("queryInput").$type<Record<string, string>>(),  // { firstName, lastName, domain } or { email }

  // Hunter response
  hunterStatus: varchar("hunterStatus", { length: 32 }),   // valid | accept_all | unknown | invalid
  hunterConfidence: int("hunterConfidence"),                // 0-100
  emailFound: varchar("emailFound", { length: 320 }),       // email returned by Hunter (if any)
  hunterSources: json("hunterSources").$type<string[]>(),   // source URLs Hunter used

  // What happened as a result
  contactUpdated: boolean("contactUpdated").notNull().default(false),
  tierPromoted: boolean("tierPromoted").notNull().default(false),  // true if contact moved to send_ready

  // Cost tracking
  apiCreditsUsed: int("apiCreditsUsed").notNull().default(1),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type HunterVerificationLogRow = typeof hunterVerificationLog.$inferSelect;
export type InsertHunterVerificationLog = typeof hunterVerificationLog.$inferInsert;

/**
 * lushaEnrichmentLog — tracks every Lusha API call (Stage 4 fallback).
 * Lusha is the last-resort enrichment for HOLD reps with contact gaps on
 * top visible, commercially sensible, high-fit projects.
 * Budget: 10 credits/day. Cooldown: 14 days per project.
 */
export const lushaEnrichmentLog = mysqlTable("lushaEnrichmentLog", {
  id: int("id").autoincrement().primaryKey(),
  contactId: int("contactId").notNull(),
  projectId: int("projectId").notNull(),
  queryInput: json("queryInput").$type<Record<string, string>>(),
  emailFound: varchar("emailFound", { length: 320 }),
  phoneFound: varchar("phoneFound", { length: 64 }),
  titleFound: varchar("titleFound", { length: 256 }),
  status: mysqlEnum("lushaStatus", ["enriched", "not_found", "failed"]).notNull(),
  contactPromoted: boolean("contactPromoted").notNull().default(false),
  creditsUsed: int("creditsUsed").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type LushaEnrichmentLogRow = typeof lushaEnrichmentLog.$inferSelect;
export type InsertLushaEnrichmentLog = typeof lushaEnrichmentLog.$inferInsert;

/**
 * projectValidationGates — per-project validation decisions by admin/rep.
 * Controls whether a project's primary contact, backup contacts, and digest
 * inclusion are approved. Set after reviewing the candidate slate.
 */
export const projectValidationGates = mysqlTable("projectValidationGates", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull().unique(),
  primaryAcceptable: boolean("primaryAcceptable").default(false).notNull(),
  backupAcceptable: boolean("backupAcceptable").default(false).notNull(),
  digestSafe: boolean("digestSafe").default(false).notNull(),
  gateSetBy: varchar("gateSetBy", { length: 255 }),
  gateSetAt: timestamp("gateSetAt"),
  gateNote: text("gateNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProjectValidationGate = typeof projectValidationGates.$inferSelect;
export type InsertProjectValidationGate = typeof projectValidationGates.$inferInsert;

/**
 * digestSendControl — global digest send gate.
 * The first live digest send requires a manual preview/review cycle.
 * Once an admin approves the first send, automatic sends are enabled.
 * This prevents the digest from firing automatically the first time
 * the territory threshold is met, even if all quality gates pass.
 */
export const digestSendControl = mysqlTable("digestSendControl", {
  id: int("id").autoincrement().primaryKey(),
  territory: varchar("territory", { length: 32 }).notNull(),  // e.g. "WA", "QLD", "NSW"
  /** Whether the first send has been manually previewed and approved */
  firstSendApproved: boolean("firstSendApproved").notNull().default(false),
  /** Timestamp when the first send was approved */
  firstSendApprovedAt: timestamp("firstSendApprovedAt"),
  /** Who approved the first send */
  firstSendApprovedBy: varchar("firstSendApprovedBy", { length: 255 }),
  /** Whether automatic sends are now enabled (set to true after first approved cycle) */
  autoSendEnabled: boolean("autoSendEnabled").notNull().default(false),
  /** Last digest preview generated (dry-run) */
  lastPreviewAt: timestamp("lastPreviewAt"),
  /** Last live digest sent */
  lastLiveSendAt: timestamp("lastLiveSendAt"),
  /** Total live sends completed */
  liveSendCount: int("liveSendCount").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type DigestSendControl = typeof digestSendControl.$inferSelect;
export type InsertDigestSendControl = typeof digestSendControl.$inferInsert;

/**
 * repDigestGateResults — per-rep, per-week gate decision log.
 * Stores the SEND/HOLD decision with full evidence for operator visibility.
 * Written by digestHardeningGates.ts after each pipeline run and before each digest send.
 */
export const repDigestGateResults = mysqlTable("repDigestGateResults", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  weekKey: varchar("weekKey", { length: 16 }).notNull(), // e.g. "2026-W19"
  decision: varchar("decision", { length: 8 }).notNull(), // "SEND" | "HOLD"
  /** JSON array of RepGateBlocker objects */
  blockers: json("blockers"),
  /** JSON array of top 3 project snapshot */
  top3Snapshot: json("top3Snapshot"),
  /** Whether a rescue pass was attempted for this rep this week */
  rescueAttempted: boolean("rescueAttempted").notNull().default(false),
  /** JSON of RescueTriggerResult if rescue was attempted */
  rescueResult: json("rescueResult"),
  /** JSON of DeltaComparison if delta gate ran */
  deltaComparison: json("deltaComparison"),
  /** Phase: "post_pipeline" | "pre_digest" | "manual" */
  phase: varchar("phase", { length: 16 }).notNull().default("pre_digest"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type RepDigestGateResult = typeof repDigestGateResults.$inferSelect;
export type InsertRepDigestGateResult = typeof repDigestGateResults.$inferInsert;

// ─── System Key-Value Store ───────────────────────────────────────────────────
/**
 * Lightweight persistent key-value store for system state that must survive
 * server restarts (e.g., notification cooldown timestamps, ops flags).
 */
export const systemKv = mysqlTable("systemKv", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type SystemKv = typeof systemKv.$inferSelect;

// ─── Account Priors (Pump/Flow Lane) ──────────────────────────────────────────
/**
 * Priority account library for account-first selling motions.
 * Imported from the WA Pump / Portable Flow Top 100 target list.
 * Used to boost lane scoring when a project's owner/contractor matches a priority account.
 */
export const accountPriors = mysqlTable("accountPriors", {
  id: int("id").autoincrement().primaryKey(),
  rank: int("rank"),
  canonicalName: varchar("canonicalName", { length: 256 }).notNull(),
  aliases: json("aliases").$type<string[]>(),
  state: varchar("state", { length: 256 }),
  segment: varchar("segment", { length: 256 }),
  scoreOutOf100: float("scoreOutOf100"),
  priorityLevel: varchar("priorityLevel", { length: 32 }),
  productFit: text("productFit"),
  likelyApplication: text("likelyApplication"),
  whyTarget: text("whyTarget"),
  firstSalesAction: text("firstSalesAction"),
  suggestedOpeningAngle: text("suggestedOpeningAngle"),
  confidenceLevel: varchar("confidenceLevel", { length: 16 }),
  existingHistory: text("existingHistory"),
  salesNotes: text("salesNotes"),
  pumpSalesLC: decimal("pumpSalesLC", { precision: 14, scale: 2 }),
  pumpQtySince2021: int("pumpQtySince2021"),
  latestPumpSaleYear: int("latestPumpSaleYear"),
  crmRecordsGrouped: int("crmRecordsGrouped"),
  crmRoles: varchar("crmRoles", { length: 256 }),
  crmTypes: varchar("crmTypes", { length: 256 }),
  phone: varchar("phone", { length: 64 }),
  email: varchar("email", { length: 320 }),
  lane: varchar("lane", { length: 32 }).notNull().default("pump"),
  status: varchar("status", { length: 32 }).notNull().default("not_started"),
  owner: varchar("owner", { length: 256 }),
  nextActionDate: timestamp("nextActionDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AccountPrior = typeof accountPriors.$inferSelect;
export type InsertAccountPrior = typeof accountPriors.$inferInsert;

// ─── Full Potential module ────────────────────────────────────────────────────
// Kept in a separate file for readability; re-exported here so Drizzle Kit
// discovers all tables through the single drizzle.config.ts entrypoint.
export * from "./fullPotentialSchema";
