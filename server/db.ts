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
  projectBusinessLineScores,
  projectActions, InsertProjectAction, ProjectAction,
  pipelineRuns,
  userEmailSendLog,
  contactProjects,
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

// ── All Users helpers (for admin campaign access management) ──

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    authMethod: users.authMethod,
    campaignAccess: users.campaignAccess,
    lastSignedIn: users.lastSignedIn,
  }).from(users).orderBy(users.name);
}

export async function updateUserCampaignAccess(userId: number, campaignAccess: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ campaignAccess }).where(eq(users.id, userId));
  return { success: true };
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

export async function getProjectsByReportId(
  reportId: number,
  opts?: { includeSuppressed?: boolean }
) {
  const db = await getDb();
  if (!db) return [];

  // By default, exclude suppressed projects (macro items, background accounts, etc.)
  // so they never leak into email digests or dashboard views.
  if (opts?.includeSuppressed) {
    return db.select().from(projects).where(eq(projects.reportId, reportId));
  }

  return db.select().from(projects).where(
    and(
      eq(projects.reportId, reportId),
      or(
        eq(projects.suppressed, false),
        isNull(projects.suppressed)
      )
    )
  );
}

export async function getAllProjects() {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(projects).orderBy(desc(projects.id));
}

export async function getActiveProjects(opts?: { includeSuppressed?: boolean }) {
  const db = await getDb();
  if (!db) return [];

  const lifecycleFilter = or(
    eq(projects.lifecycleStatus, "active"),
    isNull(projects.lifecycleStatus)
  );

  if (opts?.includeSuppressed) {
    // Admin view: show all lifecycle-active projects regardless of suppression
    return db.select().from(projects)
      .where(lifecycleFilter)
      .orderBy(desc(projects.id));
  }

  // Default rep view: exclude suppressed projects (macro items, background accounts, completed, etc.)
  return db.select().from(projects)
    .where(and(
      lifecycleFilter,
      or(
        eq(projects.suppressed, false),
        isNull(projects.suppressed)
      )
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
 * Stage 5A: Mark projects as stale or archived based on sourceLastSeenAt (primary freshness
 * signal) with lastActivityAt and createdAt as fallbacks.
 *
 * Thresholds:
 *   - stale:   no source corroboration for 60+ days
 *   - archived: no source corroboration for 180+ days
 *
 * Exemptions (never touched by this function):
 *   - projects with an active pipeline claim
 *   - projects with keepFlag = true
 *   - projects already archived, awarded, or completed
 *
 * Freshness resolution order:
 *   1. sourceLastSeenAt  (set by pipeline whenever a source mentions the project)
 *   2. lastActivityAt    (set by user interactions and enrichment)
 *   3. createdAt         (fallback — used only when neither above is set)
 */
export async function markStaleProjects(): Promise<{ staled: number; archived: number }> {
  const db = await getDb();
  if (!db) return { staled: 0, archived: 0 };

  const now = Date.now();
  const sixtyDaysAgo     = new Date(now - 60  * 24 * 60 * 60 * 1000);
  const oneEightyDaysAgo = new Date(now - 180 * 24 * 60 * 60 * 1000);

  // ── 1. Fetch all non-terminal active/stale projects ──
  const candidates = await db.select({
    id:               projects.id,
    lifecycleStatus:  projects.lifecycleStatus,
    sourceLastSeenAt: projects.sourceLastSeenAt,
    lastActivityAt:   projects.lastActivityAt,
    createdAt:        projects.createdAt,
    keepFlag:         projects.keepFlag,
  })
    .from(projects)
    .where(inArray(projects.lifecycleStatus, ["active", "stale"]));

  if (candidates.length === 0) return { staled: 0, archived: 0 };

  // ── 2. Fetch projects with active pipeline claims ──
  const claimedRows = await db.select({ projectId: pipelineClaims.projectId })
    .from(pipelineClaims)
    .where(and(
      inArray(pipelineClaims.projectId, candidates.map(p => p.id)),
      ne(pipelineClaims.status, "lost")
    ));
  const claimedSet = new Set(claimedRows.map(c => c.projectId));

  // ── 3. Classify each candidate ──
  const toArchive: number[] = [];
  const toStale:   number[] = [];

  for (const p of candidates) {
    // Never touch claimed or keep-flagged projects
    if (claimedSet.has(p.id) || p.keepFlag) continue;

    // Resolve effective freshness date
    const freshness: Date = p.sourceLastSeenAt ?? p.lastActivityAt ?? p.createdAt;

    if (freshness < oneEightyDaysAgo) {
      toArchive.push(p.id);
    } else if (freshness < sixtyDaysAgo && p.lifecycleStatus === "active") {
      toStale.push(p.id);
    }
  }

  // ── 4. Apply updates ──
  const nowDate = new Date();
  if (toArchive.length > 0) {
    await db.update(projects)
      .set({
        lifecycleStatus: "archived",
        archivedAt:  nowDate,
        staleReason: "No source corroboration for 180+ days (Stage 5A auto-archive)",
      })
      .where(inArray(projects.id, toArchive));
  }
  if (toStale.length > 0) {
    await db.update(projects)
      .set({
        lifecycleStatus: "stale",
        staleReason: "No source corroboration for 60+ days (Stage 5A auto-stale)",
      })
      .where(inArray(projects.id, toStale));
  }

  return { staled: toStale.length, archived: toArchive.length };
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

/**
 * Stage 5A: Update sourceLastSeenAt for a project (called whenever a pipeline source
 * mentions or corroborates the project). Also re-activates stale projects.
 *
 * @param projectId  - the project to touch
 * @param reactivate - if true, also set lifecycleStatus back to 'active' (default: true)
 */
export async function touchProjectSourceSeen(
  projectId: number,
  reactivate = true
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const updateData: Record<string, unknown> = {
    sourceLastSeenAt: new Date(),
  };
  if (reactivate) {
    updateData.lifecycleStatus = "active";
    updateData.staleReason = null;
  }

  await db.update(projects)
    .set(updateData)
    .where(eq(projects.id, projectId));
}

/**
 * Stage 5A: Set or clear the keepFlag for a project.
 * Projects with keepFlag=true are never auto-staled or auto-archived.
 */
export async function setProjectKeepFlag(
  projectId: number,
  keep: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.update(projects)
    .set({ keepFlag: keep })
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

export async function getAllContacts(includeAll = false) {
  const db = await getDb();
  if (!db) return [];

  if (includeAll) {
    // Admin view: return all contacts
    return db.select().from(contacts).orderBy(desc(contacts.id));
  }

  // Quality filter: only return contacts with score >= 60 or LinkedIn-verified
  // This prevents low-quality LLM hallucinations from reaching the sales team
  return db.select().from(contacts)
    .where(
      sql`(${contacts.verificationScore} >= 60 OR ${contacts.enrichmentSource} = 'linkedin' OR ${contacts.verificationStatus} = 'verified')`
    )
    .orderBy(desc(contacts.id));
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

/**
 * Get ALL users who have a profile set up (completed onboarding).
 * Used for compulsory digest emails — no opt-in required.
 * Returns user + profile data for personalization.
 */
export async function getAllUsersWithProfiles() {
  const db = await getDb();
  if (!db) return [];

  return db.select({
    user: users,
    profile: userProfiles,
  })
    .from(userProfiles)
    .innerJoin(users, eq(userProfiles.userId, users.id));
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

// ─────────────────────────────────────────────────────────────────────────────
// Stage 5C: Duplicate detection and merge helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a simple token-overlap similarity between two strings.
 * Returns 0.0–1.0. Tokens are lower-cased words ≥ 3 chars, stop-words removed.
 */
export function tokenSimilarity(a: string, b: string): number {
  const STOP = new Set(["the", "and", "for", "with", "project", "stage", "phase", "new", "australia", "australian"]);
  const tokenise = (s: string) =>
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 3 && !STOP.has(t));
  const ta = new Set(tokenise(a));
  const tb = new Set(tokenise(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  const intersection = Array.from(ta).filter(t => tb.has(t)).length;
  return intersection / Math.max(ta.size, tb.size);
}

/**
 * Extract the state code from a location string (e.g. "Perth, WA" → "WA").
 */
export function extractStateCode(location: string): string | null {
  const STATES = ["WA", "NSW", "VIC", "QLD", "SA", "TAS", "NT", "ACT"];
  const upper = location.toUpperCase();
  return STATES.find(s => upper.includes(s)) ?? null;
}

export type DuplicateCluster = {
  clusterId: string;
  projects: Array<{
    id: number;
    name: string;
    location: string;
    lifecycleStatus: string;
    priority: string;
    createdAt: Date;
    duplicateClusterId: string | null;
    duplicateDismissed: boolean | null;
    mergedIntoId: number | null;
  }>;
  similarity: number;
  dismissed: boolean;
};

/**
 * Scan all active + stale projects and return clusters of near-duplicates.
 * Uses token-overlap similarity on project names with optional state-code match.
 * Threshold: similarity >= 0.55 AND (same state OR one/both are "National").
 *
 * This is a pure in-memory scan — no DB writes. Call assignDuplicateCluster
 * separately to persist cluster IDs.
 */
export async function findDuplicateClusters(similarityThreshold = 0.55): Promise<DuplicateCluster[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      location: projects.location,
      lifecycleStatus: projects.lifecycleStatus,
      priority: projects.priority,
      createdAt: projects.createdAt,
      duplicateClusterId: projects.duplicateClusterId,
      duplicateDismissed: projects.duplicateDismissed,
      mergedIntoId: projects.mergedIntoId,
    })
    .from(projects)
    .where(
      and(
        sql`${projects.lifecycleStatus} IN ('active', 'stale')`,
        isNull(projects.mergedIntoId),
      )
    );

  // Build clusters using union-find
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) return x;
    const root = find(parent.get(x)!);
    parent.set(x, root);
    return root;
  };
  const union = (x: number, y: number) => {
    const rx = find(x), ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };

  const pairSimilarities = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      const sim = tokenSimilarity(a.name, b.name);
      if (sim < similarityThreshold) continue;
      const stateA = extractStateCode(a.location);
      const stateB = extractStateCode(b.location);
      const sameState = stateA && stateB && stateA === stateB;
      const eitherNational = a.location.toLowerCase().includes("national") || b.location.toLowerCase().includes("national");
      if (!sameState && !eitherNational) continue;
      union(a.id, b.id);
      pairSimilarities.set(`${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`, sim);
    }
  }

  // Group into clusters
  const clusterMap = new Map<number, typeof rows>();
  for (const row of rows) {
    const root = find(row.id);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root)!.push(row);
  }

  const clusters: DuplicateCluster[] = [];
  for (const [root, members] of Array.from(clusterMap.entries())) {
    if (members.length < 2) continue;
    // Compute average similarity across all pairs in cluster
    let simSum = 0, simCount = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = `${Math.min(members[i].id, members[j].id)}-${Math.max(members[i].id, members[j].id)}`;
        simSum += pairSimilarities.get(key) ?? 0;
        simCount++;
      }
    }
    const avgSim = simCount > 0 ? simSum / simCount : 0;
    const dismissed = members.some((m: { duplicateDismissed: boolean | null }) => m.duplicateDismissed);
    // Use existing clusterId if already assigned, else derive from root id
    const existingId = members.find((m: { duplicateClusterId: string | null }) => m.duplicateClusterId)?.duplicateClusterId;
    const clusterId = existingId ?? `cluster-${root}`;
    clusters.push({ clusterId, projects: members, similarity: avgSim, dismissed });
  }

  return clusters.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Assign a duplicateClusterId to all projects in a cluster.
 */
export async function assignDuplicateCluster(projectIds: number[], clusterId: string): Promise<void> {
  const db = await getDb();
  if (!db || projectIds.length === 0) return;
  await db.update(projects)
    .set({ duplicateClusterId: clusterId })
    .where(inArray(projects.id, projectIds));
}

/**
 * Mark all projects in a cluster as dismissed (not real duplicates).
 */
export async function dismissDuplicateCluster(projectIds: number[]): Promise<void> {
  const db = await getDb();
  if (!db || projectIds.length === 0) return;
  await db.update(projects)
    .set({ duplicateDismissed: true })
    .where(inArray(projects.id, projectIds));
}

/**
 * Merge a duplicate project into a canonical project.
 * - Sets mergedIntoId on the duplicate
 * - Sets lifecycleStatus to 'archived' on the duplicate
 * - Reassigns pipelineClaims from duplicate to canonical
 */
export async function mergeProjectIntoCanonical(
  duplicateId: number,
  canonicalId: number,
  mergedByUserId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Mark duplicate as merged + archived
  await db.update(projects)
    .set({
      mergedIntoId: canonicalId,
      lifecycleStatus: "archived",
      archivedBy: mergedByUserId,
      archivedAt: new Date(),
      staleReason: `Merged into project #${canonicalId}`,
    })
    .where(eq(projects.id, duplicateId));

  // Reassign pipeline claims to canonical
  await db.update(pipelineClaims)
    .set({ projectId: canonicalId } as any)
    .where(eq((pipelineClaims as any).projectId, duplicateId));
}

/**
 * Run the full duplicate detection sweep and persist cluster IDs for any
 * newly detected clusters. Returns the count of new cluster assignments.
 */
export async function runDuplicateDetectionSweep(): Promise<{ clustersFound: number; newAssignments: number }> {
  const clusters = await findDuplicateClusters();
  let newAssignments = 0;
  for (const cluster of clusters) {
    if (cluster.dismissed) continue;
    const unassigned = cluster.projects.filter(p => !p.duplicateClusterId);
    if (unassigned.length === 0) continue;
    await assignDuplicateCluster(
      cluster.projects.map(p => p.id),
      cluster.clusterId,
    );
    newAssignments += unassigned.length;
  }
  return { clustersFound: clusters.length, newAssignments };
}


// ─────────────────────────────────────────────────────────────────────────────
// STAGE 5D — PROJECT TYPE + STAGE NORMALIZATION + SUPPRESSION
// ─────────────────────────────────────────────────────────────────────────────

export type ProjectTypeValue = "opportunity" | "background_account" | "macro_item" | "program_wrapper";
export type StageCodeValue =
  | "exploration" | "feasibility" | "planning" | "design" | "procurement"
  | "awarded" | "construction" | "commissioning" | "operational"
  | "completed" | "cancelled" | "unknown";

export interface ClassificationResult {
  projectType: ProjectTypeValue;
  stageCode: StageCodeValue;
  stageConfidence: number;
  suppressed: boolean;
  suppressionReason: string | null;
}

// ── Stage code normalisation ──────────────────────────────────────────────────

/**
 * Map a free-text stage string to a normalised StageCodeValue.
 * Returns { code, confidence } where confidence reflects how clearly
 * the source text matched a known pattern.
 */
export function normalizeStageCode(stage: string | null | undefined): { code: StageCodeValue; confidence: number } {
  if (!stage || stage.trim() === "") return { code: "unknown", confidence: 0.3 };
  const s = stage.toLowerCase().trim();

  // ── Completed / Cancelled (terminal — highest priority) ──────────────────
  if (/\bdecommission(ed|ing)?\b/.test(s)) return { code: "cancelled", confidence: 0.95 };
  if (/\bcancell?ed?\b/.test(s)) return { code: "cancelled", confidence: 0.95 };
  if (/\bwithdrawn\b/.test(s)) return { code: "cancelled", confidence: 0.9 };
  if (/\bclosed\b/.test(s) && !/\bclose to\b/.test(s)) return { code: "cancelled", confidence: 0.85 };
  if (/\bfully complete[d]?\b/.test(s)) return { code: "completed", confidence: 0.95 };
  if (/\bcomplete[d]?\s*(and\s*operational|\/\s*operational)?\b/.test(s) && !/\bnear(ing)?\s*complet\b/.test(s) && !/\bearly works near completion\b/.test(s)) return { code: "completed", confidence: 0.9 };
  if (/^completed$/.test(s)) return { code: "completed", confidence: 0.98 };
  if (/\bcommission(ed|ing)?\b/.test(s) && /\bcomplete[d]?\b/.test(s)) return { code: "completed", confidence: 0.9 };
  if (/\bcommission(ed)?\b/.test(s) && !/\bpre-?commission\b/.test(s) && !/\bcommissioning phase\b/.test(s)) return { code: "commissioning", confidence: 0.85 };
  if (/\bcommissioning\b/.test(s)) return { code: "commissioning", confidence: 0.9 };

  // ── Operational ──────────────────────────────────────────────────────────
  if (/\boperational\s*\/\s*(expan|upgrad|extend)/.test(s)) return { code: "operational", confidence: 0.85 };
  if (/\boperational\b/.test(s)) return { code: "operational", confidence: 0.8 };
  if (/\boperating\b/.test(s)) return { code: "operational", confidence: 0.75 };
  if (/\bongoing\s*(operations|production)\b/.test(s)) return { code: "operational", confidence: 0.8 };
  if (/\bramp.?up\b/.test(s) && !/\bpre.?construction\b/.test(s)) return { code: "operational", confidence: 0.7 };

  // ── Construction ─────────────────────────────────────────────────────────
  if (/\bunder\s*construction\b/.test(s)) return { code: "construction", confidence: 0.95 };
  if (/\bconstruction\s*(commenced|started|underway|ongoing|progressing|has\s*begun)\b/.test(s)) return { code: "construction", confidence: 0.95 };
  if (/\bconstruction\b/.test(s) && !/\bpre.?construction\b/.test(s)) return { code: "construction", confidence: 0.85 };
  if (/\bunderway\b/.test(s)) return { code: "construction", confidence: 0.7 };
  if (/\btunnell?ing\b/.test(s)) return { code: "construction", confidence: 0.85 };

  // ── Awarded ───────────────────────────────────────────────────────────────
  if (/\bawarded?\b/.test(s)) return { code: "awarded", confidence: 0.9 };
  if (/\bcontract\s*(award|signed|executed)\b/.test(s)) return { code: "awarded", confidence: 0.9 };
  if (/\bcommitted\b/.test(s)) return { code: "awarded", confidence: 0.75 };

  // ── Procurement / Design ─────────────────────────────────────────────────
  if (/\bprocurement\b/.test(s)) return { code: "procurement", confidence: 0.9 };
  if (/\btender(ing)?\b/.test(s)) return { code: "procurement", confidence: 0.85 };
  if (/\bdesign\s*\/?\s*procurement\b/.test(s)) return { code: "procurement", confidence: 0.85 };
  if (/\bdesign\b/.test(s) && !/\bpre.?design\b/.test(s)) return { code: "design", confidence: 0.8 };

  // ── Planning ─────────────────────────────────────────────────────────────
  if (/\bplanning\s*(and\s*design|\/\s*design|\/\s*early|\/\s*development|\/\s*development)?\b/.test(s)) return { code: "planning", confidence: 0.85 };
  if (/\bpre.?construction\b/.test(s)) return { code: "planning", confidence: 0.8 };
  if (/\bearly\s*works?\b/.test(s)) return { code: "planning", confidence: 0.75 };
  if (/\bdevelopment\s*(\/\s*feasibility|\/\s*planning)?\b/.test(s)) return { code: "planning", confidence: 0.7 };
  if (/\bfunding\s*(secured|committed|approved)\b/.test(s)) return { code: "planning", confidence: 0.7 };
  if (/\bpermits?\s*(secured|approved|received)\b/.test(s)) return { code: "planning", confidence: 0.75 };
  if (/\bfast.?track\b/.test(s)) return { code: "planning", confidence: 0.7 };

  // ── Feasibility ───────────────────────────────────────────────────────────
  if (/\bfeasibility\b/.test(s)) return { code: "feasibility", confidence: 0.9 };
  if (/\benvironmental\s*(approvals?|assessment|impact)\b/.test(s)) return { code: "feasibility", confidence: 0.8 };
  if (/\beia\b/.test(s)) return { code: "feasibility", confidence: 0.8 };
  if (/\bpre.?feasibility\b/.test(s)) return { code: "feasibility", confidence: 0.85 };
  if (/\bscoping\b/.test(s)) return { code: "feasibility", confidence: 0.75 };
  if (/\bproposed\b/.test(s)) return { code: "feasibility", confidence: 0.65 };
  if (/\bconcept\b/.test(s)) return { code: "feasibility", confidence: 0.6 };
  if (/\badvocating?\b/.test(s)) return { code: "feasibility", confidence: 0.55 };

  // ── Exploration ───────────────────────────────────────────────────────────
  if (/\bexploration\b/.test(s)) return { code: "exploration", confidence: 0.9 };
  if (/\bdrilling\b/.test(s) && !/\bdrilling\s*complete\b/.test(s)) return { code: "exploration", confidence: 0.85 };
  if (/\bresource\s*(definition|extension|delineation)\b/.test(s)) return { code: "exploration", confidence: 0.85 };
  if (/\bspudded?\b/.test(s)) return { code: "exploration", confidence: 0.9 };
  if (/\bregional\s*exploration\b/.test(s)) return { code: "exploration", confidence: 0.9 };

  // ── Fallback ──────────────────────────────────────────────────────────────
  return { code: "unknown", confidence: 0.3 };
}

// ── Stage confidence scoring ──────────────────────────────────────────────────

/**
 * Compute stageConfidence (0.0–1.0) for a project.
 *
 * Factors:
 *  - Base confidence from normalizeStageCode
 *  - +0.10 if a named owner is present (not generic/unknown)
 *  - +0.10 if at least one named contractor is present
 *  - +0.05 if sources array is non-empty
 *  - +0.05 if priority is 'hot'
 *  - -0.10 if owner is generic/unknown
 *  - -0.15 if stageCode is 'unknown'
 *
 * Result is clamped to [0.05, 0.99].
 */
export function computeStageConfidence(params: {
  stage: string | null | undefined;
  owner: string | null | undefined;
  contractors?: { name: string; status: string }[] | null;
  sources?: { label: string; url: string }[] | null;
  priority?: string | null;
}): number {
  const { code, confidence: base } = normalizeStageCode(params.stage);
  let score = base;

  const genericOwners = new Set(["unknown", "n/a", "tbc", "tbd", "various", "multiple", "national electricity market (nem)"]);
  const ownerLower = (params.owner ?? "").toLowerCase().trim();
  if (ownerLower && !genericOwners.has(ownerLower) && !ownerLower.startsWith("various") && !ownerLower.startsWith("multiple")) {
    score += 0.10;
  } else if (!ownerLower || genericOwners.has(ownerLower)) {
    score -= 0.10;
  }

  if (params.contractors && params.contractors.length > 0) {
    const namedContractors = params.contractors.filter(c => c.name && c.name.toLowerCase() !== "unknown" && c.name.toLowerCase() !== "tbc");
    if (namedContractors.length > 0) score += 0.10;
  }

  if (params.sources && params.sources.length > 0) score += 0.05;
  if (params.priority === "hot") score += 0.05;
  if (code === "unknown") score -= 0.15;

  return Math.min(0.99, Math.max(0.05, Math.round(score * 100) / 100));
}

// ── Project type inference ────────────────────────────────────────────────────

const MACRO_NAME_PATTERNS: RegExp[] = [
  /\broadmap\b/,
  /\bstrategy\b/,
  /\bpolicy\b/,
  /\bframework\b/,
  /\bcritical\s*minerals?\s*(strategy|policy|roadmap|for\s*defence)\b/,
  /\bnational\s+rollout\b/,
  /\bmarket\s*(update|commentary|analysis|trend)\b/,
  /\bindustry\s*(update|commentary|trend)\b/,
  /\btransition\s*(plan|roadmap|strategy)\b/,
  /\bclimate\s*(policy|strategy|plan)\b/,
  /\bnet\s*zero\s*(strategy|roadmap|plan|target)\b/,
  /\brenewable\s*energy\s*(target|policy|zone)\b/,
  /\belectricity\s*(market|network)\s*(reform|update|plan)\b/,
  /\bhydrogen\s*(strategy|roadmap|policy)\b/,
  /\boffshore\s*wind\s*(zone|policy|roadmap)\b/,
];

const MACRO_STAGE_PATTERNS: RegExp[] = [
  /\bpolicy.?driven\b/,
  /\badvocating?\b/,
  /\bconcept\s*\/?\s*advocacy\b/,
  /\bearly.?stage.*policy\b/,
];

const PROGRAM_WRAPPER_PATTERNS: RegExp[] = [
  /\bprogram(me)?\b.*\bfunding\b/,
  /\bfunding\s*(program(me)?|round|package|pool)\b/,
  /\bportfolio\s*of\b/,
  /\bblack\s*spot\s*program\b/,
  /\binfrastructure\s*(fund|package|program(me)?)\b/,
  /\bclean\s*energy\s*finance\s*corporation\b/,
  /\bcefc\b/,
  /\baren[ae]\b.*\bfund\b/,
  /\bsage\s*fund\b/,
  /\bstate\s*(government)?\s*(initiative|program(me)?|fund)\b/,
];

const BACKGROUND_STAGE_PATTERNS: RegExp[] = [
  /^operational$/, // plain "operational" with no expansion qualifier
  /\boperational\s*-?\s*(maintenance|monitoring|outage)\b/,
  /\bongoing\s*operations?\b/,
  /\boperating\b/,
  /\bcompleted?\s*\/?\s*operational\b/,
  /\boperational\s*\(post.?incident\)\b/,
  /\boperational,?\s*scheme\s*closing\b/,
];

const BACKGROUND_NAME_PATTERNS: RegExp[] = [
  /\boperations?\b.*\b(ramp.?up|ongoing|post.?earthquake)\b/,
  /\bdischarge\s*records?\b/,
  /\bmonitoring\b/,
  /\boutage[s]?\b/,
  /\brefinery\s*operations?\b/,
  /\bquarry\s*operation\b/,
];

const AUSTENDER_CONTRACT_ID_PATTERN = /^\d{5,}(\/\d+)?\s*—/;

/**
 * Infer the projectType for a project based on its name, stage, owner, and location.
 *
 * Priority order:
 *  1. macro_item — broad policy/trend/roadmap signals
 *  2. program_wrapper — funding programmes / umbrella packages
 *  3. background_account — operational accounts without new opportunity signals
 *  4. opportunity — everything else (default)
 *
 * Note: completed/cancelled projects are NOT reclassified here — they retain
 * their projectType but are suppressed via evaluateSuppression.
 */
export function inferProjectType(params: {
  name: string;
  stage: string | null | undefined;
  owner: string | null | undefined;
  location: string | null | undefined;
  stageCode: StageCodeValue;
}): ProjectTypeValue {
  const nameLower = params.name.toLowerCase();
  const stageLower = (params.stage ?? "").toLowerCase();
  const ownerLower = (params.owner ?? "").toLowerCase();
  const locationLower = (params.location ?? "").toLowerCase();

  // ── AusTender contract IDs with no equipment/site signal ─────────────────
  if (AUSTENDER_CONTRACT_ID_PATTERN.test(params.name)) {
    // If the owner is a government department and there's no equipment signal in name, treat as macro
    if (/department\s*of|government|dfat|home\s*affairs|foreign\s*affairs/.test(ownerLower)) {
      return "macro_item";
    }
  }

  // ── Macro item checks ─────────────────────────────────────────────────────
  for (const pattern of MACRO_NAME_PATTERNS) {
    if (pattern.test(nameLower)) return "macro_item";
  }
  for (const pattern of MACRO_STAGE_PATTERNS) {
    if (pattern.test(stageLower)) return "macro_item";
  }

  // ── Broad national/multi-entity items with vague owner ───────────────────
  const isNational = /\bnational\b/.test(locationLower) || locationLower === "national";
  const isVagueOwner = /^(various|multiple|nem|national electricity market|state government|federal government|australian government)/.test(ownerLower.trim());
  const isVagueName = /\brecords?\b|\bmonitoring\b|\brollout\b|\bexpansion\b/.test(nameLower) && isNational && isVagueOwner;
  if (isVagueName) return "macro_item";

  // ── Program wrapper checks ────────────────────────────────────────────────
  for (const pattern of PROGRAM_WRAPPER_PATTERNS) {
    if (pattern.test(nameLower)) return "program_wrapper";
  }

  // ── Background account checks ─────────────────────────────────────────────
  // Operational with no expansion/upgrade signal = background_account
  const hasExpansionSignal = /\bexpan(d|sion)\b|\bupgrad(e|ing)\b|\bnew\s*(package|stage|phase|contract|work)\b|\bextension\b/.test(nameLower) ||
    /\bexpan(d|sion)\b|\bupgrad(e|ing)\b|\bnew\s*(package|stage|phase|contract|work)\b|\bextension\b/.test(stageLower);

  if (params.stageCode === "operational" && !hasExpansionSignal) {
    return "background_account";
  }
  for (const pattern of BACKGROUND_STAGE_PATTERNS) {
    if (pattern.test(stageLower) && !hasExpansionSignal) return "background_account";
  }
  for (const pattern of BACKGROUND_NAME_PATTERNS) {
    if (pattern.test(nameLower) && !hasExpansionSignal) return "background_account";
  }

  return "opportunity";
}

// ── Suppression rules ─────────────────────────────────────────────────────────

/**
 * Determine whether a project should be suppressed from the default rep-facing view.
 *
 * Suppression rules (in priority order):
 *  1. Completed/cancelled stage → suppressed
 *  2. macro_item type → suppressed
 *  3. program_wrapper type → suppressed
 *  4. background_account type → suppressed (visible in account/context views only)
 *  5. Very low stageConfidence (< 0.25) AND no named owner → suppressed
 *
 * Returns { suppressed: boolean, suppressionReason: string | null }
 */
export function evaluateSuppression(params: {
  projectType: ProjectTypeValue;
  stageCode: StageCodeValue;
  stageConfidence: number;
  owner: string | null | undefined;
}): { suppressed: boolean; suppressionReason: string | null } {
  const { projectType, stageCode, stageConfidence } = params;
  const ownerLower = (params.owner ?? "").toLowerCase().trim();
  const genericOwners = new Set(["unknown", "n/a", "tbc", "tbd", ""]);
  const hasNamedOwner = ownerLower.length > 0 && !genericOwners.has(ownerLower);

  if (stageCode === "completed") {
    return { suppressed: true, suppressionReason: "Project is completed — no active opportunity" };
  }
  if (stageCode === "cancelled") {
    return { suppressed: true, suppressionReason: "Project is cancelled or decommissioned" };
  }
  if (projectType === "macro_item") {
    return { suppressed: true, suppressionReason: "Macro/policy item — no specific buying route or target entity" };
  }
  if (projectType === "program_wrapper") {
    return { suppressed: true, suppressionReason: "Programme wrapper — umbrella funding item, specific packages should be tracked separately" };
  }
  if (projectType === "background_account") {
    return { suppressed: true, suppressionReason: "Background operational account — no new opportunity signal" };
  }
  if (stageConfidence < 0.25 && !hasNamedOwner) {
    return { suppressed: true, suppressionReason: "Very low confidence and no named owner — insufficient signal for rep action" };
  }

  return { suppressed: false, suppressionReason: null };
}

// ── Full classification pipeline for a single project ─────────────────────────

/**
 * Run the full Stage 5D classification pipeline for a single project row.
 * Returns all four classification fields ready to write to the DB.
 */
export function classifyProject(params: {
  name: string;
  stage: string | null | undefined;
  owner: string | null | undefined;
  location: string | null | undefined;
  contractors?: { name: string; status: string }[] | null;
  sources?: { label: string; url: string }[] | null;
  priority?: string | null;
}): ClassificationResult {
  const { code: stageCode, confidence: baseConf } = normalizeStageCode(params.stage);
  const stageConfidence = computeStageConfidence({
    stage: params.stage,
    owner: params.owner,
    contractors: params.contractors,
    sources: params.sources,
    priority: params.priority,
  });
  const projectType = inferProjectType({
    name: params.name,
    stage: params.stage,
    owner: params.owner,
    location: params.location,
    stageCode,
  });
  const { suppressed, suppressionReason } = evaluateSuppression({
    projectType,
    stageCode,
    stageConfidence,
    owner: params.owner,
  });

  return { projectType, stageCode, stageConfidence, suppressed, suppressionReason };
}

// ── Bulk DB classification ────────────────────────────────────────────────────

/**
 * Classify all projects in the database and write the results back.
 * Processes in batches of 100 to avoid large transactions.
 * Returns counts of how many were classified and how many were suppressed.
 */
export async function classifyAllProjects(): Promise<{
  total: number;
  suppressed: number;
  byType: Record<ProjectTypeValue, number>;
  byStageCode: Record<StageCodeValue, number>;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const allProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      stage: projects.stage,
      owner: projects.owner,
      location: projects.location,
      contractors: projects.contractors,
      sources: projects.sources,
      priority: projects.priority,
    })
    .from(projects);

  const byType: Record<ProjectTypeValue, number> = {
    opportunity: 0, background_account: 0, macro_item: 0, program_wrapper: 0,
  };
  const byStageCode: Record<StageCodeValue, number> = {
    exploration: 0, feasibility: 0, planning: 0, design: 0, procurement: 0,
    awarded: 0, construction: 0, commissioning: 0, operational: 0,
    completed: 0, cancelled: 0, unknown: 0,
  };
  let suppressedCount = 0;

  const BATCH = 100;
  for (let i = 0; i < allProjects.length; i += BATCH) {
    const batch = allProjects.slice(i, i + BATCH);
    for (const p of batch) {
      const result = classifyProject({
        name: p.name,
        stage: p.stage,
        owner: p.owner,
        location: p.location,
        contractors: p.contractors as { name: string; status: string }[] | null,
        sources: p.sources as { label: string; url: string }[] | null,
        priority: p.priority,
      });
      await db.update(projects)
        .set({
          projectType: result.projectType,
          stageCode: result.stageCode,
          stageConfidence: result.stageConfidence,
          suppressed: result.suppressed,
          suppressionReason: result.suppressionReason,
        })
        .where(eq(projects.id, p.id));

      byType[result.projectType]++;
      byStageCode[result.stageCode]++;
      if (result.suppressed) suppressedCount++;
    }
  }

  return { total: allProjects.length, suppressed: suppressedCount, byType, byStageCode };
}

// ── Suppression stats query ───────────────────────────────────────────────────

export async function getSuppressionStats(): Promise<{
  totalActive: number;
  totalSuppressed: number;
  visibleOpportunities: number;
  byType: { projectType: string; cnt: number }[];
  byStageCode: { stageCode: string; cnt: number }[];
  suppressedByReason: { suppressionReason: string; cnt: number }[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [totalRows] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(projects)
    .where(eq(projects.lifecycleStatus, "active"));

  const [suppressedRows] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(projects)
    .where(and(eq(projects.lifecycleStatus, "active"), eq(projects.suppressed, true)));

  const [visibleRows] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(projects)
    .where(and(eq(projects.lifecycleStatus, "active"), eq(projects.suppressed, false)));

  const byType = await db
    .select({ projectType: projects.projectType, cnt: sql<number>`COUNT(*)` })
    .from(projects)
    .where(eq(projects.lifecycleStatus, "active"))
    .groupBy(projects.projectType);

  const byStageCode = await db
    .select({ stageCode: projects.stageCode, cnt: sql<number>`COUNT(*)` })
    .from(projects)
    .where(eq(projects.lifecycleStatus, "active"))
    .groupBy(projects.stageCode);

  const suppressedByReason = await db
    .select({ suppressionReason: projects.suppressionReason, cnt: sql<number>`COUNT(*)` })
    .from(projects)
    .where(and(eq(projects.lifecycleStatus, "active"), eq(projects.suppressed, true)))
    .groupBy(projects.suppressionReason);

  return {
    totalActive: Number(totalRows.cnt),
    totalSuppressed: Number(suppressedRows.cnt),
    visibleOpportunities: Number(visibleRows.cnt),
    byType: byType.map(r => ({ projectType: r.projectType ?? "opportunity", cnt: Number(r.cnt) })),
    byStageCode: byStageCode.map(r => ({ stageCode: r.stageCode ?? "unknown", cnt: Number(r.cnt) })),
    suppressedByReason: suppressedByReason.map(r => ({ suppressionReason: r.suppressionReason ?? "unknown", cnt: Number(r.cnt) })),
  };
}

// ── PT Capital Sales: Product Lane Classification ─────────────────────────────

/**
 * Maps scoring dimensions to PT equipment lanes.
 * Service Potential, Rental Influence, Booster, Nitrogen are not PT lanes.
 */
export const DIMENSION_TO_LANE: Record<string, "portable_air" | "pumps" | "pal" | "bess"> = {
  "Portable Air": "portable_air",
  "Pump/Dewatering": "pumps",
  "Generators": "pal",
  "BESS": "bess",
};

/**
 * Classifies a project into a PT equipment lane based on its business-line scores.
 *
 * Rules:
 * 1. Only PT dimensions (Portable Air, Pump/Dewatering, Generators, BESS) are considered.
 * 2. If no PT dimension scores ≥ 30, returns null (unclassifiable).
 * 3. If the top lane leads by ≥ 15 points, it wins outright.
 * 4. If two or more lanes are both ≥ 40 and within 15 points, returns multi_lane_pt.
 * 5. Otherwise returns multi_lane_pt.
 */
export function classifyProductLaneFromScores(
  scores: Record<string, number>
): "portable_air" | "pumps" | "pal" | "bess" | "multi_lane_pt" | null {
  const laneScores: Record<string, number> = {};
  for (const [dim, score] of Object.entries(scores)) {
    const lane = DIMENSION_TO_LANE[dim];
    if (!lane) continue;
    laneScores[lane] = Math.max(laneScores[lane] ?? 0, score);
  }

  const sorted = Object.entries(laneScores).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;

  const [topLane, topScore] = sorted[0];
  const secondScore = sorted[1]?.[1] ?? 0;

  if (topScore < 30) return null;
  if (topScore >= 40 && secondScore >= 40 && topScore - secondScore < 15) return "multi_lane_pt";
  if (topScore - secondScore >= 15) return topLane as "portable_air" | "pumps" | "pal" | "bess";
  return "multi_lane_pt";
}

/**
 * Classifies a single project's productLane from its DB scores and writes it back.
 */
export async function classifyProductLane(projectId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const scoreRows = await db.select({
    scoringDimension: projectBusinessLineScores.scoringDimension,
    score: projectBusinessLineScores.score,
  }).from(projectBusinessLineScores)
    .where(eq(projectBusinessLineScores.projectId, projectId));

  const scoreMap: Record<string, number> = {};
  for (const row of scoreRows) {
    scoreMap[row.scoringDimension] = Math.max(scoreMap[row.scoringDimension] ?? 0, row.score);
  }

  const lane = classifyProductLaneFromScores(scoreMap);
  if (lane) {
    await db.update(projects).set({ productLane: lane }).where(eq(projects.id, projectId));
  }
  return lane;
}

/**
 * Bulk-classifies all projects that have BL scores and writes productLane back.
 * Returns a summary of lane assignments.
 */
export async function classifyAllProductLanes(): Promise<Record<string, number>> {
  const db = await getDb();
  if (!db) return {};

  const allScores = await db.select({
    projectId: projectBusinessLineScores.projectId,
    scoringDimension: projectBusinessLineScores.scoringDimension,
    score: projectBusinessLineScores.score,
  }).from(projectBusinessLineScores);

  // Group scores by projectId
  const byProject = new Map<number, Record<string, number>>();
  for (const row of allScores) {
    if (!byProject.has(row.projectId)) byProject.set(row.projectId, {});
    const map = byProject.get(row.projectId)!;
    map[row.scoringDimension] = Math.max(map[row.scoringDimension] ?? 0, row.score);
  }

  // Classify and group by lane
  const laneBuckets: Record<string, number[]> = {
    portable_air: [], pumps: [], pal: [], bess: [], multi_lane_pt: [],
  };

  for (const [projectId, scoreMap] of Array.from(byProject.entries())) {
    const lane = classifyProductLaneFromScores(scoreMap);
    if (lane) laneBuckets[lane].push(projectId);
  }

  // Bulk UPDATE per lane
  const summary: Record<string, number> = {};
  for (const [lane, ids] of Object.entries(laneBuckets)) {
    if (ids.length === 0) continue;
    await db.update(projects)
      .set({ productLane: lane as "portable_air" | "pumps" | "pal" | "bess" | "multi_lane_pt" })
      .where(inArray(projects.id, ids));
    summary[lane] = ids.length;
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Part D — Action Tracking helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the current ISO week key in the format "YYYYWww", e.g. "2026W17".
 * Monday is the first day of the week (ISO 8601).
 */
export function getCurrentWeekKey(date: Date = new Date()): string {
  // ISO week: Thursday of the week determines the year
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Generates a deterministic, human-readable actionId.
 * Format: ACT-{weekKey}-{userId6}-{projectId6}
 * e.g. ACT-2026W17-000042-000317
 *
 * Same userId + projectId + weekKey always produces the same actionId,
 * enabling upsert-on-conflict deduplication.
 */
export function generateActionId(userId: number, projectId: number, weekKey?: string): string {
  const wk = weekKey ?? getCurrentWeekKey();
  const u = String(userId).padStart(6, "0");
  const p = String(projectId).padStart(6, "0");
  return `ACT-${wk}-${u}-${p}`;
}

/** Outcome codes that close an action (set completedAt). */
const CLOSING_OUTCOMES = new Set(["won", "lost", "not_relevant"]);

/** Outcome codes that suppress new prompts for 14 days. */
const COOLING_OUTCOMES = new Set(["already_active"]);

/** Cooling period in milliseconds (14 days). */
const COOLING_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;

type OutcomeCode =
  | "not_started"
  | "contacted"
  | "meeting_booked"
  | "proposal_sent"
  | "won"
  | "lost"
  | "deferred"
  | "not_relevant"
  | "already_active"
  | "contact_discovery_needed";

type SourceContext =
  | "weekly_email"
  | "dashboard"
  | "campaign"
  | "emarsys_followup"
  | "manual";

type ProductLaneValue =
  | "portable_air"
  | "pumps"
  | "pal"
  | "bess"
  | "multi_lane_pt";

/**
 * Upsert a projectAction for userId + projectId + current week.
 * If a record already exists for this week, it is updated in-place.
 * If the outcome is a closing outcome, completedAt is set.
 */
export async function upsertProjectAction(params: {
  userId: number;
  projectId: number;
  contactId?: number;
  campaignId?: number;
  sourceContext?: SourceContext;
  productLane?: ProductLaneValue;
  recommendedAction?: string;
  outcomeCode?: OutcomeCode;
  outcomeNotes?: string;
  weekKey?: string;
}): Promise<ProjectAction> {
  const db = await getDb();
  if (!db) throw new Error("[Database] Not available");
  const weekKey = params.weekKey ?? getCurrentWeekKey();
  const actionId = generateActionId(params.userId, params.projectId, weekKey);
  const outcomeCode = params.outcomeCode ?? "not_started";
  const completedAt = CLOSING_OUTCOMES.has(outcomeCode) ? new Date() : null;

  // Check if record already exists
  const [existing] = await db
    .select()
    .from(projectActions)
    .where(eq(projectActions.actionId, actionId))
    .limit(1);

  if (existing) {
    // Update existing record
    await db
      .update(projectActions)
      .set({
        outcomeCode: outcomeCode as OutcomeCode,
        outcomeNotes: params.outcomeNotes ?? existing.outcomeNotes,
        contactId: params.contactId ?? existing.contactId,
        productLane: params.productLane ?? existing.productLane,
        recommendedAction: params.recommendedAction ?? existing.recommendedAction,
        completedAt: completedAt ?? existing.completedAt,
        updatedAt: new Date(),
      })
      .where(eq(projectActions.actionId, actionId));
    const [updated] = await db
      .select()
      .from(projectActions)
      .where(eq(projectActions.actionId, actionId))
      .limit(1);
    return updated;
  }

  // Insert new record
  await db.insert(projectActions).values({
    projectId: params.projectId,
    contactId: params.contactId ?? null,
    campaignId: params.campaignId ?? null,
    userId: params.userId,
    actionId,
    sourceContext: params.sourceContext ?? "dashboard",
    productLane: params.productLane ?? null,
    recommendedAction: params.recommendedAction ?? null,
    outcomeCode: outcomeCode as OutcomeCode,
    outcomeNotes: params.outcomeNotes ?? null,
    weekKey,
    managerVisible: true,
    completedAt: completedAt ?? null,
  });

  const [inserted] = await db
    .select()
    .from(projectActions)
    .where(eq(projectActions.actionId, actionId))
    .limit(1);
  return inserted;
}

/**
 * Update the outcome of an existing action by actionId.
 * Enforces lifecycle rules:
 *  - won / lost / not_relevant → sets completedAt
 *  - deferred → keeps open, no completedAt change
 *  - already_active → keeps open (cooling handled by getAlreadyActiveCooldownProjects)
 *  - contact_discovery_needed → keeps open, flagged awaiting data
 */
export async function updateActionOutcome(params: {
  actionId: string;
  userId: number;
  outcomeCode: OutcomeCode;
  outcomeNotes?: string;
}): Promise<ProjectAction | null> {
  const db = await getDb();
  if (!db) throw new Error("[Database] Not available");
  const completedAt = CLOSING_OUTCOMES.has(params.outcomeCode) ? new Date() : undefined;

  await db
    .update(projectActions)
    .set({
      outcomeCode: params.outcomeCode,
      outcomeNotes: params.outcomeNotes,
      ...(completedAt !== undefined ? { completedAt } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectActions.actionId, params.actionId),
        eq(projectActions.userId, params.userId)
      )
    );

  const [updated] = await db
    .select()
    .from(projectActions)
    .where(eq(projectActions.actionId, params.actionId))
    .limit(1);
  return updated ?? null;
}

/**
 * Get all actions for a specific project (all reps, most recent first).
 */
export async function getActionsForProject(projectId: number): Promise<ProjectAction[]> {
  const db = await getDb();
  if (!db) throw new Error("[Database] Not available");
  return db
    .select()
    .from(projectActions)
    .where(eq(projectActions.projectId, projectId))
    .orderBy(desc(projectActions.updatedAt));
}

/**
 * Get the latest action for a specific user + project combination.
 */
export async function getLatestActionForProject(
  userId: number,
  projectId: number
): Promise<ProjectAction | null> {
  const db = await getDb();
  if (!db) throw new Error("[Database] Not available");
  const [action] = await db
    .select()
    .from(projectActions)
    .where(
      and(
        eq(projectActions.userId, userId),
        eq(projectActions.projectId, projectId)
      )
    )
    .orderBy(desc(projectActions.updatedAt))
    .limit(1);
  return action ?? null;
}

/**
 * Get actions for a specific user, optionally filtered by weekKey and/or outcomeCode.
 */
export async function getActionsForUser(params: {
  userId: number;
  weekKey?: string;
  outcomeCode?: OutcomeCode;
  limit?: number;
}): Promise<ProjectAction[]> {
  const db = await getDb();
  if (!db) throw new Error("[Database] Not available");
  const conditions = [eq(projectActions.userId, params.userId)];
  if (params.weekKey) conditions.push(eq(projectActions.weekKey, params.weekKey));
  if (params.outcomeCode) conditions.push(eq(projectActions.outcomeCode, params.outcomeCode));

  return db
    .select()
    .from(projectActions)
    .where(and(...conditions))
    .orderBy(desc(projectActions.updatedAt))
    .limit(params.limit ?? 50);
}

/**
 * Manager rollup — returns aggregated counts for a given week.
 *
 * Rollup rules:
 *  - Only the latest outcomeCode per action record counts (not history).
 *  - "This week" = the weekKey parameter (defaults to current ISO week).
 *  - won / lost close the action (completedAt is set).
 *  - deferred keeps action open but counts separately.
 *  - already_active suppresses new prompts for 14 days.
 *  - contact_discovery_needed keeps action open, flagged awaiting data.
 *  - not_relevant closes action.
 *
 * Returns:
 *  - totals by outcomeCode
 *  - breakdown by rep (userId + name from join)
 *  - breakdown by productLane
 *  - breakdown by priority (hot/warm — requires project join)
 */
export async function getManagerRollup(weekKey?: string): Promise<{
  weekKey: string;
  totalActions: number;
  byOutcome: Record<string, number>;
  byRep: { userId: number; userName: string | null; count: number; byOutcome: Record<string, number> }[];
  byLane: Record<string, number>;
}> {
  const db = await getDb();
  if (!db) throw new Error("[Database] Not available");
  const wk = weekKey ?? getCurrentWeekKey();

  // Fetch all actions for the week with user names
  const rows = await db
    .select({
      id: projectActions.id,
      userId: projectActions.userId,
      userName: users.name,
      outcomeCode: projectActions.outcomeCode,
      productLane: projectActions.productLane,
      managerVisible: projectActions.managerVisible,
    })
    .from(projectActions)
    .leftJoin(users, eq(projectActions.userId, users.id))
    .where(
      and(
        eq(projectActions.weekKey, wk),
        eq(projectActions.managerVisible, true)
      )
    );

  // Aggregate
  const byOutcome: Record<string, number> = {};
  const byLane: Record<string, number> = {};
  const repMap: Map<number, { userName: string | null; count: number; byOutcome: Record<string, number> }> = new Map();

  for (const row of rows) {
    const outcome = row.outcomeCode ?? "not_started";
    byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1;

    if (row.productLane) {
      byLane[row.productLane] = (byLane[row.productLane] ?? 0) + 1;
    }

    if (!repMap.has(row.userId)) {
      repMap.set(row.userId, { userName: row.userName, count: 0, byOutcome: {} });
    }
    const rep = repMap.get(row.userId)!;
    rep.count++;
    rep.byOutcome[outcome] = (rep.byOutcome[outcome] ?? 0) + 1;
  }

  const byRep = Array.from(repMap.entries()).map(([userId, data]) => ({
    userId,
    userName: data.userName,
    count: data.count,
    byOutcome: data.byOutcome,
  }));

  return {
    weekKey: wk,
    totalActions: rows.length,
    byOutcome,
    byRep,
    byLane,
  };
}

/**
 * Returns the subset of projectIds from the input list where the current user
 * has an already_active action updated within the last 14 days.
 * Used by the UI to suppress repeated prompts.
 */
export async function getAlreadyActiveCooldownProjects(
  userId: number,
  projectIds: number[]
): Promise<number[]> {
  if (projectIds.length === 0) return [];
  const db = await getDb();
  if (!db) throw new Error("[Database] Not available");
  const cutoff = new Date(Date.now() - COOLING_PERIOD_MS);

  const rows = await db
    .select({ projectId: projectActions.projectId })
    .from(projectActions)
    .where(
      and(
        eq(projectActions.userId, userId),
        eq(projectActions.outcomeCode, "already_active"),
        inArray(projectActions.projectId, projectIds),
        sql`${projectActions.updatedAt} >= ${cutoff}`
      )
    );

  return rows.map((r: { projectId: number }) => r.projectId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Email Operationalization Helpers (Email Ops Sprint)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the most recent completed pipeline run for the freshness line in emails.
 * Returns null if no completed run exists.
 */
export async function getLatestPipelineRun() {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select({
      id: pipelineRuns.id,
      runType: pipelineRuns.runType,
      status: pipelineRuns.status,
      completedAt: pipelineRuns.completedAt,
      startedAt: pipelineRuns.startedAt,
      articlesIngested: pipelineRuns.articlesIngested,
      projectsCreated: pipelineRuns.projectsCreated,
    })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.status, "completed"))
    .orderBy(desc(pipelineRuns.completedAt))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

/**
 * Freshness gate: checks whether the last successful pipeline run is within the
 * acceptable window before the Monday digest fires.
 *
 * Freshness rules:
 *   fresh   = last completed run within FRESHNESS_WINDOW_HOURS (default 26h)
 *   stale   = no completed run within the window (but no recent failure either)
 *   failed  = last run has status "failed" and no subsequent completed run
 *   running = a run is currently in progress (treat as fresh if started within 4h)
 *
 * The 26h window is intentionally > 24h to tolerate minor scheduler drift
 * (e.g. server restart at 20:05 instead of 20:00 the previous day).
 */
export type PipelineFreshnessStatus = "fresh" | "stale" | "failed" | "running" | "never_run";

export interface PipelineFreshnessResult {
  status: PipelineFreshnessStatus;
  lastCompletedAt: Date | null;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  ageHours: number | null;
  windowHours: number;
  blockedReason: string | null;
}

export async function checkPipelineFreshness(
  windowHours = 26
): Promise<PipelineFreshnessResult> {
  const db = await getDb();
  const windowHoursNum = windowHours;

  if (!db) {
    return {
      status: "stale",
      lastCompletedAt: null,
      lastRunAt: null,
      lastRunStatus: null,
      ageHours: null,
      windowHours: windowHoursNum,
      blockedReason: "Database unavailable — cannot verify pipeline freshness",
    };
  }

  // Get the most recent pipeline run (any status)
  const [latestRun] = await db
    .select({
      id: pipelineRuns.id,
      status: pipelineRuns.status,
      startedAt: pipelineRuns.startedAt,
      completedAt: pipelineRuns.completedAt,
    })
    .from(pipelineRuns)
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);

  // Get the most recent completed run
  const [lastCompleted] = await db
    .select({
      id: pipelineRuns.id,
      completedAt: pipelineRuns.completedAt,
    })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.status, "completed"))
    .orderBy(desc(pipelineRuns.completedAt))
    .limit(1);

  const now = new Date();

  // No runs at all
  if (!latestRun) {
    return {
      status: "never_run",
      lastCompletedAt: null,
      lastRunAt: null,
      lastRunStatus: null,
      ageHours: null,
      windowHours: windowHoursNum,
      blockedReason: "No pipeline runs found — pipeline has never executed",
    };
  }

  const lastRunAt = latestRun.startedAt ? new Date(latestRun.startedAt) : null;
  const lastCompletedAt = lastCompleted?.completedAt ? new Date(lastCompleted.completedAt) : null;
  const ageHours = lastCompletedAt
    ? Math.round(((now.getTime() - lastCompletedAt.getTime()) / 3600000) * 10) / 10
    : null;

  // Currently running (started within 4h, not yet completed)
  if (latestRun.status === "running" && lastRunAt) {
    const runningForHours = (now.getTime() - lastRunAt.getTime()) / 3600000;
    if (runningForHours < 4) {
      return {
        status: "running",
        lastCompletedAt,
        lastRunAt,
        lastRunStatus: "running",
        ageHours,
        windowHours: windowHoursNum,
        blockedReason: null, // running is treated as fresh — will complete before digest
      };
    }
    // Running for > 4h = phantom/stuck run, treat as failed
    return {
      status: "failed",
      lastCompletedAt,
      lastRunAt,
      lastRunStatus: "running (stuck)",
      ageHours,
      windowHours: windowHoursNum,
      blockedReason: `Pipeline run has been in 'running' state for ${Math.round(runningForHours)}h — likely stuck. Last completed run: ${
        lastCompletedAt ? lastCompletedAt.toUTCString() : "never"
      }`,
    };
  }

  // Last run failed and no subsequent completed run within window
  if (latestRun.status === "failed") {
    // If there's a completed run within the window despite the latest being failed, still fresh
    if (lastCompletedAt && ageHours !== null && ageHours <= windowHoursNum) {
      return {
        status: "fresh",
        lastCompletedAt,
        lastRunAt,
        lastRunStatus: latestRun.status,
        ageHours,
        windowHours: windowHoursNum,
        blockedReason: null,
      };
    }
    return {
      status: "failed",
      lastCompletedAt,
      lastRunAt,
      lastRunStatus: "failed",
      ageHours,
      windowHours: windowHoursNum,
      blockedReason: `Last pipeline run failed. Last successful run: ${
        lastCompletedAt ? `${ageHours}h ago (${lastCompletedAt.toUTCString()})` : "never"
      }`,
    };
  }

  // Completed run exists — check age
  if (lastCompletedAt && ageHours !== null) {
    if (ageHours <= windowHoursNum) {
      return {
        status: "fresh",
        lastCompletedAt,
        lastRunAt,
        lastRunStatus: latestRun.status,
        ageHours,
        windowHours: windowHoursNum,
        blockedReason: null,
      };
    }
    // Completed but outside window
    return {
      status: "stale",
      lastCompletedAt,
      lastRunAt,
      lastRunStatus: latestRun.status,
      ageHours,
      windowHours: windowHoursNum,
      blockedReason: `Last successful pipeline run was ${ageHours}h ago — outside the ${windowHoursNum}h freshness window`,
    };
  }

  // Fallback: no completed run
  return {
    status: "stale",
    lastCompletedAt: null,
    lastRunAt,
    lastRunStatus: latestRun.status,
    ageHours: null,
    windowHours: windowHoursNum,
    blockedReason: "No successful pipeline run found",
  };
}

/**
 * Recipient selection for email digests.
 *
 * Selection rules (in priority order):
 * 1. If PILOT_MODE env is "true", only users whose email is in PILOT_ALLOW_LIST are included.
 * 2. Only users with completed onboarding profiles are included.
 * 3. If the user has assignedBusinessLines set, they are included regardless of PT lane.
 * 4. If no assignedBusinessLines, they are included (fallback: all lanes).
 *
 * Returns an array of { user, profile } pairs ready for digest generation.
 */
export async function getEmailRecipients(opts?: {
  digestType?: "monday" | "thursday" | "manager_rollup";
  pilotMode?: boolean;
  pilotAllowList?: string[];
}): Promise<Array<{ user: typeof users.$inferSelect; profile: typeof userProfiles.$inferSelect }>> {
  const db = await getDb();
  if (!db) return [];

  // Determine pilot mode from env or explicit option
  const isPilot = opts?.pilotMode ?? (process.env.PILOT_MODE === "true");
  const allowList: string[] = opts?.pilotAllowList
    ?? (process.env.PILOT_ALLOW_LIST ? process.env.PILOT_ALLOW_LIST.split(",").map(s => s.trim().toLowerCase()) : []);

  const rows = await db
    .select({ user: users, profile: userProfiles })
    .from(userProfiles)
    .innerJoin(users, eq(userProfiles.userId, users.id))
    .where(eq(userProfiles.onboardingCompleted, true));

  // Apply pilot filter
  if (isPilot && allowList.length > 0) {
    return rows.filter(r => r.user.email && allowList.includes(r.user.email.toLowerCase()));
  }

  return rows;
}

/**
 * Extended email send log with weekKey, itemCount, and dryRun support.
 * Replaces the simpler logUserEmailSend in emailDigest.ts for new sends.
 */
export async function logEmailSendExtended(params: {
  userId: number;
  digestType: "monday" | "thursday" | "manager_rollup";
  status: "sent" | "failed" | "dry_run";
  weekKey?: string;
  itemCount?: number;
  dryRun?: boolean;
  error?: string;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(userEmailSendLog).values({
      userId: params.userId,
      digestType: params.digestType,
      sentDate: today,
      weekKey: params.weekKey ?? null,
      status: params.status,
      itemCount: params.itemCount ?? 0,
      dryRun: params.dryRun ?? false,
      error: params.error ?? null,
    });
  } catch (err) {
    console.error("[EmailOps] Error logging email send:", err);
  }
}

/**
 * Check if a user already received a specific digest type this ISO week.
 * Used for weekly dedup (as opposed to daily dedup in wasEmailSentToUser).
 */
export async function wasEmailSentToUserThisWeek(
  userId: number,
  digestType: "monday" | "thursday" | "manager_rollup",
  weekKey: string,
): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const result = await db
      .select()
      .from(userEmailSendLog)
      .where(
        and(
          eq(userEmailSendLog.userId, userId),
          eq(userEmailSendLog.digestType, digestType),
          eq(userEmailSendLog.weekKey, weekKey),
          eq(userEmailSendLog.status, "sent"),
        ),
      )
      .limit(1);
    return result.length > 0;
  } catch {
    return true; // On error, assume sent to prevent duplicates
  }
}

/**
 * Get email send log for a specific user and digest type within a week.
 * Used for parity checks and audit.
 */
export async function getEmailSendLogForWeek(
  weekKey: string,
  digestType?: "monday" | "thursday" | "manager_rollup",
): Promise<Array<typeof userEmailSendLog.$inferSelect>> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(userEmailSendLog.weekKey, weekKey)];
  if (digestType) conditions.push(eq(userEmailSendLog.digestType, digestType));
  return db
    .select()
    .from(userEmailSendLog)
    .where(and(...conditions))
    .orderBy(desc(userEmailSendLog.sentAt));
}

// ── Pilot-Week Enrichment Helpers (Part A) ──

/**
 * PilotShortlistItem — the shape returned by getPilotShortlist().
 * Mirrors the fields used by scoreAndFilterProjects() in emailDigest.ts.
 */
export interface PilotShortlistItem {
  id: number;
  name: string;
  priority: "hot" | "warm" | "cold";
  sector: string;
  productLane: string | null;
  stageCode: string | null;
  lifecycleStatus: string;
  suppressed: boolean | null;
  projectType: string | null;
  reportId: number;
  /** Number of contacts linked via contactProjects junction */
  contactCount: number;
  /** Number of those contacts that have a non-null email */
  contactsWithEmail: number;
  /** True when contactCount === 0 — drives "Stakeholder discovery needed" advisory */
  hasNoContacts: boolean;
}

/**
 * Returns the pilot shortlist: the same set of projects that scoreAndFilterProjects()
 * would include in the Monday digest.
 *
 * Filters applied (matching emailDigest.ts scoreAndFilterProjects logic):
 *  - lifecycleStatus IN ('active')
 *  - suppressed = false OR suppressed IS NULL
 *  - projectType = 'opportunity' OR projectType IS NULL
 *  - priority IN ('hot', 'warm')
 *
 * Returns projects ordered by priority (hot first) then by id desc.
 */
export async function getPilotShortlist(reportId?: number): Promise<PilotShortlistItem[]> {
  const db = await getDb();
  if (!db) return [];

  // Resolve reportId — default to latest report
  let resolvedReportId = reportId;
  if (!resolvedReportId) {
    const latest = await getLatestReport();
    if (!latest) return [];
    resolvedReportId = latest.id;
  }

  // Fetch shortlisted projects
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      priority: projects.priority,
      sector: projects.sector,
      productLane: projects.productLane,
      stageCode: projects.stageCode,
      lifecycleStatus: projects.lifecycleStatus,
      suppressed: projects.suppressed,
      projectType: projects.projectType,
      reportId: projects.reportId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.reportId, resolvedReportId),
        eq(projects.lifecycleStatus, "active"),
        or(eq(projects.suppressed, false), isNull(projects.suppressed)),
        or(
          eq(projects.projectType, "opportunity"),
          isNull(projects.projectType)
        ),
        inArray(projects.priority, ["hot", "warm"])
      )
    )
    .orderBy(
      sql`FIELD(${projects.priority}, 'hot', 'warm', 'cold')`,
      desc(projects.id)
    );

  if (rows.length === 0) return [];

  // Fetch contact counts per project via contactProjects junction
  const projectIds = rows.map(r => r.id);
  const contactRows = await db
    .select({
      projectId: contactProjects.projectId,
      contactId: contactProjects.contactId,
    })
    .from(contactProjects)
    .where(inArray(contactProjects.projectId, projectIds));

  // Fetch email status for those contacts
  const contactIds = Array.from(new Set(contactRows.map(c => c.contactId)));
  let emailSet = new Set<number>();
  if (contactIds.length > 0) {
    const emailRows = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          inArray(contacts.id, contactIds),
          sql`${contacts.email} IS NOT NULL`
        )
      );
    emailSet = new Set(emailRows.map(r => r.id));
  }

  // Build per-project maps
  const countMap = new Map<number, { total: number; withEmail: number }>();
  for (const r of contactRows) {
    const existing = countMap.get(r.projectId) ?? { total: 0, withEmail: 0 };
    existing.total++;
    if (emailSet.has(r.contactId)) existing.withEmail++;
    countMap.set(r.projectId, existing);
  }

  return rows.map(r => {
    const counts = countMap.get(r.id) ?? { total: 0, withEmail: 0 };
    return {
      ...r,
      contactCount: counts.total,
      contactsWithEmail: counts.withEmail,
      hasNoContacts: counts.total === 0,
    };
  });
}

/**
 * Returns the count of projects in the pilot shortlist for a given reportId.
 * Used for parity checks between dashboard and email.
 */
export async function getPilotShortlistCount(reportId?: number): Promise<number> {
  const items = await getPilotShortlist(reportId);
  return items.length;
}
