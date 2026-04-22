/**
 * QTOL NT Scraper (Queensland Tenders Online — Northern Territory)
 * ================================================================
 * Source: https://tendersonline.nt.gov.au/
 * Purpose: live_tender — active NT government tenders relevant to Atlas Copco PT
 * Access: Public HTML partial API (no auth required)
 * Frequency: Daily (runs as part of the main pipeline)
 *
 * Access Method:
 *   GET /Tender/SearchResults/{status}?page=1&size=50&category={id}&...
 *   Returns HTML partial with <div class="tender-card"> elements
 *
 *   Status options: Current, Closed, Awarded, Future
 *   Category IDs:
 *     1 = Building and Construction
 *     2 = Civil Engineering
 *     4 = Electrical and Mechanical
 *     5 = Hydraulic
 *     6 = Infrastructure
 *     7 = Mining and Resources
 *     8 = Energy
 *
 *   Priority Issuers (Power & Water Corporation tracking):
 *     Agency: "Power and Water Corporation" — all tenders regardless of category
 *     Agency: "Department of Infrastructure, Planning and Logistics" — civil/construction
 *     Agency: "Department of Industry, Tourism and Trade" — mining/resources
 *
 * Degraded Mode: If API returns non-200, returns empty array and logs clearly.
 */

import * as cheerio from "cheerio";
import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

const BASE_URL = "https://tendersonline.nt.gov.au";
const SEARCH_URL = `${BASE_URL}/Tender/SearchResults`;

// Category IDs to search
const RELEVANT_CATEGORIES = [1, 2, 4, 5, 6, 7, 8];

// Priority issuers — always include regardless of category
const PRIORITY_ISSUERS = [
  "power and water",
  "department of infrastructure",
  "department of industry",
  "department of mines",
  "department of primary industry",
  "territory generation",
  "jacobs group",
  "mcconnell dowell",
];

// Keywords to filter tender titles
const RELEVANT_KEYWORDS = [
  "compressor",
  "pump",
  "drilling",
  "mining",
  "construction",
  "infrastructure",
  "energy",
  "water treatment",
  "pipeline",
  "processing",
  "generator",
  "power station",
  "substation",
  "civil",
  "mechanical",
  "electrical",
  "plant",
  "equipment",
  "facility",
];

export interface QtolTender {
  tenderNumber: string;
  title: string;
  agency: string;
  category: string;
  closeDate: string | null;
  openDate: string | null;
  description: string;
  url: string;
  isPriorityIssuer: boolean;
}

// ── Health Check ──

let qtolHealthCheckDone = false;
let qtolIsAvailable = true;

async function checkQtolHealth(): Promise<boolean> {
  if (qtolHealthCheckDone) return qtolIsAvailable;
  qtolHealthCheckDone = true;

  try {
    const res = await fetch(`${SEARCH_URL}/Current?page=1&size=1&category=1`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "X-Requested-With": "XMLHttpRequest",
      },
    }).catch(() => null);

    if (!res || !res.ok) {
      qtolIsAvailable = false;
      console.log(`[QTOL NT] API unavailable (HTTP ${res?.status || "network error"}). Skipping NT monitoring.`);
      return false;
    }

    return true;
  } catch {
    qtolIsAvailable = false;
    console.log("[QTOL NT] Health check failed. Skipping NT monitoring.");
    return false;
  }
}

// ── Fetch Tenders ──

async function fetchTendersByCategory(categoryId: number): Promise<QtolTender[]> {
  const tenders: QtolTender[] = [];
  let page = 1;
  const pageSize = 50;

  while (true) {
    try {
      const url = `${SEARCH_URL}/Current?page=${page}&size=${pageSize}&category=${categoryId}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `${BASE_URL}/Tender/Search`,
        },
      });

      if (!res.ok) break;

      const html = await res.text();
      const pageTenders = parseTenderCards(html);

      if (pageTenders.length === 0) break;

      tenders.push(...pageTenders);

      // If we got fewer results than page size, we're on the last page
      if (pageTenders.length < pageSize) break;

      page++;

      // Rate limit: 500ms between pages
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      console.warn(`[QTOL NT] Error fetching category ${categoryId} page ${page}: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }

  return tenders;
}

// ── Fetch All Priority Issuer Tenders ──

async function fetchPriorityIssuerTenders(): Promise<QtolTender[]> {
  // Fetch all current tenders without category filter to catch Power & Water tenders
  // that may be in categories we don't normally watch
  const tenders: QtolTender[] = [];

  try {
    const url = `${SEARCH_URL}/Current?page=1&size=100`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": `${BASE_URL}/Tender/Search`,
      },
    });

    if (!res.ok) return [];

    const html = await res.text();
    const allTenders = parseTenderCards(html);

    // Filter to priority issuers
    return allTenders.filter(t => {
      const agencyLower = t.agency.toLowerCase();
      return PRIORITY_ISSUERS.some(issuer => agencyLower.includes(issuer));
    }).map(t => ({ ...t, isPriorityIssuer: true }));
  } catch (err) {
    console.warn(`[QTOL NT] Error fetching priority issuer tenders: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ── HTML Parsing ──

function parseTenderCards(html: string): QtolTender[] {
  const $ = cheerio.load(html);
  const tenders: QtolTender[] = [];

  // QTOL NT uses div.tender-card or similar structure
  // Based on research: Alpine.js frontend, HTML partial response
  $(".tender-card, .tender-item, [data-tender-id], tr[data-id]").each((_idx: number, el: any) => {
    const $el = $(el);

    // Try multiple selectors for different possible HTML structures
    const title = $el.find(".tender-title, .title, h3, h4, a[href*='/Tender/']").first().text().trim();
    const agency = $el.find(".agency, .issuer, .organisation, [class*='agency']").first().text().trim();
    const category = $el.find(".category, .type, [class*='category']").first().text().trim();
    const tenderNumber = $el.find(".tender-number, .reference, [class*='number']").first().text().trim()
      || $el.attr("data-tender-id") || $el.attr("data-id") || "";
    const closeDate = $el.find(".close-date, .closing, [class*='close']").first().text().trim() || null;
    const openDate = $el.find(".open-date, .opening, [class*='open']").first().text().trim() || null;
    const description = $el.find(".description, .summary, p").first().text().trim();

    // Get tender URL
    const linkEl = $el.find("a[href*='/Tender/']").first();
    const href = linkEl.attr("href") || "";
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;

    if (!title || title.length < 5) return;

    // Filter: must have relevant keyword or be from priority issuer
    const titleLower = title.toLowerCase();
    const agencyLower = agency.toLowerCase();
    const hasRelevantKeyword = RELEVANT_KEYWORDS.some(kw => titleLower.includes(kw));
    const isPriorityIssuer = PRIORITY_ISSUERS.some(issuer => agencyLower.includes(issuer));

    if (!hasRelevantKeyword && !isPriorityIssuer) return;

    tenders.push({
      tenderNumber,
      title,
      agency,
      category,
      closeDate,
      openDate,
      description,
      url,
      isPriorityIssuer,
    });
  });

  // If no cards found with the above selectors, try table rows (fallback)
  if (tenders.length === 0) {
    $("table tr").each((_idx: number, row: any) => {
      const $row = $(row);
      const cells = $row.find("td");
      if (cells.length < 3) return;

      const titleCell = $row.find("td").eq(0);
      const title = titleCell.find("a").text().trim() || titleCell.text().trim();
      const agency = $row.find("td").eq(1).text().trim();
      const closeDate = $row.find("td").eq(2).text().trim() || null;
      const href = titleCell.find("a").attr("href") || "";
      const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
      const tenderNumber = $row.attr("data-id") || "";

      if (!title || title.length < 5) return;

      const titleLower = title.toLowerCase();
      const agencyLower = agency.toLowerCase();
      const hasRelevantKeyword = RELEVANT_KEYWORDS.some(kw => titleLower.includes(kw));
      const isPriorityIssuer = PRIORITY_ISSUERS.some(issuer => agencyLower.includes(issuer));

      if (!hasRelevantKeyword && !isPriorityIssuer) return;

      tenders.push({
        tenderNumber,
        title,
        agency,
        category: "",
        closeDate,
        openDate: null,
        description: "",
        url,
        isPriorityIssuer,
      });
    });
  }

  return tenders;
}

// ── Dedup ──

function dedupTenders(tenders: QtolTender[]): QtolTender[] {
  const seen = new Map<string, QtolTender>();
  for (const t of tenders) {
    const key = t.tenderNumber || t.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (!seen.has(key)) {
      seen.set(key, t);
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
  isRelevant: boolean;
}

async function extractProjectFromTender(tender: QtolTender): Promise<ExtractedProject | null> {
  try {
    const prompt = `You are extracting project intelligence from a Northern Territory government tender listing for Atlas Copco Portable Air sales team.

Tender Details:
- Title: ${tender.title}
- Agency: ${tender.agency}
- Category: ${tender.category}
- Tender Number: ${tender.tenderNumber || "Unknown"}
- Close Date: ${tender.closeDate || "Unknown"}
- Description: ${tender.description || "Not provided"}
- URL: ${tender.url}
- Priority Issuer: ${tender.isPriorityIssuer ? "Yes (Power & Water / DLI)" : "No"}

Extract the following as JSON. If this tender is not relevant to Atlas Copco PT equipment (compressors, pumps, BESS, nitrogen), set isRelevant to false.

{
  "name": "concise project name (max 80 chars)",
  "owner": "the government agency or company name",
  "location": "NT location if determinable, else 'Northern Territory'",
  "value": "estimated contract value if mentioned, else 'Unknown'",
  "sector": "one of: mining, oil_gas, infrastructure, energy, defence",
  "overview": "2-3 sentence description of what this tender is for and why Atlas Copco PT equipment might be relevant",
  "equipmentSignals": ["list of PT equipment types that might be needed: compressor, pump, BESS, nitrogen, etc."],
  "priority": "hot if closing within 30 days or high-value construction/mining/Power & Water, warm if relevant but longer timeline, cold if marginal",
  "tenderNumber": "${tender.tenderNumber || ""}",
  "tenderCloseDate": "${tender.closeDate || "null"}",
  "isRelevant": true or false
}`;

    const response = await invokeLLM({
      messages: [
        { role: "system" as const, content: "You extract project intelligence from NT government tenders. Return valid JSON only." },
        { role: "user" as const, content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "qtol_extraction",
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
              isRelevant: { type: "boolean" },
            },
            required: ["name", "owner", "location", "value", "sector", "overview", "equipmentSignals", "priority", "tenderNumber", "tenderCloseDate", "isRelevant"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) return null;
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

    const parsed = JSON.parse(content) as ExtractedProject;
    if (!parsed.isRelevant) return null;

    return parsed;
  } catch (err) {
    console.warn(`[QTOL NT] LLM extraction failed for "${tender.title}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Main Export ──

export interface QtolNTResult {
  tendersFound: number;
  tendersRelevant: number;
  projectsCreated: number;
  projectsUpdated: number;
  priorityIssuerTenders: number;
  errors: string[];
  degraded: boolean;
  degradedReason?: string;
}

export async function runQtolNTScraper(reportId: number): Promise<QtolNTResult> {
  const result: QtolNTResult = {
    tendersFound: 0,
    tendersRelevant: 0,
    projectsCreated: 0,
    projectsUpdated: 0,
    priorityIssuerTenders: 0,
    errors: [],
    degraded: false,
  };

  // Health check
  const isAvailable = await checkQtolHealth();
  if (!isAvailable) {
    result.degraded = true;
    result.degradedReason = "QTOL NT API unavailable";
    return result;
  }

  console.log("[QTOL NT] API available. Starting tender search...");

  // Fetch tenders by category
  const allTenders: QtolTender[] = [];
  for (const categoryId of RELEVANT_CATEGORIES) {
    const tenders = await fetchTendersByCategory(categoryId);
    allTenders.push(...tenders);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Also fetch priority issuer tenders (Power & Water, DLI)
  const priorityTenders = await fetchPriorityIssuerTenders();
  allTenders.push(...priorityTenders);

  const deduped = dedupTenders(allTenders);
  result.tendersFound = deduped.length;
  result.priorityIssuerTenders = deduped.filter(t => t.isPriorityIssuer).length;

  console.log(`[QTOL NT] Found ${deduped.length} unique tenders (${result.priorityIssuerTenders} from priority issuers)`);

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
      // Check if we already have this tender
      if (tender.tenderNumber) {
        const existing = await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.tenderNumber, `NT-${tender.tenderNumber}`))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(projects)
            .set({
              sourceLastSeenAt: new Date(),
              tenderCloseDate: tender.closeDate ? new Date(tender.closeDate) : undefined,
            })
            .where(eq(projects.tenderNumber, `NT-${tender.tenderNumber}`));
          result.projectsUpdated++;
          continue;
        }
      }

      // Extract project via LLM
      const extracted = await extractProjectFromTender(tender);
      if (!extracted) continue;

      result.tendersRelevant++;

      const projectKey = tender.tenderNumber
        ? `NT-${tender.tenderNumber}`
        : `NT-${extracted.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 50)}-${Date.now()}`;

      let tenderCloseDate: Date | null = null;
      if (extracted.tenderCloseDate) {
        const parsed = new Date(extracted.tenderCloseDate);
        if (!isNaN(parsed.getTime())) {
          tenderCloseDate = parsed;
        }
      }

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
        sources: [{
          label: `QTOL NT — ${tender.tenderNumber || tender.title}`,
          url: tender.url,
          date: new Date().toISOString().split("T")[0],
        }],
        lifecycleStatus: "active",
        actionTier: extracted.priority === "hot" ? "tier1_actionable" : extracted.priority === "warm" ? "tier2_warm" : "tier3_monitor",
        sourcePurpose: "live_tender",
        tenderNumber: tender.tenderNumber ? `NT-${tender.tenderNumber}` : null,
        tenderCloseDate: tenderCloseDate,
        sourceLastSeenAt: new Date(),
      });

      result.projectsCreated++;
      console.log(`[QTOL NT] Created project: ${extracted.name} (${tender.tenderNumber || "no number"})`);

      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      const msg = `Failed to process tender "${tender.title}": ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
      console.warn(`[QTOL NT] ${msg}`);
    }
  }

  console.log(`[QTOL NT] Complete — ${result.tendersFound} found, ${result.tendersRelevant} relevant, ${result.projectsCreated} created, ${result.projectsUpdated} updated`);
  return result;
}
