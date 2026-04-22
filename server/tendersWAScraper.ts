/**
 * Tenders WA Scraper
 * ==================
 * Source: https://www.tenders.wa.gov.au/watenders/
 * Purpose: live_tender — active WA government tenders relevant to Atlas Copco PT
 * Access: Session cookie + CSRF nonce POST flow (no public API)
 * Frequency: Daily (runs as part of the main pipeline)
 *
 * Access Method:
 *   1. GET /watenders/tender/search/tender-search.action → JSESSIONID cookie + CSRFNONCE
 *   2. POST /watenders/tender/search/tender-search.action?action=search-from-main-page&CSRFNONCE={nonce}
 *      with body: keywords={keyword}
 *   3. Parse HTML table rows (class="odd"/"even") for tender data
 *
 * Degraded Mode: If session fails or site is unavailable, returns empty array and logs clearly.
 */

import * as cheerio from "cheerio";
import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

const BASE_URL = "https://www.tenders.wa.gov.au/watenders";
const SEARCH_URL = `${BASE_URL}/tender/search/tender-search.action`;

// PT-relevant keywords for Tenders WA search
const SEARCH_KEYWORDS = [
  "mining",
  "oil gas",
  "compressor",
  "drilling",
  "construction",
  "infrastructure",
  "energy",
  "pipeline",
  "processing plant",
  "water treatment",
];

// Categories to include (Tenders WA category names)
const RELEVANT_CATEGORIES = [
  "Building and Facility Construction and Maintenance Services",
  "Engineering and Research and Technology Based Services",
  "Mining",
  "Energy",
  "Oil and Gas",
  "Industrial Cleaning Services",
  "Environmental Services",
  "Plant and Equipment",
  "Utilities",
];

// Agencies to prioritise (partial match)
const PRIORITY_AGENCIES = [
  "Department of Mines",
  "Department of Energy",
  "Water Corporation",
  "Main Roads",
  "Public Transport",
  "Department of Primary Industries",
  "Department of Biodiversity",
  "Horizon Power",
  "Synergy",
  "ATCO",
];

export interface TendersWATender {
  tenderNumber: string;
  title: string;
  agency: string;
  category: string;
  closeDate: string | null;
  url: string;
  keywords: string[];
}

// ── Session Management ──

interface WaSession {
  cookies: string;
  nonce: string;
}

let sessionCache: WaSession | null = null;
let sessionFetchedAt: number = 0;
const SESSION_TTL_MS = 20 * 60 * 1000; // 20 minutes

async function getSession(): Promise<WaSession | null> {
  const now = Date.now();
  if (sessionCache && now - sessionFetchedAt < SESSION_TTL_MS) {
    return sessionCache;
  }

  try {
    const res = await fetch(SEARCH_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
      },
    });

    if (!res.ok) {
      console.warn(`[TendersWA] Session fetch failed: HTTP ${res.status}`);
      return null;
    }

    // Extract JSESSIONID from Set-Cookie
    const setCookieHeader = res.headers.get("set-cookie") || "";
    const jsessionMatch = setCookieHeader.match(/JSESSIONID=([^;]+)/);
    if (!jsessionMatch) {
      console.warn("[TendersWA] No JSESSIONID in response");
      return null;
    }
    const cookies = `JSESSIONID=${jsessionMatch[1]}`;

    // Extract CSRFNONCE from HTML
    const html = await res.text();
    const nonceMatch = html.match(/CSRFNONCE=([A-F0-9]+)/);
    if (!nonceMatch) {
      console.warn("[TendersWA] No CSRFNONCE in page");
      return null;
    }

    sessionCache = { cookies, nonce: nonceMatch[1] };
    sessionFetchedAt = now;
    return sessionCache;
  } catch (err) {
    console.warn(`[TendersWA] Session error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Search ──

async function searchTenders(keyword: string, session: WaSession): Promise<TendersWATender[]> {
  try {
    const url = `${SEARCH_URL}?action=search-from-main-page&CSRFNONCE=${session.nonce}&resetdt=1`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": session.cookies,
        "Referer": SEARCH_URL,
      },
      body: `keywords=${encodeURIComponent(keyword)}`,
    });

    if (!res.ok) {
      // CSRF nonce may have rotated — clear session cache
      if (res.status === 403) {
        sessionCache = null;
      }
      return [];
    }

    const html = await res.text();
    return parseTenderResults(html, keyword);
  } catch (err) {
    console.warn(`[TendersWA] Search error for "${keyword}": ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ── HTML Parsing ──

function parseTenderResults(html: string, keyword: string): TendersWATender[] {
  const $ = cheerio.load(html);
  const tenders: TendersWATender[] = [];

  // Tenders WA results are in table rows with class "odd" or "even"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $('tr.odd, tr.even').each((_idx: number, row: any) => {
    const $row = $(row);
    const cells = $row.find("td");

    if (cells.length < 3) return;

    // Column layout (based on research):
    // [0] Agency (hidden, firstTableColumn)
    // [1] Category (hidden, nowrap)
    // [2] Tender details (left top) — contains title link + tender number + close date
    const agency = $row.find("td.firstTableColumn").text().trim();
    const category = $row.find("td.nowrap").first().text().trim();
    const detailCell = $row.find("td.left.top, td[class*='left'][class*='top']").first();

    // Extract tender number and title from the detail cell
    const titleLink = detailCell.find("a").first();
    const title = titleLink.text().trim();
    const href = titleLink.attr("href") || "";
    const tenderUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;

    // Extract tender number from the text (usually in format "WAT-YYYY-NNNNN" or just a number)
    const detailText = detailCell.text();
    const tenderNumberMatch = detailText.match(/\b(WAT-\d{4}-\d+|\d{5,})\b/);
    const tenderNumber = tenderNumberMatch ? tenderNumberMatch[1] : "";

    // Extract close date
    const closeDateMatch = detailText.match(/Close[sd]?:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    const closeDate = closeDateMatch ? closeDateMatch[1] : null;

    if (!title || title.length < 5) return;

    // Filter out irrelevant categories
    const isRelevantCategory = RELEVANT_CATEGORIES.some(cat =>
      category.toLowerCase().includes(cat.toLowerCase().substring(0, 15))
    );

    // Filter: must have relevant category OR keyword in title
    const titleLower = title.toLowerCase();
    const hasKeywordInTitle = SEARCH_KEYWORDS.some(kw => titleLower.includes(kw.toLowerCase()));

    if (!isRelevantCategory && !hasKeywordInTitle) return;

    tenders.push({
      tenderNumber,
      title,
      agency,
      category,
      closeDate,
      url: tenderUrl,
      keywords: [keyword],
    });
  });

  return tenders;
}

// ── Dedup ──

function dedupTenders(tenders: TendersWATender[]): TendersWATender[] {
  const seen = new Map<string, TendersWATender>();
  for (const t of tenders) {
    const key = t.tenderNumber || t.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) {
      // Merge keywords
      const existing = seen.get(key)!;
      existing.keywords = Array.from(new Set([...existing.keywords, ...t.keywords]));
    } else {
      seen.set(key, { ...t });
    }
  }
  return Array.from(seen.values());
}

// ── LLM Extraction ──

interface ExtractedProject {
  name: string;
  owner: string;
  location: string;
  value: string;
  sector: "mining" | "oil_gas" | "infrastructure" | "energy" | "defence";
  overview: string;
  equipmentSignals: string[];
  priority: "hot" | "warm" | "cold";
  tenderNumber: string;
  tenderCloseDate: string | null;
  sourcePurpose: "live_tender";
}

async function extractProjectFromTender(tender: TendersWATender): Promise<ExtractedProject | null> {
  try {
    const prompt = `You are extracting project intelligence from a Western Australian government tender listing for Atlas Copco Portable Air sales team.

Tender Details:
- Title: ${tender.title}
- Agency: ${tender.agency}
- Category: ${tender.category}
- Tender Number: ${tender.tenderNumber || "Unknown"}
- Close Date: ${tender.closeDate || "Unknown"}
- URL: ${tender.url}

Extract the following as JSON:
{
  "name": "concise project name (max 80 chars)",
  "owner": "the government agency or company name",
  "location": "WA location if determinable, else 'Western Australia'",
  "value": "estimated contract value if mentioned, else 'Unknown'",
  "sector": "one of: mining, oil_gas, infrastructure, energy, defence",
  "overview": "2-3 sentence description of what this tender is for and why Atlas Copco PT equipment (compressors, pumps, BESS) might be relevant",
  "equipmentSignals": ["list of PT equipment types that might be needed: compressor, pump, BESS, nitrogen, etc."],
  "priority": "hot if closing within 30 days or high-value construction/mining, warm if relevant but longer timeline, cold if marginal relevance",
  "tenderNumber": "${tender.tenderNumber || ""}",
  "tenderCloseDate": "${tender.closeDate || "null"}",
  "sourcePurpose": "live_tender"
}

Only return valid JSON. If this tender is not relevant to Atlas Copco PT equipment (compressors, pumps, BESS, nitrogen), return null.`;

    const response = await invokeLLM({
      messages: [
        { role: "system" as const, content: "You extract project intelligence from government tenders. Return valid JSON only, or the word null if not relevant." },
        { role: "user" as const, content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "tender_extraction",
          strict: true,
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              owner: { type: "string" },
              location: { type: "string" },
              value: { type: "string" },
              sector: { type: "string", enum: ["mining", "oil_gas", "infrastructure", "energy", "defence"] },
              overview: { type: "string" },
              equipmentSignals: { type: "array", items: { type: "string" } },
              priority: { type: "string", enum: ["hot", "warm", "cold"] },
              tenderNumber: { type: "string" },
              tenderCloseDate: { type: ["string", "null"] },
              sourcePurpose: { type: "string", enum: ["live_tender"] },
              isRelevant: { type: "boolean" },
            },
            required: ["name", "owner", "location", "value", "sector", "overview", "equipmentSignals", "priority", "tenderNumber", "tenderCloseDate", "sourcePurpose", "isRelevant"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) return null;
    const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

    const parsed = JSON.parse(content);
    if (!parsed.isRelevant) return null;

    return parsed as ExtractedProject;
  } catch (err) {
    console.warn(`[TendersWA] LLM extraction failed for "${tender.title}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Main Export ──

export interface TendersWAResult {
  tendersFound: number;
  tendersRelevant: number;
  projectsCreated: number;
  projectsUpdated: number;
  errors: string[];
  degraded: boolean;
  degradedReason?: string;
}

export async function runTendersWAScraper(reportId: number): Promise<TendersWAResult> {
  const result: TendersWAResult = {
    tendersFound: 0,
    tendersRelevant: 0,
    projectsCreated: 0,
    projectsUpdated: 0,
    errors: [],
    degraded: false,
  };

  // Health check: get session
  const session = await getSession();
  if (!session) {
    result.degraded = true;
    result.degradedReason = "Tenders WA session unavailable (site may be down or CSRF protection changed)";
    console.log(`[TendersWA] ${result.degradedReason}. Skipping.`);
    return result;
  }

  console.log("[TendersWA] Session acquired. Starting tender search...");

  // Search across all keywords
  const allTenders: TendersWATender[] = [];
  for (const keyword of SEARCH_KEYWORDS) {
    const tenders = await searchTenders(keyword, session);
    allTenders.push(...tenders);
    // Rate limit: 1s between searches
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const deduped = dedupTenders(allTenders);
  result.tendersFound = deduped.length;
  console.log(`[TendersWA] Found ${deduped.length} unique tenders across ${SEARCH_KEYWORDS.length} keyword searches`);

  if (deduped.length === 0) {
    return result;
  }

  const db = await getDb();
  if (!db) {
    result.degraded = true;
    result.degradedReason = "Database unavailable";
    return result;
  }

  // Process each tender
  for (const tender of deduped) {
    try {
      // Check if we already have this tender in the DB
      if (tender.tenderNumber) {
        const existing = await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.tenderNumber, tender.tenderNumber))
          .limit(1);

        if (existing.length > 0) {
          // Update sourceLastSeenAt and tenderCloseDate
          await db
            .update(projects)
            .set({
              sourceLastSeenAt: new Date(),
              tenderCloseDate: tender.closeDate ? new Date(tender.closeDate) : undefined,
            })
            .where(eq(projects.tenderNumber, tender.tenderNumber));
          result.projectsUpdated++;
          continue;
        }
      }

      // Extract project via LLM
      const extracted = await extractProjectFromTender(tender);
      if (!extracted) continue;

      result.tendersRelevant++;

      // Build project key
      const projectKey = tender.tenderNumber
        ? `WAT-${tender.tenderNumber}`
        : `WAT-${extracted.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 50)}-${Date.now()}`;

      // Parse close date
      let tenderCloseDate: Date | null = null;
      if (extracted.tenderCloseDate) {
        const parsed = new Date(extracted.tenderCloseDate);
        if (!isNaN(parsed.getTime())) {
          tenderCloseDate = parsed;
        }
      }

      // Insert new project
      await db.insert(projects).values({
        reportId,
        projectKey,
        name: extracted.name,
        location: extracted.location,
        value: extracted.value,
        owner: extracted.owner,
        priority: extracted.priority,
        capexGrade: "Unknown",
        opportunityRoute: "Direct CAPEX",
        sector: extracted.sector,
        isNew: true,
        overview: extracted.overview,
        equipmentSignals: extracted.equipmentSignals,
        contractors: [],
        sources: [{ label: `Tenders WA — ${tender.tenderNumber || tender.title}`, url: tender.url, date: new Date().toISOString().split("T")[0] }],
        lifecycleStatus: "active",
        actionTier: extracted.priority === "hot" ? "tier1_actionable" : extracted.priority === "warm" ? "tier2_warm" : "tier3_monitor",
        sourcePurpose: "live_tender",
        tenderNumber: tender.tenderNumber || null,
        tenderCloseDate: tenderCloseDate,
        sourceLastSeenAt: new Date(),
      });

      result.projectsCreated++;
      console.log(`[TendersWA] Created project: ${extracted.name} (${tender.tenderNumber || "no number"})`);

      // Rate limit LLM calls
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      const msg = `Failed to process tender "${tender.title}": ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
      console.warn(`[TendersWA] ${msg}`);
    }
  }

  console.log(`[TendersWA] Complete — ${result.tendersFound} found, ${result.tendersRelevant} relevant, ${result.projectsCreated} created, ${result.projectsUpdated} updated`);
  return result;
}
