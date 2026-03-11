/**
 * User Activity Tracking Service
 * Tracks salesperson engagement: projects viewed, contacts opened, outreach actions, pipeline moves.
 * Provides aggregation for admin analytics and individual user dashboards.
 */
import { getDb } from "./db";
import { userActivity, type InsertUserActivity } from "../drizzle/schema";
import { eq, and, gte, desc, sql, count } from "drizzle-orm";

export type ActivityAction = InsertUserActivity["actionType"];

// ── Core Tracking ──

export async function trackActivity(
  userId: number,
  actionType: ActivityAction,
  opts?: {
    projectId?: number;
    contactId?: number;
    claimId?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(userActivity).values({
    userId,
    actionType,
    projectId: opts?.projectId ?? null,
    contactId: opts?.contactId ?? null,
    claimId: opts?.claimId ?? null,
    metadata: opts?.metadata ?? null,
  });
}

// ── User-Level Queries ──

export async function getUserActivitySummary(
  userId: number,
  sinceDays: number = 7
): Promise<{ projectsViewed: number; contactsOpened: number; outreachDrafted: number; outreachSent: number; pipelineClaims: number; pipelineMoves: number; searchesPerformed: number; totalActions: number }> {

  const db = await getDb();
  if (!db) return { projectsViewed: 0, contactsOpened: 0, outreachDrafted: 0, outreachSent: 0, pipelineClaims: 0, pipelineMoves: 0, searchesPerformed: 0, totalActions: 0 };
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);

  const rows = await db
    .select({
      actionType: userActivity.actionType,
      cnt: count(),
    })
    .from(userActivity)
    .where(and(eq(userActivity.userId, userId), gte(userActivity.createdAt, since)))
    .groupBy(userActivity.actionType);

  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.actionType] = r.cnt;
  }

  return {
    projectsViewed: counts["project_viewed"] ?? 0,
    contactsOpened: counts["contact_viewed"] ?? 0,
    outreachDrafted: counts["outreach_drafted"] ?? 0,
    outreachSent: counts["outreach_sent"] ?? 0,
    pipelineClaims: counts["pipeline_claimed"] ?? 0,
    pipelineMoves: (counts["pipeline_status_changed"] ?? 0) +
                   (counts["pipeline_meeting_logged"] ?? 0) +
                   (counts["pipeline_quote_uploaded"] ?? 0),
    searchesPerformed: counts["search_performed"] ?? 0,
    totalActions: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

export async function getUserRecentActivity(
  userId: number,
  limit: number = 20
): Promise<Array<{
  id: number;
  actionType: string;
  projectId: number | null;
  contactId: number | null;
  claimId: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}>> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(userActivity)
    .where(eq(userActivity.userId, userId))
    .orderBy(desc(userActivity.createdAt))
    .limit(limit);
}

// ── Admin-Level Aggregation ──

export async function getTeamActivitySummary(
  sinceDays: number = 7
): Promise<{
  totalActions: number;
  uniqueUsers: number;
  byAction: Record<string, number>;
  topUsers: Array<{ userId: number; actionCount: number }>;
}> {
  const db = await getDb();
  if (!db) return { totalActions: 0, uniqueUsers: 0, byAction: {}, topUsers: [] };
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);

  const [actionRows, userRows] = await Promise.all([
    db
      .select({
        actionType: userActivity.actionType,
        cnt: count(),
      })
      .from(userActivity)
      .where(gte(userActivity.createdAt, since))
      .groupBy(userActivity.actionType),
    db
      .select({
        userId: userActivity.userId,
        cnt: count(),
      })
      .from(userActivity)
      .where(gte(userActivity.createdAt, since))
      .groupBy(userActivity.userId)
      .orderBy(desc(count()))
      .limit(10),
  ]);

  const byAction: Record<string, number> = {};
  let totalActions = 0;
  for (const r of actionRows) {
    byAction[r.actionType as string] = r.cnt;
    totalActions += r.cnt;
  }

  return {
    totalActions,
    uniqueUsers: userRows.length,
    byAction,
    topUsers: userRows.map((r: { userId: number; cnt: number }) => ({ userId: r.userId, actionCount: r.cnt })),
  };
}

// ── Engagement Score ──

const ACTION_WEIGHTS: Record<string, number> = {
  project_viewed: 1,
  contact_viewed: 2,
  contact_enriched: 3,
  search_performed: 2,
  outreach_drafted: 5,
  outreach_sent: 8,
  pipeline_claimed: 5,
  pipeline_status_changed: 4,
  pipeline_meeting_logged: 7,
  pipeline_quote_uploaded: 10,
  project_exported: 2,
};

export async function getUserEngagementScore(
  userId: number,
  sinceDays: number = 7
): Promise<{ score: number; level: "low" | "moderate" | "active" | "power_user" }> {
  const summary = await getUserActivitySummary(userId, sinceDays);
  let score = 0;
  // Use the summary counts mapped to weights
  score += summary.projectsViewed * (ACTION_WEIGHTS["project_viewed"] ?? 1);
  score += summary.contactsOpened * (ACTION_WEIGHTS["contact_viewed"] ?? 1);
  score += summary.outreachDrafted * (ACTION_WEIGHTS["outreach_drafted"] ?? 1);
  score += summary.outreachSent * (ACTION_WEIGHTS["outreach_sent"] ?? 1);
  score += summary.pipelineClaims * (ACTION_WEIGHTS["pipeline_claimed"] ?? 1);
  score += summary.pipelineMoves * (ACTION_WEIGHTS["pipeline_status_changed"] ?? 1);
  score += summary.searchesPerformed * (ACTION_WEIGHTS["search_performed"] ?? 1);

  const level =
    score >= 100 ? "power_user" :
    score >= 50 ? "active" :
    score >= 15 ? "moderate" :
    "low";

  return { score, level };
}
