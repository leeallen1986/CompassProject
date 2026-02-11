/**
 * Database helpers for the data pipeline: business lines, RSS sources, raw articles.
 */
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { getDb } from "./db";
import {
  businessLines, InsertBusinessLine, BusinessLine,
  rssSources, InsertRssSource, RssSource,
  rawArticles, RawArticle,
  feedbackWeights,
} from "../drizzle/schema";

// ── Business Line helpers ──

export async function getAllBusinessLines(): Promise<BusinessLine[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(businessLines).orderBy(businessLines.name);
}

export async function getActiveBusinessLines(): Promise<BusinessLine[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(businessLines).where(eq(businessLines.isActive, true)).orderBy(businessLines.name);
}

export async function getBusinessLineById(id: number): Promise<BusinessLine | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(businessLines).where(eq(businessLines.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function createBusinessLine(data: InsertBusinessLine): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(businessLines).values(data);
  return Number(result[0].insertId);
}

export async function updateBusinessLine(id: number, data: Partial<InsertBusinessLine>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(businessLines).set(data).where(eq(businessLines.id, id));
}

export async function deleteBusinessLine(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(businessLines).where(eq(businessLines.id, id));
}

// ── RSS Source helpers ──

export async function getAllRssSources(): Promise<RssSource[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rssSources).orderBy(rssSources.name);
}

export async function getActiveRssSources(): Promise<RssSource[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rssSources).where(eq(rssSources.isActive, true)).orderBy(rssSources.name);
}

export async function createRssSource(data: InsertRssSource): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(rssSources).values(data);
  return Number(result[0].insertId);
}

export async function updateRssSource(id: number, data: Partial<InsertRssSource>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(rssSources).set(data).where(eq(rssSources.id, id));
}

export async function deleteRssSource(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(rssSources).where(eq(rssSources.id, id));
}

// ── Raw Article helpers ──

export async function getRecentArticles(limit: number = 50): Promise<RawArticle[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rawArticles).orderBy(desc(rawArticles.createdAt)).limit(limit);
}

export async function getArticlesByStatus(status: "pending" | "queued" | "extracted" | "skipped" | "failed", limit: number = 50): Promise<RawArticle[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rawArticles)
    .where(eq(rawArticles.status, status))
    .orderBy(desc(rawArticles.createdAt))
    .limit(limit);
}

export async function getArticleStats() {
  const db = await getDb();
  if (!db) return { pending: 0, queued: 0, extracted: 0, skipped: 0, failed: 0, total: 0 };

  const statuses = ["pending", "queued", "extracted", "skipped", "failed"] as const;
  const counts: Record<string, number> = {};

  for (const status of statuses) {
    const [result] = await db.select({ count: sql<number>`count(*)` })
      .from(rawArticles)
      .where(eq(rawArticles.status, status));
    counts[status] = Number(result.count);
  }

  return {
    ...counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

export async function getDailyExtractionStats(days: number = 7) {
  const db = await getDb();
  if (!db) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Use CAST + DATE to create a deterministic expression that MySQL's ONLY_FULL_GROUP_BY accepts
  const dateExpr = sql`CAST(DATE(${rawArticles.extractedAt}) AS CHAR)`;
  const results = await db.select({
    date: sql<string>`${dateExpr}`.as("extraction_date"),
    count: sql<number>`count(*)`.as("cnt"),
  })
    .from(rawArticles)
    .where(and(
      eq(rawArticles.status, "extracted"),
      gte(rawArticles.extractedAt, cutoff)
    ))
    .groupBy(dateExpr)
    .orderBy(dateExpr);

  return results.map(r => ({ date: String(r.date), count: Number(r.count) }));
}

// ── Feedback Weight helpers ──

export async function getFeedbackWeightsByUser(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(feedbackWeights)
    .where(eq(feedbackWeights.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : null;
}
