import { eq, desc, and, ne, lt, sql, inArray, isNull, or } from "drizzle-orm";
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

export async function getActiveProjects() {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(projects)
    .where(or(
      eq(projects.lifecycleStatus, "active"),
      isNull(projects.lifecycleStatus)
    ))
    .orderBy(desc(projects.id));
}

export async function updateProjectLifecycle(
  projectId: number,
  status: "active" | "stale" | "archived" | "awarded" | "completed",
  userId?: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: Record<string, unknown> = {
    lifecycleStatus: status,
  };

  if (status === "archived") {
    updateData.archivedBy = userId ?? null;
    updateData.archivedAt = new Date();
  } else if (status === "active") {
    // Restoring from archived/stale
    updateData.archivedBy = null;
    updateData.archivedAt = null;
    updateData.lastActivityAt = new Date();
  }

  await db.update(projects).set(updateData).where(eq(projects.id, projectId));
}

export async function bulkUpdateProjectLifecycle(
  projectIds: number[],
  status: "active" | "stale" | "archived" | "awarded" | "completed",
  userId?: number
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (projectIds.length === 0) return 0;

  const updateData: Record<string, unknown> = {
    lifecycleStatus: status,
  };

  if (status === "archived") {
    updateData.archivedBy = userId ?? null;
    updateData.archivedAt = new Date();
  } else if (status === "active") {
    updateData.archivedBy = null;
    updateData.archivedAt = null;
    updateData.lastActivityAt = new Date();
  }

  const result = await db.update(projects).set(updateData).where(inArray(projects.id, projectIds));
  return projectIds.length;
}

/**
 * Mark projects as stale if they have no pipeline claims and were created > 30 days ago
 * with no recent activity. Skips projects that are already archived, awarded, or completed.
 */
export async function markStaleProjects(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Get all active projects older than 30 days
  const oldActiveProjects = await db.select({ id: projects.id })
    .from(projects)
    .where(and(
      eq(projects.lifecycleStatus, "active"),
      lt(projects.createdAt, thirtyDaysAgo),
      or(
        isNull(projects.lastActivityAt),
        lt(projects.lastActivityAt, thirtyDaysAgo)
      )
    ));

  if (oldActiveProjects.length === 0) return 0;

  // Get projects that have active pipeline claims (these should stay active)
  const claimedProjectIds = await db.select({ projectId: pipelineClaims.projectId })
    .from(pipelineClaims)
    .where(and(
      inArray(pipelineClaims.projectId, oldActiveProjects.map(p => p.id)),
      ne(pipelineClaims.status, "lost")
    ));

  const claimedSet = new Set(claimedProjectIds.map(c => c.projectId));
  const staleIds = oldActiveProjects
    .filter(p => !claimedSet.has(p.id))
    .map(p => p.id);

  if (staleIds.length === 0) return 0;

  await db.update(projects)
    .set({ lifecycleStatus: "stale" })
    .where(inArray(projects.id, staleIds));

  return staleIds.length;
}

/**
 * Touch a project's lastActivityAt timestamp (called when someone interacts with it)
 */
export async function touchProjectActivity(projectId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.update(projects)
    .set({ lastActivityAt: new Date(), lifecycleStatus: "active" })
    .where(eq(projects.id, projectId));
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

// ── Crowdsourced Contact Verification ──

/**
 * Mark a contact as verified by a sales rep.
 * Updates verification status, score, and optionally the LinkedIn profile URL.
 */
export async function verifyContactByUser(
  contactId: number,
  userId: number,
  linkedinUrl?: string | null,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: Record<string, any> = {
    verificationStatus: "verified",
    verifiedByUserId: userId,
    verifiedAt: new Date(),
    confidenceScore: "high",
    rejectedByUserId: null,
    rejectedAt: null,
    rejectionReason: null,
  };

  // If a LinkedIn URL was provided, store it and boost the score
  if (linkedinUrl) {
    updateData.verifiedLinkedinUrl = linkedinUrl;
    // If it's a direct profile URL, also update the main linkedin field
    if (linkedinUrl.includes("/in/")) {
      updateData.linkedinProfileUrl = linkedinUrl;
    }
  }

  await db.update(contacts).set(updateData).where(eq(contacts.id, contactId));

  // Recompute verification score with the updated status
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (contact) {
    const { computeVerificationScore } = await import("./verificationScoring");
    const score = computeVerificationScore(contact);
    await db.update(contacts).set({ verificationScore: score.total }).where(eq(contacts.id, contactId));
  }

  return { success: true };
}

/**
 * Mark a contact as rejected/incorrect by a sales rep.
 */
export async function rejectContactByUser(
  contactId: number,
  userId: number,
  reason?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(contacts).set({
    rejectedByUserId: userId,
    rejectedAt: new Date(),
    rejectionReason: reason || "Incorrect contact",
    confidenceScore: "low",
    verificationScore: 10,
  }).where(eq(contacts.id, contactId));

  return { success: true };
}

/**
 * Get verification stats for the admin dashboard.
 */
export async function getVerificationStats() {
  const db = await getDb();
  if (!db) return { total: 0, verified: 0, rejected: 0, pending: 0, topVerifiers: [] };

  const [stats] = await db.select({
    total: sql<number>`COUNT(*)`,
    verified: sql<number>`SUM(CASE WHEN ${contacts.verifiedByUserId} IS NOT NULL THEN 1 ELSE 0 END)`,
    rejected: sql<number>`SUM(CASE WHEN ${contacts.rejectedByUserId} IS NOT NULL THEN 1 ELSE 0 END)`,
    pending: sql<number>`SUM(CASE WHEN ${contacts.verifiedByUserId} IS NULL AND ${contacts.rejectedByUserId} IS NULL AND ${contacts.verificationStatus} = 'ai_suggested' THEN 1 ELSE 0 END)`,
  }).from(contacts);

  // Top verifiers (users who verified the most contacts)
  const topVerifiers = await db.select({
    userId: contacts.verifiedByUserId,
    userName: users.name,
    count: sql<number>`COUNT(*)`,
  })
    .from(contacts)
    .leftJoin(users, eq(contacts.verifiedByUserId, users.id))
    .where(sql`${contacts.verifiedByUserId} IS NOT NULL`)
    .groupBy(contacts.verifiedByUserId, users.name)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(10);

  return {
    total: Number(stats?.total || 0),
    verified: Number(stats?.verified || 0),
    rejected: Number(stats?.rejected || 0),
    pending: Number(stats?.pending || 0),
    topVerifiers,
  };
}
