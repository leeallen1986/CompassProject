/**
 * DMIRS Scraper — Server-side API client for the WA MINEDEX database
 *
 * Fetches approved mining proposals from the Department of Mines, Industry
 * Regulation and Safety (DMIRS) via their public JSON API. No authentication
 * required.
 *
 * Strategy:
 * - Weekly run: fetch the most recent 100 approved mining proposals
 * - For each, fetch detail to get operator name
 * - Deduplicates against existing projects by name + operator
 * - Inserts new projects into the database
 * - Zero AI credits — pure API calls
 *
 * API endpoints:
 * - POST /api/EnvironmentRegistration/EnvironmentRegistrationSearch
 * - GET  /api/EnvironmentRegistration/{id}
 */
import { eq, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  projects, reports,
  type InsertProject,
} from "../drizzle/schema";
import crypto from "crypto";
import { scoreProjectAsync } from "./businessLineScoring";

// ── Configuration ──

const BASE_URL = "https://minedex.dmirs.wa.gov.au";
const SEARCH_ENDPOINT = `${BASE_URL}/api/EnvironmentRegistration/EnvironmentRegistrationSearch`;
const DETAIL_ENDPOINT = `${BASE_URL}/api/EnvironmentRegistration`;

/** How many registrations to fetch per run (most recent first) */
const MAX_REGISTRATIONS = 100;

/** Page size for API requests */
const PAGE_SIZE = 50;

/** Delay between detail API calls to avoid rate limiting (ms) */
const REQUEST_DELAY_MS = 500;

/** Only process registrations from the last N days */
const LOOKBACK_DAYS = 90;

// ── Types ──

interface DmirsSearchResult {
  id: number;
  registrationTitle: string;
  environmentRegistrationCategoryDescription: string;
  dateReceived: string;
  environmentRegistrationStatusDescription: string;
  dateApproved: string | null;
  confidentialType: string;
}

interface DmirsSearchResponse {
  limitedResults: DmirsSearchResult[];
  totalResultCount: number;
}

interface DmirsDetail {
  id: number;
  registrationTitle: string;
  environmentRegistrationCategoryDescription: string;
  confidentialType: string;
  dateReceived: string;
  environmentRegistrationStatusDescription: string;
  dateApproved: string | null;
  statusDate: string | null;
  environmentOperator: string | null;
  allocation: boolean;
  environmentAssessmentRegulatorySystemRecordUrl: string | null;
}

interface DmirsScrapeResult {
  totalFetched: number;
  totalDetailsFetched: number;
  totalNewProjects: number;
  totalDuplicates: number;
  totalSkipped: number;
  totalErrors: number;
  errors: string[];
  duration: number;
}

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clean up a registration title to extract a meaningful project name.
 * Removes common suffixes like "MP", "SMP", "Mining Proposal", version numbers.
 */
export function cleanProjectName(title: string): string {
  return title
    .replace(/\s+Mining\s+Proposal.*$/i, "")
    .replace(/\s+MP\s*$/i, "")
    .replace(/\s+SMP\s*-?\s*FINAL$/i, "")
    .replace(/\s+V\d+(\.\d+)?$/i, "")
    .replace(/\s+Revision\s+\d+(\.\d+)?$/i, "")
    .replace(/\s+Amendment\s+\d+(\.\d+)?$/i, "")
    .replace(/\s+Stage\s+\d+[a-z]?$/i, "")
    .replace(/\s+Phase\s+\d+$/i, "")
    .replace(/\s+-\s*$/, "")
    .trim();
}

/**
 * Extract a rough location from the registration title.
 * Many DMIRS titles contain the site/area name.
 */
export function extractLocation(title: string): string {
  // Common WA mining regions
  const regions = [
    "Pilbara", "Goldfields", "Kalgoorlie", "Kimberley", "Mid West",
    "Gascoyne", "South West", "Wheatbelt", "Great Southern", "Esperance",
    "Geraldton", "Karratha", "Port Hedland", "Newman", "Tom Price",
    "Meekatharra", "Leonora", "Laverton", "Wiluna", "Norseman",
    "Kambalda", "Coolgardie", "Leinster", "Mt Magnet", "Cue",
  ];

  const titleLower = title.toLowerCase();
  for (const region of regions) {
    if (titleLower.includes(region.toLowerCase())) {
      return `${region}, WA`;
    }
  }

  return "Western Australia";
}

/**
 * Determine priority based on the registration status and recency.
 */
export function mapPriority(status: string, dateApproved: string | null): "hot" | "warm" | "cold" {
  if (status.toLowerCase() === "approved") {
    if (dateApproved) {
      const approvedDate = new Date(dateApproved);
      const daysSinceApproval = (Date.now() - approvedDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceApproval <= 30) return "hot";
      if (daysSinceApproval <= 90) return "warm";
    }
    return "warm";
  }
  return "cold";
}

/**
 * Determine if a registration title suggests equipment-relevant activity.
 */
export function extractEquipmentSignals(title: string): string[] {
  const signals: string[] = [];
  const t = title.toLowerCase();

  if (t.includes("underground") || t.includes("ug ")) signals.push("Underground mining — ventilation & compressed air");
  if (t.includes("open pit") || t.includes("open cut")) signals.push("Open pit operations — mobile compressors");
  if (t.includes("bore") || t.includes("drill")) signals.push("Drilling operations — compressed air for RC/DD rigs");
  if (t.includes("expansion") || t.includes("extension")) signals.push("Site expansion — additional equipment needs");
  if (t.includes("camp") || t.includes("accommodation")) signals.push("Camp/accommodation — power generation");
  if (t.includes("processing") || t.includes("plant")) signals.push("Processing plant — industrial compressors");
  if (t.includes("tailings") || t.includes("tailing")) signals.push("Tailings management — pumping equipment");
  if (t.includes("infrastructure") || t.includes("substation")) signals.push("Infrastructure build — temporary power & air");
  if (t.includes("iron ore")) signals.push("Iron ore operations — heavy-duty compressors");
  if (t.includes("gold")) signals.push("Gold mining — exploration & production air");
  if (t.includes("lithium") || t.includes("nickel") || t.includes("copper")) signals.push("Battery minerals — growing sector demand");

  if (signals.length === 0) signals.push("Mining proposal approved — potential compressed air demand");

  return signals;
}

// ── API calls ──

async function searchRegistrations(skip: number, take: number): Promise<DmirsSearchResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(SEARCH_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "AtlasCopcoIntelligence/1.0",
      },
      body: JSON.stringify({
        registrationTitle: "",
        registrationId: "",
        environmentRegistrationCategory: "Mining Proposal",
        environmentRegistrationStatus: "Approved",
        tenement: "",
        skip,
        take,
        sort: [{ field: "registrationId", dir: "desc" }],
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`DMIRS search API returned ${response.status}: ${response.statusText}`);
    }

    return await response.json() as DmirsSearchResponse;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function getRegistrationDetail(id: number): Promise<DmirsDetail | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${DETAIL_ENDPOINT}/${id}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AtlasCopcoIntelligence/1.0",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`DMIRS detail API returned ${response.status}`);
    }

    return await response.json() as DmirsDetail;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ── Deduplication ──

async function isDmirsDuplicate(projectName: string, operator: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const normalizedName = projectName.toLowerCase().trim().replace(/\s+/g, " ");
  const existing = await db.select({ id: projects.id, name: projects.name, owner: projects.owner })
    .from(projects)
    .orderBy(desc(projects.id))
    .limit(500);

  for (const p of existing) {
    const existingNorm = p.name.toLowerCase().trim().replace(/\s+/g, " ");
    // Exact match
    if (existingNorm === normalizedName) return true;
    // Substring match (DMIRS titles are often substrings of Projectory names or vice versa)
    if (existingNorm.includes(normalizedName) || normalizedName.includes(existingNorm)) return true;
    // Also check if the cleaned name matches
    const cleanedExisting = cleanProjectName(existingNorm);
    const cleanedNew = cleanProjectName(normalizedName);
    if (cleanedExisting.length > 5 && cleanedNew.length > 5) {
      if (cleanedExisting === cleanedNew) return true;
      if (cleanedExisting.includes(cleanedNew) || cleanedNew.includes(cleanedExisting)) return true;
    }
  }

  return false;
}

// ── Get or create today's report ──

async function getOrCreateTodayReport(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const today = new Date();
  const weekEnding = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const existing = await db.select()
    .from(reports)
    .where(eq(reports.weekEnding, weekEnding))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [result] = await db.insert(reports).values({
    weekEnding,
    generatedTime: today.toISOString(),
    totalProjects: 0,
    hotProjects: 0,
    warmProjects: 0,
    coldProjects: 0,
    confirmedContractors: 0,
    predictedContractors: 0,
    capexOpportunities: 0,
    totalContacts: 0,
    sourcesSearched: "DMIRS MINEDEX",
    newProjectsCount: 0,
    executiveSummaryMain: "Auto-generated from DMIRS MINEDEX scraper.",
  });
  return Number(result.insertId);
}

// ── Main scraper pipeline ──

export async function runDmirsScraper(
  options?: { maxRegistrations?: number; lookbackDays?: number }
): Promise<DmirsScrapeResult> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const maxRegs = options?.maxRegistrations || MAX_REGISTRATIONS;
  const lookback = options?.lookbackDays || LOOKBACK_DAYS;
  const cutoffDate = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000);

  const errors: string[] = [];
  let totalFetched = 0;
  let totalDetailsFetched = 0;
  let totalNewProjects = 0;
  let totalDuplicates = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  console.log(`[DMIRS] Starting scrape — max ${maxRegs} registrations, lookback ${lookback} days...`);

  // Step 1: Fetch registration list (paginated)
  const allRegistrations: DmirsSearchResult[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore && allRegistrations.length < maxRegs) {
    const take = Math.min(PAGE_SIZE, maxRegs - allRegistrations.length);
    try {
      console.log(`[DMIRS] Fetching registrations skip=${skip} take=${take}...`);
      const response = await searchRegistrations(skip, take);
      const results = response.limitedResults;
      totalFetched += results.length;

      // Filter by lookback date
      for (const reg of results) {
        const receivedDate = new Date(reg.dateReceived);
        if (receivedDate >= cutoffDate) {
          allRegistrations.push(reg);
        }
      }

      // Stop if we've gone past the lookback window
      if (results.length > 0) {
        const oldestDate = new Date(results[results.length - 1].dateReceived);
        if (oldestDate < cutoffDate) {
          hasMore = false;
        }
      }

      if (results.length < take) {
        hasMore = false;
      }

      skip += take;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Search page skip=${skip}: ${msg}`);
      totalErrors++;
      hasMore = false;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`[DMIRS] Found ${allRegistrations.length} registrations within ${lookback}-day window (from ${totalFetched} total fetched)`);

  // Step 2: Fetch details and create projects
  const reportId = await getOrCreateTodayReport();

  for (const reg of allRegistrations) {
    const cleanedName = cleanProjectName(reg.registrationTitle);
    if (!cleanedName || cleanedName.length < 3) {
      totalSkipped++;
      continue;
    }

    // Quick dedup check before fetching detail
    const isDup = await isDmirsDuplicate(cleanedName, "");
    if (isDup) {
      totalDuplicates++;
      continue;
    }

    // Fetch detail for operator name
    let detail: DmirsDetail | null = null;
    try {
      detail = await getRegistrationDetail(reg.id);
      totalDetailsFetched++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Detail for ${reg.id}: ${msg}`);
      totalErrors++;
    }

    const operator = detail?.environmentOperator || "Unknown";
    const location = extractLocation(reg.registrationTitle);
    const priority = mapPriority(reg.environmentRegistrationStatusDescription, reg.dateApproved);
    const equipmentSignals = extractEquipmentSignals(reg.registrationTitle);

    const projectKey = `dmirs-${reg.id}`;
    const minedexUrl = `${BASE_URL}/Web/environment-registrations/${reg.id}`;

    const sources: { label: string; url: string; date?: string }[] = [
      { label: "DMIRS MINEDEX", url: minedexUrl, date: reg.dateReceived?.split("T")[0] },
    ];

    if (detail?.environmentAssessmentRegulatorySystemRecordUrl) {
      sources.push({
        label: "EARS Record",
        url: detail.environmentAssessmentRegulatorySystemRecordUrl,
      });
    }

    const projectData: InsertProject = {
      reportId,
      projectKey,
      name: cleanedName,
      location,
      value: "Unknown",
      owner: operator,
      priority,
      capexGrade: "Unknown",
      opportunityRoute: priority === "hot" ? "Direct CAPEX" : "OPEX/Monitor",
      sector: "mining",
      isNew: true,
      stage: `${reg.environmentRegistrationCategoryDescription} — ${reg.environmentRegistrationStatusDescription}`,
      overview: [
        `Mining proposal "${reg.registrationTitle}" approved by DMIRS.`,
        operator !== "Unknown" ? `Operator: ${operator}.` : "",
        `Date received: ${reg.dateReceived?.split("T")[0] || "Unknown"}.`,
        reg.dateApproved ? `Date approved: ${reg.dateApproved.split("T")[0]}.` : "",
        `Registration ID: ${reg.id}.`,
      ].filter(Boolean).join(" "),
      equipmentSignals,
      contractors: operator !== "Unknown"
        ? [{ name: operator, status: "confirmed", confidence: 1.0, detail: "DMIRS registered operator" }]
        : [],
      opportunityNote: `DMIRS mining proposal approval — early-stage signal for equipment demand. ${equipmentSignals[0]}`,
      sources,
      timeline: reg.dateApproved ? `Approved ${reg.dateApproved.split("T")[0]}` : "Pending",
      completion: "",
    };

    try {
      const [dmInserted] = await db.insert(projects).values(projectData).$returningId();
      scoreProjectAsync(dmInserted.id, "DMIRS");
      totalNewProjects++;
      console.log(`[DMIRS] New project: ${cleanedName} (Reg ${reg.id}, Operator: ${operator})`);
    } catch (insertErr) {
      const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
      errors.push(`Insert project "${cleanedName}": ${msg}`);
      totalErrors++;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  // Update report stats
  if (totalNewProjects > 0) {
    const allProjects = await db.select().from(projects).where(eq(projects.reportId, reportId));
    const hot = allProjects.filter(p => p.priority === "hot").length;
    const warm = allProjects.filter(p => p.priority === "warm").length;
    const cold = allProjects.filter(p => p.priority === "cold").length;

    await db.update(reports).set({
      totalProjects: allProjects.length,
      hotProjects: hot,
      warmProjects: warm,
      coldProjects: cold,
      newProjectsCount: totalNewProjects,
    }).where(eq(reports.id, reportId));
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`[DMIRS] Scrape complete in ${duration}s: ${totalNewProjects} new projects, ${totalDuplicates} duplicates, ${totalSkipped} skipped`);

  return {
    totalFetched,
    totalDetailsFetched,
    totalNewProjects,
    totalDuplicates,
    totalSkipped,
    totalErrors,
    errors,
    duration,
  };
}
