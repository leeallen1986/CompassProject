import { int, json, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean } from "drizzle-orm/mysql-core";

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
  sourcesSearched: varchar("sourcesSearched", { length: 16 }).notNull().default("20+"),
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
  enrichmentSource: mysqlEnum("enrichmentSource", ["linkedin", "llm", "manual", "apollo"]).default("linkedin"),
  enrichedAt: timestamp("enrichedAt"),
  linkedinHeadline: varchar("linkedinHeadline", { length: 512 }),
  linkedinLocation: varchar("linkedinLocation", { length: 256 }),
  linkedinProfilePic: varchar("linkedinProfilePic", { length: 1024 }),
  verificationStatus: mysqlEnum("verificationStatus", ["verified", "ai_suggested", "unverified"]).default("unverified"),
  confidenceScore: mysqlEnum("confidenceScore", ["high", "medium", "low"]).default("medium"),
  linkedinSearchUrl: varchar("linkedinSearchUrl", { length: 1024 }),
  linkedinProfileUrl: varchar("linkedinProfileUrl", { length: 1024 }),
  verificationScore: int("verificationScore").default(0),
  emailVerified: boolean("emailVerified").default(false),
  verifiedByUserId: int("verifiedByUserId"),
  verifiedAt: timestamp("verifiedAt"),
  verifiedLinkedinUrl: varchar("verifiedLinkedinUrl", { length: 1024 }),
  rejectedByUserId: int("rejectedByUserId"),
  rejectedAt: timestamp("rejectedAt"),
  rejectionReason: varchar("rejectionReason", { length: 256 }),
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
  projectId: int("projectId").notNull(),
  reportId: int("reportId").notNull(),
  status: mysqlEnum("status", ["identified", "contacted", "meeting_booked", "quoted", "won", "lost"]).notNull().default("identified"),
  notes: text("notes"),
  estimatedValue: varchar("estimatedValue", { length: 64 }),
  nextAction: varchar("nextAction", { length: 512 }),
  nextActionDate: timestamp("nextActionDate"),
  contactName: varchar("contactName", { length: 256 }),
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
  subject: varchar("subject", { length: 512 }).notNull(),
  body: text("body").notNull(),
  tone: mysqlEnum("tone", ["professional", "consultative", "direct"]).notNull(),
  status: mysqlEnum("status", ["drafted", "opened_in_email", "sent"]).notNull().default("drafted"),
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
  tone: mysqlEnum("tone", ["professional", "consultative", "direct"]).notNull(),
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
});

export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type InsertPipelineRun = typeof pipelineRuns.$inferInsert;
