/**
 * ASX Targeted Monitoring
 *
 * Monitors ASX announcements from a watchlist of major miners, energy companies,
 * and infrastructure developers. Filters for project development activity and
 * discards purely financial announcements.
 *
 * This is a PRIMARY DISCOVERY source — it detects new projects from ASX announcements.
 *
 * Strategy:
 * 1. Fetch recent announcements for each watchlist company
 * 2. Filter by project-related keywords
 * 3. Discard financial-only announcements
 * 4. Extract project signals and create/update project records
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { projects, reports, businessLines } from "../drizzle/schema";
import type { InsertProject } from "../drizzle/schema";
import { ASX_WATCHLIST, ASX_PROJECT_KEYWORDS, ASX_FINANCIAL_DISCARD_KEYWORDS } from "./sourceConfig";
import { invokeLLM } from "./_core/llm";

// ── Types ──

interface AsxAnnouncement {
  id: string;
  documentDate: string;
  header: string;
  url: string;
  issuerCode: string;
  issuerShortName: string;
  issuerFullName: string;
  marketSensitive: boolean;
  numberOfPages: number;
  size: string;
}

interface AsxProjectSignal {
  companyCode: string;
  companyName: string;
  announcementTitle: string;
  announcementDate: string;
  announcementUrl: string;
  projectName: string;
  projectDescription: string;
  location: string;
  estimatedValue: string;
  stage: string;
  sector: string;
  contractors: string[];
  equipmentSignals: string[];
  businessLineHints: string[];
}

export interface AsxMonitorResult {
  totalCompaniesChecked: number;
  totalAnnouncementsScanned: number;
  totalProjectKeywordMatches: number;
  totalFinancialDiscarded: number;
  totalProjectSignals: number;
  totalNewProjects: number;
  totalDuplicates: number;
  totalErrors: number;
  errors: string[];
  duration: number;
}

// ── ASX API ──

const ASX_API_BASE = "https://www.asx.com.au/asx/v2/statistics/announcements.json";
const RATE_LIMIT_MS = 1500; // 1.5s between requests

async function fetchCompanyAnnouncements(
  companyCode: string,
  daysBack: number = 7
): Promise<AsxAnnouncement[]> {
  try {
    const url = `${ASX_API_BASE}?company_code=${companyCode}&num_items=20`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn(`[ASX] Rate limited for ${companyCode}, waiting...`);
        await sleep(5000);
        return [];
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const announcements: AsxAnnouncement[] = data?.data || [];

    // Filter to recent announcements only
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    return announcements.filter(a => new Date(a.documentDate) >= cutoff);
  } catch (err) {
    console.warn(`[ASX] Failed to fetch ${companyCode}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ── Keyword Filtering ──

function isProjectRelated(title: string): boolean {
  const lower = title.toLowerCase();
  return ASX_PROJECT_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

function isFinancialOnly(title: string): boolean {
  const lower = title.toLowerCase();
  return ASX_FINANCIAL_DISCARD_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

function filterAnnouncements(announcements: AsxAnnouncement[]): {
  projectRelated: AsxAnnouncement[];
  financialDiscarded: number;
} {
  let financialDiscarded = 0;
  const projectRelated: AsxAnnouncement[] = [];

  for (const ann of announcements) {
    if (isFinancialOnly(ann.header)) {
      financialDiscarded++;
      continue;
    }
    if (isProjectRelated(ann.header)) {
      projectRelated.push(ann);
    }
  }

  return { projectRelated, financialDiscarded };
}

// ── LLM Project Signal Extraction ──

async function extractProjectSignals(
  announcements: AsxAnnouncement[],
  company: typeof ASX_WATCHLIST[number]
): Promise<AsxProjectSignal[]> {
  if (announcements.length === 0) return [];

  const announcementList = announcements
    .map(a => `- "${a.header}" (${a.documentDate})`)
    .join("\n");

  const prompt = `You are an Australian mining/energy/infrastructure market intelligence analyst.

Analyse these ASX announcements from ${company.name} (${company.code}) and extract any real PROJECT DEVELOPMENT signals.

Announcements:
${announcementList}

For each announcement that refers to a REAL project (construction, mining, energy, infrastructure development):

Extract:
- projectName: The specific project name
- projectDescription: Brief description of what the project involves
- location: Australian state/region (use abbreviations: WA, NSW, QLD, VIC, SA, TAS, NT, ACT)
- estimatedValue: Dollar value if mentioned, otherwise "Not disclosed"
- stage: Current project stage (feasibility, approved, construction, commissioning, operational)
- sector: One of: mining, energy, infrastructure, oil_gas, defence
- contractors: Any contractors, EPC firms, or service providers mentioned
- equipmentSignals: Any mentions of equipment needs (compressed air, generators, pumps, lighting, dewatering, drilling)
- businessLineHints: Which Atlas Copco PT business lines are relevant: "air" (portable compressors), "pal" (generators/lighting), "pump" (dewatering/flow), "bess" (battery storage)

IMPORTANT RULES:
- Only extract REAL project development activity
- SKIP purely financial results, dividends, share placements
- SKIP quarterly production reports unless they mention new projects
- SKIP exploration results unless they lead to a development decision
- Only Australian projects
- If no real project signals exist, return an empty array

Return JSON: { "signals": [...] }`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You extract structured project signals from ASX announcements. Return valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "asx_signals",
          strict: true,
          schema: {
            type: "object",
            properties: {
              signals: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    projectName: { type: "string" },
                    projectDescription: { type: "string" },
                    location: { type: "string" },
                    estimatedValue: { type: "string" },
                    stage: { type: "string" },
                    sector: { type: "string" },
                    contractors: { type: "array", items: { type: "string" } },
                    equipmentSignals: { type: "array", items: { type: "string" } },
                    businessLineHints: { type: "array", items: { type: "string" } },
                  },
                  required: ["projectName", "projectDescription", "location", "estimatedValue", "stage", "sector", "contractors", "equipmentSignals", "businessLineHints"],
                  additionalProperties: false,
                },
              },
            },
            required: ["signals"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) return [];
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);

    const parsed = JSON.parse(content);
    return (parsed.signals || []).map((s: any) => ({
      companyCode: company.code,
      companyName: company.name,
      announcementTitle: announcements[0]?.header || "",
      announcementDate: announcements[0]?.documentDate || "",
      announcementUrl: `https://www.asx.com.au/asx/statistics/announcements.do?by=asxCode&asxCode=${company.code}`,
      ...s,
    }));
  } catch (err) {
    console.warn(`[ASX] LLM extraction failed for ${company.code}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ── Deduplication ──

async function isAsxDuplicate(projectName: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const normalized = projectName.toLowerCase().trim();
  const existing = await db
    .select({ name: projects.name })
    .from(projects)
    .where(sql`LOWER(${projects.name}) LIKE ${`%${normalized.slice(0, 60)}%`}`)
    .limit(1);

  if (existing.length > 0) return true;

  const words = normalized.split(/\s+/).filter(w => w.length > 3);
  if (words.length >= 2) {
    const pattern = `%${words[0]}%${words[1]}%`;
    const fuzzy = await db
      .select({ name: projects.name })
      .from(projects)
      .where(sql`LOWER(${projects.name}) LIKE ${pattern}`)
      .limit(1);
    if (fuzzy.length > 0) return true;
  }

  return false;
}

// ── Report helper ──

async function getOrCreateTodayReport(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const today = new Date().toISOString().split("T")[0];
  const existing = await db
    .select()
    .from(reports)
    .where(sql`DATE(${reports.createdAt}) = ${today}`)
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [newReport] = await db.insert(reports).values({
    weekEnding: today,
    generatedTime: new Date().toISOString(),
    executiveSummaryMain: "Auto-generated report from ASX monitoring",
    totalProjects: 0,
    hotProjects: 0,
    warmProjects: 0,
    coldProjects: 0,
    newProjectsCount: 0,
  }).$returningId();

  return newReport.id;
}

// ── Business Line Mapping ──

function mapBusinessLineHints(hints: string[]): number[] {
  const ids: number[] = [];
  for (const hint of hints) {
    const h = hint.toLowerCase();
    if (h === "air") ids.push(-1);
    if (h === "bess") ids.push(-2);
    if (h === "pal") ids.push(-3);
    if (h === "pump") ids.push(-4);
  }
  return ids;
}

function mapSector(sector: string): "mining" | "oil_gas" | "infrastructure" | "energy" | "defence" {
  const s = sector.toLowerCase();
  if (s.includes("mining")) return "mining";
  if (s.includes("oil") || s.includes("gas")) return "oil_gas";
  if (s.includes("defence") || s.includes("defense")) return "defence";
  if (s.includes("energy")) return "energy";
  return "infrastructure";
}

function mapPriority(stage: string): "hot" | "warm" | "cold" {
  const s = stage.toLowerCase();
  if (s.includes("construction") || s.includes("commissioning") || s.includes("awarded")) return "hot";
  if (s.includes("approved") || s.includes("tender") || s.includes("feasibility")) return "warm";
  return "cold";
}

// ── Utility ──

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main Monitor ──

export async function runAsxMonitor(daysBack: number = 7): Promise<AsxMonitorResult> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const errors: string[] = [];
  let totalCompaniesChecked = 0;
  let totalAnnouncementsScanned = 0;
  let totalProjectKeywordMatches = 0;
  let totalFinancialDiscarded = 0;
  let totalProjectSignals = 0;
  let totalNewProjects = 0;
  let totalDuplicates = 0;
  let totalErrors = 0;

  console.log(`[ASX] Starting targeted monitoring — ${ASX_WATCHLIST.length} companies, ${daysBack} days lookback...`);

  // Look up business line IDs
  const allBL = await db.select().from(businessLines);
  const blMap: Record<string, number> = {};
  for (const bl of allBL) {
    const name = bl.name.toLowerCase();
    if (name.includes("portable air")) blMap["air"] = bl.id;
    if (name.includes("pal")) blMap["pal"] = bl.id;
    if (name.includes("bess")) blMap["bess"] = bl.id;
    if (name.includes("pump")) blMap["pump"] = bl.id;
  }

  const reportId = await getOrCreateTodayReport();

  // Collect all project-related announcements first
  const companySignals: { company: typeof ASX_WATCHLIST[number]; announcements: AsxAnnouncement[] }[] = [];

  for (const company of ASX_WATCHLIST) {
    totalCompaniesChecked++;
    try {
      const announcements = await fetchCompanyAnnouncements(company.code, daysBack);
      totalAnnouncementsScanned += announcements.length;

      if (announcements.length > 0) {
        const { projectRelated, financialDiscarded } = filterAnnouncements(announcements);
        totalProjectKeywordMatches += projectRelated.length;
        totalFinancialDiscarded += financialDiscarded;

        if (projectRelated.length > 0) {
          companySignals.push({ company, announcements: projectRelated });
        }
      }

      // Rate limit
      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${company.code}: ${msg}`);
      totalErrors++;
    }
  }

  console.log(`[ASX] Scanned ${totalAnnouncementsScanned} announcements from ${totalCompaniesChecked} companies. ${totalProjectKeywordMatches} project-related, ${totalFinancialDiscarded} financial discarded.`);

  // Extract project signals via LLM (batch by company)
  for (const { company, announcements } of companySignals) {
    try {
      const signals = await extractProjectSignals(announcements, company);
      totalProjectSignals += signals.length;

      for (const signal of signals) {
        // Dedup check
        const isDup = await isAsxDuplicate(signal.projectName);
        if (isDup) {
          totalDuplicates++;
          continue;
        }

        // Map business lines
        const rawBLIds = mapBusinessLineHints(signal.businessLineHints);
        const mappedBLIds: number[] = [];
        for (const rawId of rawBLIds) {
          if (rawId === -1 && blMap["air"]) mappedBLIds.push(blMap["air"]);
          if (rawId === -2 && blMap["bess"]) mappedBLIds.push(blMap["bess"]);
          if (rawId === -3 && blMap["pal"]) mappedBLIds.push(blMap["pal"]);
          if (rawId === -4 && blMap["pump"]) mappedBLIds.push(blMap["pump"]);
        }

        const priority = mapPriority(signal.stage);
        const sector = mapSector(signal.sector);

        const projectData: InsertProject = {
          reportId,
          projectKey: `asx-${signal.companyCode.toLowerCase()}-${signal.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 100)}`,
          name: signal.projectName,
          location: signal.location || "Australia",
          value: signal.estimatedValue || "Not disclosed",
          owner: signal.companyName,
          priority,
          capexGrade: "Unknown",
          opportunityRoute: priority === "hot" ? "Direct CAPEX" : priority === "warm" ? "Fleet CAPEX" : "OPEX/Monitor",
          sector,
          isNew: true,
          stage: signal.stage,
          overview: signal.projectDescription,
          equipmentSignals: signal.equipmentSignals,
          contractors: signal.contractors.map(c => ({
            name: c,
            status: "predicted" as const,
            confidence: 0.7,
            detail: `Mentioned in ASX announcement`,
          })),
          opportunityNote: `Detected from ASX announcement by ${signal.companyName} (${signal.companyCode}). ${signal.projectDescription}`,
          sources: [
            {
              label: `ASX: ${signal.companyCode}`,
              url: signal.announcementUrl,
              date: signal.announcementDate,
            },
          ],
          matchedBusinessLines: mappedBLIds.length > 0 ? mappedBLIds : undefined,
        };

        try {
          await db.insert(projects).values(projectData);
          totalNewProjects++;
          console.log(`[ASX] New project: ${signal.projectName} (${signal.companyCode}, ${signal.location})`);
        } catch (insertErr) {
          const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
          if (msg.includes("Duplicate")) {
            totalDuplicates++;
          } else {
            errors.push(`Insert "${signal.projectName}": ${msg}`);
            totalErrors++;
          }
        }
      }

      // Rate limit between LLM calls
      await sleep(1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`LLM ${company.code}: ${msg}`);
      totalErrors++;
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`[ASX] Monitor complete in ${duration}s: ${totalNewProjects} new projects, ${totalDuplicates} duplicates, ${totalProjectSignals} signals extracted`);

  return {
    totalCompaniesChecked,
    totalAnnouncementsScanned,
    totalProjectKeywordMatches,
    totalFinancialDiscarded,
    totalProjectSignals,
    totalNewProjects,
    totalDuplicates,
    totalErrors,
    errors,
    duration,
  };
}

// ── Watchlist Management ──

// In-memory additions (persisted via sourceConfig defaults)
const additionalWatchlist: { code: string; name: string; sector: string }[] = [];
const removedTickers = new Set<string>();

export function getAsxWatchlist() {
  const base = ASX_WATCHLIST.filter(c => !removedTickers.has(c.code));
  return [...base, ...additionalWatchlist];
}

export function addToWatchlist(ticker: string, name: string, sector?: string) {
  removedTickers.delete(ticker);
  if (!additionalWatchlist.some(c => c.code === ticker) && !ASX_WATCHLIST.some(c => c.code === ticker)) {
    additionalWatchlist.push({ code: ticker.toUpperCase(), name, sector: sector || "mining" });
  }
}

export function removeFromWatchlist(ticker: string) {
  removedTickers.add(ticker.toUpperCase());
  const idx = additionalWatchlist.findIndex(c => c.code === ticker.toUpperCase());
  if (idx >= 0) additionalWatchlist.splice(idx, 1);
}

export async function getRecentAsxFindings(limit: number = 20) {
  const db = await getDb();
  if (!db) return [];

  const recent = await db
    .select({
      id: projects.id,
      name: projects.name,
      owner: projects.owner,
      location: projects.location,
      value: projects.value,
      sector: projects.sector,
      priority: projects.priority,
      stage: projects.stage,
      overview: projects.overview,
      sources: projects.sources,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(sql`${projects.projectKey} LIKE 'asx-%'`)
    .orderBy(sql`${projects.createdAt} DESC`)
    .limit(limit);

  return recent;
}

export { runAsxMonitor as scanTargetCompanies };

// ── Exported helpers for testing ──

export const _testing = {
  isProjectRelated,
  isFinancialOnly,
  filterAnnouncements,
  mapBusinessLineHints,
  mapSector,
  mapPriority,
  ASX_WATCHLIST,
  ASX_PROJECT_KEYWORDS,
  ASX_FINANCIAL_DISCARD_KEYWORDS,
};
