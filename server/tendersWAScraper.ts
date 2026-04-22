/**
 * Tenders WA Scraper
 * ==================
 * Source: https://www.tenders.wa.gov.au/watenders/
 * Purpose: live_tender — active WA government tenders relevant to Atlas Copco PT
 * Access: Session cookie + CSRF nonce, single GET of all open tenders, local keyword filter
 * Frequency: Daily (runs as part of the main pipeline)
 *
 * Access Method (corrected after live diagnostics):
 *   1. GET /watenders/index.do → JSESSIONID cookie + CSRFNONCE
 *   2. GET /watenders/tender/search/tender-search.action?action=advanced-tender-search-open-tender&CSRFNONCE={nonce}
 *      → returns ALL open tenders (145+ rows) in a single page
 *   3. Parse HTML: rows have class "odd"/"even" but with extra whitespace — use attribute selector
 *      - Agency: td.nowrap.top.firstTableColumn (hidden)
 *      - Category: td.nowrap.top (second td, hidden)
 *      - Tender number: td[class*="left"][class*="top"] → <b> tag
 *      - Title: td.top → first <a> link text (NOT the img link)
 *      - Close date: span.SUMMARY_CLOSINGDATE
 *   4. Filter locally by keyword/category, then LLM-extract relevant ones
 *
 * Degraded Mode: If session fails or site is unavailable, returns empty array and logs clearly.
 */

import * as cheerio from "cheerio";
import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

const BASE_URL = "https://www.tenders.wa.gov.au/watenders";
const SESSION_URL = `${BASE_URL}/index.do`;
const SEARCH_URL = `${BASE_URL}/tender/search/tender-search.action`;

// PT-relevant keywords for local filtering
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
  "pump",
  "generator",
  "power station",
  "desalination",
];

// Categories to include (Tenders WA UNSPSC category names — partial match)
// Note: "Industrial Cleaning Services" and "Transportation and Storage and Mail Services" removed
// as they produce mostly irrelevant results. LLM handles remaining noise in broad categories.
const RELEVANT_CATEGORIES = [
  "Building and Facility Construction and Maintenance Services",
  "Engineering and Research and Technology Based Services",
  "Mining",
  "Energy",
  "Oil and Gas",
  "Environmental Services",
  "Plant and Equipment",
  "Utilities",
  "Industrial Production and Manufacturing Services",
  "Building and Construction Machinery",
  "Power Generation and Distribution Machinery",
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
  "Woodside",
  "Rio Tinto",
  "BHP",
  "Fortescue",
  "Chevron",
  "Santos",
];

export interface TendersWATender {
  tenderNumber: string;
  tenderId: string;
  title: string;
  agency: string;
  category: string;
  closeDate: string | null;
  url: string;
  matchedKeywords: string[];
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
    const res = await fetch(SESSION_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
      },
      redirect: "follow",
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

    // Extract CSRFNONCE from HTML — it appears as var nonce = "CSRFNONCE=XXXXX" or in href attributes
    const html = await res.text();
    const nonceMatch = html.match(/CSRFNONCE=([A-F0-9]{32})/);
    if (!nonceMatch) {
      console.warn("[TendersWA] No CSRFNONCE in page");
      return null;
    }

    sessionCache = { cookies, nonce: nonceMatch[1] };
    sessionFetchedAt = now;
    console.log(`[TendersWA] Session acquired (NONCE: ${nonceMatch[1].substring(0, 8)}...)`);
    return sessionCache;
  } catch (err) {
    console.warn(`[TendersWA] Session error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Fetch All Open Tenders ──

async function fetchAllOpenTenders(session: WaSession): Promise<string> {
  const url = `${SEARCH_URL}?action=advanced-tender-search-open-tender&CSRFNONCE=${session.nonce}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-AU,en;q=0.9",
      "Cookie": session.cookies,
      "Referer": SESSION_URL,
    },
  });

  if (!res.ok) {
    if (res.status === 403) {
      sessionCache = null; // CSRF nonce rotated
    }
    throw new Error(`HTTP ${res.status} fetching open tenders`);
  }

  return res.text();
}

// ── HTML Parsing ──

function parseTenderResults(html: string): TendersWATender[] {
  const $ = cheerio.load(html);
  const tenders: TendersWATender[] = [];

  // Rows have class "odd" or "even" but with extra whitespace in the attribute
  // Use a filter approach instead of class selector to handle whitespace
  $("tr").filter((_idx, el) => {
    const cls = ($(el).attr("class") || "").trim();
    return cls === "odd" || cls === "even";
  }).each((_idx, row) => {
    const $row = $(row);

    // Agency: first td with firstTableColumn class (hidden via CSS)
    const agency = $row.find("td.firstTableColumn").text().trim();

    // Category: td.nowrap that does NOT have firstTableColumn (i.e., the second td.nowrap)
    const category = $row.find("td.nowrap").filter((_i, el) => {
      const cls = $(el).attr("class") || "";
      return !cls.includes("firstTableColumn");
    }).first().text().trim();

    // Tender number: td with both "left" and "top" in class → <b> tag
    const tenderNumCell = $row.find("td").filter((_i, el) => {
      const cls = $(el).attr("class") || "";
      return cls.includes("left") && cls.includes("top");
    }).first();
    const tenderNumber = tenderNumCell.find("b").first().text().trim();

    // Title: td.top that does NOT have "nowrap" AND does NOT have "left" in class
    const titleCell = $row.find("td.top").filter((_i, el) => {
      const cls = $(el).attr("class") || "";
      return !cls.includes("nowrap") && !cls.includes("left");
    }).first();

    // Find the first anchor that contains text (not just an image)
    let title = "";
    let href = "";
    let tenderId = "";
    titleCell.find("a").each((_i, anchor) => {
      const $a = $(anchor);
      const text = $a.text().trim();
      const h = $a.attr("href") || "";
      if (text && text.length > 3 && !$a.find("img").length) {
        title = text;
        href = h;
        // Extract tender ID from URL: ?id=12345
        const idMatch = h.match(/[?&]id=(\d+)/);
        tenderId = idMatch ? idMatch[1] : "";
        return false; // break
      }
    });

    // Close date: span.SUMMARY_CLOSINGDATE
    const closeDateRaw = $row.find("span.SUMMARY_CLOSINGDATE").text().trim();
    const closeDate = closeDateRaw || null;

    if (!title || title.length < 5) return;

    const tenderUrl = href.startsWith("http") ? href : `https://www.tenders.wa.gov.au${href}`;

    // Local keyword + category filter
    const titleLower = title.toLowerCase();
    const categoryLower = category.toLowerCase();
    const agencyLower = agency.toLowerCase();

    const matchedKeywords = SEARCH_KEYWORDS.filter(kw =>
      titleLower.includes(kw.toLowerCase()) ||
      categoryLower.includes(kw.toLowerCase())
    );

    const isRelevantCategory = RELEVANT_CATEGORIES.some(cat =>
      categoryLower.includes(cat.toLowerCase().substring(0, 20))
    );

    const isPriorityAgency = PRIORITY_AGENCIES.some(ag =>
      agencyLower.includes(ag.toLowerCase().substring(0, 15))
    );

    // Keep if: relevant category OR keyword match OR priority agency
    if (!isRelevantCategory && matchedKeywords.length === 0 && !isPriorityAgency) return;

    tenders.push({
      tenderNumber,
      tenderId,
      title,
      agency,
      category,
      closeDate,
      url: tenderUrl,
      matchedKeywords: matchedKeywords.length > 0 ? matchedKeywords : ["category-match"],
    });
  });

  return tenders;
}

// ── Dedup ──

function dedupTenders(tenders: TendersWATender[]): TendersWATender[] {
  const seen = new Map<string, TendersWATender>();
  for (const t of tenders) {
    const key = t.tenderId || t.tenderNumber || t.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (!seen.has(key)) {
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
  isRelevant: boolean;
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

Extract the following as JSON. Set isRelevant=false if this tender has no plausible connection to portable compressed air, pumps, BESS, nitrogen, or similar PT equipment.

{
  "name": "concise project name (max 80 chars)",
  "owner": "the government agency or company name",
  "location": "WA location if determinable, else 'Western Australia'",
  "value": "estimated contract value if mentioned, else 'Unknown'",
  "sector": "one of: mining, oil_gas, infrastructure, energy, defence",
  "overview": "2-3 sentence description of what this tender is for and why Atlas Copco PT equipment might be relevant",
  "equipmentSignals": ["list of PT equipment types that might be needed"],
  "priority": "hot if closing within 30 days or high-value construction/mining, warm if relevant but longer timeline, cold if marginal relevance",
  "tenderNumber": "${tender.tenderNumber || ""}",
  "tenderCloseDate": "${tender.closeDate || "null"}",
  "sourcePurpose": "live_tender",
  "isRelevant": true or false
}`;

    const response = await invokeLLM({
      messages: [
        { role: "system" as const, content: "You extract project intelligence from government tenders. Return valid JSON only." },
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
  tendersFiltered: number;
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
    tendersFiltered: 0,
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

  // Fetch all open tenders in one request
  let html: string;
  try {
    html = await fetchAllOpenTenders(session);
  } catch (err) {
    result.degraded = true;
    result.degradedReason = `Failed to fetch open tenders: ${err instanceof Error ? err.message : String(err)}`;
    console.log(`[TendersWA] ${result.degradedReason}. Skipping.`);
    return result;
  }

  // Parse and filter
  const allTenders = parseTenderResults(html);
  const deduped = dedupTenders(allTenders);
  result.tendersFound = deduped.length;
  console.log(`[TendersWA] Found ${deduped.length} relevant tenders after local filter (from full open tender list)`);

  if (deduped.length === 0) {
    return result;
  }

  const db = await getDb();
  if (!db) {
    result.degraded = true;
    result.degradedReason = "Database unavailable";
    return result;
  }

  // ── Bounded concurrency pool (5 workers) ──
  // Each worker processes one tender at a time. This reduces wall-clock time
  // from ~4-5 min (sequential + 500ms delay) to ~1-2 min without overwhelming
  // the LLM API. Errors are isolated per tender; degraded mode is unaffected.
  const CONCURRENCY = 5;

  // Shared counters — updated atomically (JS is single-threaded, no mutex needed)
  const processTender = async (tender: TendersWATender): Promise<void> => {
    try {
      // Check if we already have this tender in the DB (by tenderId or tenderNumber)
      const lookupKey = tender.tenderId ? `WAT-${tender.tenderId}` : null;
      if (lookupKey) {
        const existing = await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.tenderNumber, lookupKey))
          .limit(1);

        if (existing.length > 0) {
          // Update sourceLastSeenAt and tenderCloseDate
          await db
            .update(projects)
            .set({
              sourceLastSeenAt: new Date(),
              tenderCloseDate: tender.closeDate ? new Date(tender.closeDate) : undefined,
            })
            .where(eq(projects.tenderNumber, lookupKey));
          result.projectsUpdated++;
          return;
        }
      }

      // Extract project via LLM
      const extracted = await extractProjectFromTender(tender);
      if (!extracted) {
        result.tendersFiltered++;
        return;
      }

      result.tendersRelevant++;

      // Build project key using tender ID (stable) or fallback
      const projectKey = tender.tenderId
        ? `WAT-${tender.tenderId}`
        : `WAT-${extracted.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 50)}-${Date.now()}`;

      // Parse close date — Tenders WA format: "19 Jun, 2026 2:00 PM"
      let tenderCloseDate: Date | null = null;
      if (tender.closeDate) {
        const parsed = new Date(tender.closeDate);
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
        tenderNumber: projectKey,
        tenderCloseDate: tenderCloseDate,
        sourceLastSeenAt: new Date(),
      });

      result.projectsCreated++;
      console.log(`[TendersWA] Created: ${extracted.name} (${projectKey}, closes: ${tender.closeDate || "unknown"})`);
    } catch (err) {
      const msg = `Failed to process tender "${tender.title}": ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
      console.warn(`[TendersWA] ${msg}`);
    }
  };

  // Process deduped list in batches of CONCURRENCY
  for (let i = 0; i < deduped.length; i += CONCURRENCY) {
    const batch = deduped.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processTender));
  }

  console.log(`[TendersWA] Complete — ${result.tendersFound} found, ${result.tendersFiltered} filtered by LLM, ${result.tendersRelevant} relevant, ${result.projectsCreated} created, ${result.projectsUpdated} updated`);
  return result;
}
