/**
 * RSS Harvester — Fetches RSS feeds, applies keyword gate, deduplicates articles.
 * Runs on a configurable schedule (default: every 6 hours).
 * Zero AI credits consumed — pure RSS parsing + keyword matching.
 */
import { eq, desc, sql, and } from "drizzle-orm";
import { getDb } from "./db";
import {
  rssSources, rawArticles, businessLines,
  type RssSource, type InsertRawArticle, type BusinessLine,
} from "../drizzle/schema";
import crypto from "crypto";

// ── Types ──

interface FeedItem {
  title: string;
  summary: string;
  url: string;
  publishedAt: Date | null;
}

interface HarvestResult {
  sourceId: number;
  sourceName: string;
  fetched: number;
  newArticles: number;
  duplicates: number;
  errors: string[];
}

interface HarvestSummary {
  totalSources: number;
  totalFetched: number;
  totalNew: number;
  totalDuplicates: number;
  totalErrors: number;
  results: HarvestResult[];
  startedAt: string;
  completedAt: string;
}

// ── Fingerprint for deduplication ──

export function generateFingerprint(url: string, title: string): string {
  const normalized = `${url.toLowerCase().trim()}|${title.toLowerCase().trim().replace(/\s+/g, " ")}`;
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 64);
}

// ── Simple RSS/Atom parser (no external deps) ──

function extractCDATA(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function extractTagContent(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? extractCDATA(match[1]) : "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const regex = new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, "i");
  const match = xml.match(regex);
  return match ? match[1] : "";
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

export function parseRSSFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];

  // Try RSS 2.0 <item> tags
  const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const itemXml of rssItems) {
    const title = stripHtml(extractTagContent(itemXml, "title"));
    const link = extractTagContent(itemXml, "link") || extractAttr(itemXml, "link", "href");
    const description = stripHtml(extractTagContent(itemXml, "description") || extractTagContent(itemXml, "content:encoded") || "");
    const pubDate = extractTagContent(itemXml, "pubDate") || extractTagContent(itemXml, "dc:date");

    if (title && link) {
      items.push({
        title,
        summary: description.slice(0, 2000),
        url: link.trim(),
        publishedAt: pubDate ? new Date(pubDate) : null,
      });
    }
  }

  // Try Atom <entry> tags if no RSS items found
  if (items.length === 0) {
    const atomEntries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    for (const entryXml of atomEntries) {
      const title = stripHtml(extractTagContent(entryXml, "title"));
      const link = extractAttr(entryXml, "link", "href") || extractTagContent(entryXml, "link");
      const summary = stripHtml(extractTagContent(entryXml, "summary") || extractTagContent(entryXml, "content") || "");
      const published = extractTagContent(entryXml, "published") || extractTagContent(entryXml, "updated");

      if (title && link) {
        items.push({
          title,
          summary: summary.slice(0, 2000),
          url: link.trim(),
          publishedAt: published ? new Date(published) : null,
        });
      }
    }
  }

  return items;
}

// ── Keyword Gate ──

export function matchKeywords(
  title: string,
  summary: string,
  allBusinessLines: BusinessLine[]
): { matchedKeywords: string[]; matchedBusinessLineIds: number[] } {
  const text = `${title} ${summary}`.toLowerCase();
  const matchedKeywords: string[] = [];
  const matchedBusinessLineIds: number[] = [];

  for (const bl of allBusinessLines) {
    if (!bl.isActive || !bl.keywords) continue;
    const keywords = bl.keywords as string[];
    const hits = keywords.filter(kw => text.includes(kw.toLowerCase()));
    if (hits.length > 0) {
      matchedKeywords.push(...hits);
      matchedBusinessLineIds.push(bl.id);
    }
  }

  return {
    matchedKeywords: Array.from(new Set(matchedKeywords)),
    matchedBusinessLineIds: Array.from(new Set(matchedBusinessLineIds)),
  };
}

// ── Fetch a single RSS feed ──

async function fetchFeed(source: RssSource): Promise<{ items: FeedItem[]; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(source.feedUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Use a current Chrome UA — many sites block outdated or bot-like UAs
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        // Broad Accept header — some servers (e.g. Process Online) return 406 without text/html
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        // Referer and Sec headers help bypass Cloudflare/WAF bot checks
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "no-cache",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { items: [], error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const xml = await response.text();

    // Verify we got XML, not an HTML page
    const trimmed = xml.trim();
    const isXml = trimmed.startsWith("<?xml") || trimmed.startsWith("<rss") || trimmed.startsWith("<feed") || trimmed.includes("<channel>");
    if (!isXml && xml.length > 100) {
      return { items: [], error: "Response is HTML, not RSS/Atom XML" };
    }

    const items = parseRSSFeed(xml);
    return { items };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Provide cleaner error messages
    if (message.includes("abort")) return { items: [], error: "Timeout (20s)" };
    if (message.includes("fetch failed") || message.includes("ENOTFOUND")) return { items: [], error: "DNS/Connection failed" };
    return { items: [], error: message };
  }
}

// ── Harvest all active sources ──

export async function harvestAllFeeds(): Promise<HarvestSummary> {
  const startedAt = new Date().toISOString();
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Load active sources and business lines — Stage 5A: also skip quarantined sources
  const activeSources = await db.select().from(rssSources).where(
    and(eq(rssSources.isActive, true), eq(rssSources.quarantined, false))
  );
  const activeBusinessLines = await db.select().from(businessLines).where(eq(businessLines.isActive, true));

  const results: HarvestResult[] = [];

  for (const source of activeSources) {
    const result: HarvestResult = {
      sourceId: source.id,
      sourceName: source.name,
      fetched: 0,
      newArticles: 0,
      duplicates: 0,
      errors: [],
    };

    const { items, error } = await fetchFeed(source);
    if (error) {
      result.errors.push(error);
      // Update failure tracking
      await db.update(rssSources)
        .set({
          errorCount: sql`${rssSources.errorCount} + 1`,
          failureCount: sql`${rssSources.failureCount} + 1`,
          consecutiveErrors: sql`${rssSources.consecutiveErrors} + 1`,
          lastError: error,
          lastErrorAt: new Date(),
          lastFetchedAt: new Date(),
        })
        .where(eq(rssSources.id, source.id));
      results.push(result);
      continue;
    }

    result.fetched = items.length;

    for (const item of items) {
      const fingerprint = generateFingerprint(item.url, item.title);

      // Check for duplicate
      const existing = await db.select({ id: rawArticles.id })
        .from(rawArticles)
        .where(eq(rawArticles.fingerprint, fingerprint))
        .limit(1);

      if (existing.length > 0) {
        result.duplicates++;
        continue;
      }

      // Apply keyword gate
      const { matchedKeywords, matchedBusinessLineIds } = matchKeywords(
        item.title, item.summary, activeBusinessLines
      );

      const status = matchedKeywords.length > 0 ? "queued" as const : "skipped" as const;

      const articleData: InsertRawArticle = {
        sourceId: source.id,
        fingerprint,
        title: item.title,
        summary: item.summary || null,
        url: item.url,
        publishedAt: item.publishedAt,
        matchedKeywords: matchedKeywords.length > 0 ? matchedKeywords : null,
        matchedBusinessLines: matchedBusinessLineIds.length > 0 ? matchedBusinessLineIds : null,
        status,
      };

      try {
        await db.insert(rawArticles).values(articleData);
        result.newArticles++;
      } catch (insertErr: unknown) {
        // Duplicate key — race condition, skip
        const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
        if (msg.includes("Duplicate")) {
          result.duplicates++;
        } else {
          result.errors.push(`Insert failed for "${item.title}": ${msg}`);
        }
      }
    }

    // Update source metadata on success
    await db.update(rssSources).set({
      lastFetchedAt: new Date(),
      lastFetchCount: result.fetched,
      totalArticles: sql`${rssSources.totalArticles} + ${result.newArticles}`,
      successCount: sql`${rssSources.successCount} + 1`,
      consecutiveErrors: 0, // Reset on success
      lastSuccessAt: new Date(),
    }).where(eq(rssSources.id, source.id));

    results.push(result);
  }

  const completedAt = new Date().toISOString();

  return {
    totalSources: activeSources.length,
    totalFetched: results.reduce((s, r) => s + r.fetched, 0),
    totalNew: results.reduce((s, r) => s + r.newArticles, 0),
    totalDuplicates: results.reduce((s, r) => s + r.duplicates, 0),
    totalErrors: results.reduce((s, r) => s + r.errors.length, 0),
    results,
    startedAt,
    completedAt,
  };
}

// ── Get pipeline stats ──

export async function getPipelineStats() {
  const db = await getDb();
  if (!db) return null;

  const [pending] = await db.select({ count: sql<number>`count(*)` }).from(rawArticles).where(eq(rawArticles.status, "pending"));
  const [queued] = await db.select({ count: sql<number>`count(*)` }).from(rawArticles).where(eq(rawArticles.status, "queued"));
  const [extracted] = await db.select({ count: sql<number>`count(*)` }).from(rawArticles).where(eq(rawArticles.status, "extracted"));
  const [skipped] = await db.select({ count: sql<number>`count(*)` }).from(rawArticles).where(eq(rawArticles.status, "skipped"));
  const [failed] = await db.select({ count: sql<number>`count(*)` }).from(rawArticles).where(eq(rawArticles.status, "failed"));
  const [totalSources] = await db.select({ count: sql<number>`count(*)` }).from(rssSources).where(eq(rssSources.isActive, true));
  const [totalBL] = await db.select({ count: sql<number>`count(*)` }).from(businessLines).where(eq(businessLines.isActive, true));

  return {
    articles: {
      pending: Number(pending.count),
      queued: Number(queued.count),
      extracted: Number(extracted.count),
      skipped: Number(skipped.count),
      failed: Number(failed.count),
      total: Number(pending.count) + Number(queued.count) + Number(extracted.count) + Number(skipped.count) + Number(failed.count),
    },
    activeSources: Number(totalSources.count),
    activeBusinessLines: Number(totalBL.count),
  };
}
