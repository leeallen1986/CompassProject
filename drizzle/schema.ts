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
