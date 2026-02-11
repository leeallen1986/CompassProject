import { eq, desc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  reports, InsertReport, Report,
  projects, InsertProject,
  contacts, InsertContact,
  drillingCampaigns, InsertDrillingCampaign,
  awardedProjects, InsertAwardedProject,
  userProfiles, InsertUserProfile, UserProfile,
  projectFeedback, InsertProjectFeedback,
  pipelineClaims, InsertPipelineClaim, PipelineClaim,
  pipelineActivity, InsertPipelineActivity,
  emailDigestPrefs, InsertEmailDigestPref, EmailDigestPref,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ── User helpers ──

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ── Report helpers ──

export async function createReport(data: InsertReport): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(reports).values(data);
  return Number(result[0].insertId);
}

export async function getLatestReport() {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(reports).orderBy(desc(reports.id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getAllReports() {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(reports).orderBy(desc(reports.id));
}

export async function getReportById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// ── Project helpers ──

export async function createProjects(data: InsertProject[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return;

  await db.insert(projects).values(data);
}

export async function getProjectsByReportId(reportId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(projects).where(eq(projects.reportId, reportId));
}

export async function getAllProjects() {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(projects).orderBy(desc(projects.id));
}

// ── Contact helpers ──

export async function createContacts(data: InsertContact[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return;

  await db.insert(contacts).values(data);
}

export async function getContactsByReportId(reportId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(contacts).where(eq(contacts.reportId, reportId));
}

export async function getAllContacts() {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(contacts).orderBy(desc(contacts.id));
}

export async function getAllDrillingCampaigns() {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(drillingCampaigns).orderBy(desc(drillingCampaigns.id));
}

export async function getAllAwardedProjects() {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(awardedProjects).orderBy(desc(awardedProjects.id));
}

// ── Drilling campaign helpers ──

export async function createDrillingCampaigns(data: InsertDrillingCampaign[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return;

  await db.insert(drillingCampaigns).values(data);
}

export async function getDrillingCampaignsByReportId(reportId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(drillingCampaigns).where(eq(drillingCampaigns.reportId, reportId));
}

// ── Awarded project helpers ──

export async function createAwardedProjects(data: InsertAwardedProject[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return;

  await db.insert(awardedProjects).values(data);
}

export async function getAwardedProjectsByReportId(reportId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(awardedProjects).where(eq(awardedProjects.reportId, reportId));
}

// ── User Profile helpers ──

export async function getProfileByUserId(userId: number): Promise<UserProfile | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertProfile(userId: number, data: Partial<InsertUserProfile>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getProfileByUserId(userId);
  if (existing) {
    await db.update(userProfiles).set(data).where(eq(userProfiles.userId, userId));
  } else {
    await db.insert(userProfiles).values({ ...data, userId });
  }
}

export async function completeOnboarding(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(userProfiles).set({ onboardingCompleted: true }).where(eq(userProfiles.userId, userId));
}

// ── Project Feedback helpers ──

export async function upsertFeedback(data: InsertProjectFeedback): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if feedback already exists for this user + project
  const existing = await db.select().from(projectFeedback)
    .where(and(
      eq(projectFeedback.userId, data.userId),
      eq(projectFeedback.projectId, data.projectId)
    ))
    .limit(1);

  if (existing.length > 0) {
    await db.update(projectFeedback)
      .set({ vote: data.vote, reason: data.reason })
      .where(eq(projectFeedback.id, existing[0].id));
  } else {
    await db.insert(projectFeedback).values(data);
  }
}

export async function getFeedbackByUserAndReport(userId: number, reportId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(projectFeedback)
    .where(and(
      eq(projectFeedback.userId, userId),
      eq(projectFeedback.reportId, reportId)
    ));
}

export async function getAllFeedbackByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(projectFeedback)
    .where(eq(projectFeedback.userId, userId));
}

// ── Pipeline Claim helpers ──

export async function createPipelineClaim(data: InsertPipelineClaim): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(pipelineClaims).values(data);
  return Number(result[0].insertId);
}

export async function getPipelineClaimById(id: number): Promise<PipelineClaim | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(pipelineClaims).where(eq(pipelineClaims.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getPipelineClaimsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(pipelineClaims)
    .where(eq(pipelineClaims.userId, userId))
    .orderBy(desc(pipelineClaims.updatedAt));
}

export async function getPipelineClaimsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(pipelineClaims)
    .where(eq(pipelineClaims.projectId, projectId));
}

export async function getAllPipelineClaims() {
  const db = await getDb();
  if (!db) return [];

  return db.select({
    claim: pipelineClaims,
    userName: users.name,
    userEmail: users.email,
  })
    .from(pipelineClaims)
    .leftJoin(users, eq(pipelineClaims.userId, users.id))
    .orderBy(desc(pipelineClaims.updatedAt));
}

export async function updatePipelineClaim(
  id: number,
  data: Partial<InsertPipelineClaim>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(pipelineClaims).set(data).where(eq(pipelineClaims.id, id));
}

export async function deletePipelineClaim(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(pipelineActivity).where(eq(pipelineActivity.claimId, id));
  await db.delete(pipelineClaims).where(eq(pipelineClaims.id, id));
}

// ── Pipeline Activity helpers ──

export async function createPipelineActivityEntry(data: InsertPipelineActivity): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(pipelineActivity).values(data);
}

export async function getActivityByClaimId(claimId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(pipelineActivity)
    .where(eq(pipelineActivity.claimId, claimId))
    .orderBy(desc(pipelineActivity.createdAt));
}

// ── Email Digest Preferences helpers ──

export async function getEmailDigestPrefs(userId: number): Promise<EmailDigestPref | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(emailDigestPrefs)
    .where(eq(emailDigestPrefs.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertEmailDigestPrefs(
  userId: number,
  data: Partial<InsertEmailDigestPref>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getEmailDigestPrefs(userId);
  if (existing) {
    await db.update(emailDigestPrefs).set(data).where(eq(emailDigestPrefs.userId, userId));
  } else {
    await db.insert(emailDigestPrefs).values({ ...data, userId });
  }
}

export async function getAllEnabledDigestUsers() {
  const db = await getDb();
  if (!db) return [];

  return db.select({
    pref: emailDigestPrefs,
    user: users,
    profile: userProfiles,
  })
    .from(emailDigestPrefs)
    .leftJoin(users, eq(emailDigestPrefs.userId, users.id))
    .leftJoin(userProfiles, eq(emailDigestPrefs.userId, userProfiles.userId))
    .where(eq(emailDigestPrefs.enabled, true));
}
