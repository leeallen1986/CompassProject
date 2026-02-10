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
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Contact = typeof contacts.$inferSelect;
export type InsertContact = typeof contacts.$inferInsert;

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
