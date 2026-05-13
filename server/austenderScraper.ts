/**
 * AusTender Scraper
 *
 * Fetches recent government contracts from the AusTender OCDS API
 * (Open Contracting Data Standard). No authentication required.
 *
 * API: https://api.tenders.gov.au/ocds/
 * Endpoint: findByDates/contractPublished/{startDate}/{endDate}
 *
 * Filters for construction, mining, infrastructure, water, and energy
 * contracts over $1M that are relevant to Atlas Copco PT business lines.
 *
 * UNSPSC Classification Codes of interest:
 * - 72000000: Building and Facility Construction and Maintenance
 * - 20000000: Mining and Well Drilling Machinery and Accessories
 * - 40000000: Distribution and Conditioning Systems and Equipment
 * - 26000000: Power Generation and Distribution Machinery
 * - 30000000: Structures and Building and Construction Components
 * - 46000000: Defence and Law Enforcement and Security Equipment
 * - 70000000: Farming and Fishing and Forestry and Wildlife Machinery
 * - 39000000: Laboratory and Measuring and Observing Equipment
 *
 * Runs weekly (Thursdays) as part of the daily pipeline.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { projects, reports, businessLines } from "../drizzle/schema";
import type { InsertProject } from "../drizzle/schema";
import { generateAndEnrichContacts } from "./contactEnrichment";
import { scoreProjectAsync } from "./businessLineScoring";

// ── Types ──

interface OcdsRelease {
  ocid: string;
  id: string;
  date: string;
  parties: {
    id: string;
    name: string;
    roles: string[];
    additionalIdentifiers?: { id: string; scheme: string }[];
    address?: {
      locality?: string;
      region?: string;
      postalCode?: string;
      countryName?: string;
    };
    contactPoint?: {
      name?: string;
      email?: string;
    };
  }[];
  awards?: {
    id: string;
    suppliers: { id: string; name: string }[];
    status: string;
    date: string;
  }[];
  contracts?: {
    id: string;
    awardID: string;
    dateSigned: string;
    description: string;
    title: string;
    items?: {
      id: string;
      classification?: {
        scheme: string;
        id: string;
      };
    }[];
    period?: {
      startDate: string;
      endDate: string;
    };
    value?: {
      currency: string;
      amount: string;
    };
    status: string;
  }[];
  tender?: {
    id: string;
    procurementMethod: string;
    procurementMethodDetails?: string;
  };
}

interface OcdsResponse {
  uri: string;
  publisher: { name: string };
  publishedDate: string;
  releases: OcdsRelease[];
}

export interface AusTenderScrapeResult {
  totalFetched: number;
  totalRelevant: number;
  totalNewProjects: number;
  totalDuplicates: number;
  totalSkipped: number;
  totalErrors: number;
  errors: string[];
  duration: number;
}

// ── Configuration ──

const AUSTENDER_API_BASE = "https://api.tenders.gov.au/ocds";
const MIN_CONTRACT_VALUE = 500_000; // $500K minimum (widened from $1M)
const LOOKBACK_DAYS = 30; // Fetch last 30 days of contracts (widened from 14)

// UNSPSC codes relevant to Atlas Copco PT business lines (broadened)
const RELEVANT_UNSPSC_PREFIXES = [
  "72", // Building and Facility Construction
  "20", // Mining and Well Drilling Machinery
  "40", // Distribution and Conditioning Systems
  "26", // Power Generation and Distribution
  "30", // Structures and Building Components
  "46", // Defence and Security Equipment
  "22", // Building and Construction Machinery
  "15", // Fuel and Lubricants and Anti-corrosive Materials
  "81", // Engineering and Research Services
  "83", // Public Utilities and Public Sector Related Services
  "77", // Environmental Management
  "78", // Transportation and Storage
  "76", // Industrial Cleaning Services
  "25", // Commercial and Military and Private Vehicles
  "23", // Industrial Manufacturing and Processing Machinery
  "21", // Farming and Fishing and Forestry and Wildlife Machinery
  "47", // Cleaning Equipment and Supplies
  "39", // Laboratory and Measuring Equipment
  "41", // Laboratory and Scientific Equipment
  "73", // Industrial Production and Manufacturing Services
];

// Keywords that indicate relevance to PT equipment (significantly broadened)
const RELEVANCE_KEYWORDS = [
  // Portable Air — core
  "compressor", "compressed air", "drilling", "tunnelling", "tunnel",
  "blasting", "excavation", "concrete", "construction", "civil works",
  "road construction", "bridge", "earthworks", "foundation",
  "piling", "driven pile", "bored pile", "CFA pile", "sheet pile",
  "pile driving", "grouting", "shotcrete", "formwork",
  "quarry", "aggregate", "crusher", "screening",
  // Waterwell / Bore drilling
  "water well", "waterwell", "water bore", "bore drilling",
  "borehole", "groundwater bore", "dewatering bore",
  // Shutdown / Turnaround
  "shutdown", "turnaround", "plant turnaround", "planned outage",
  "maintenance shutdown", "refinery shutdown", "facility shutdown",
  // Abrasive Blasting / Surface Prep
  "abrasive blasting", "grit blasting", "surface preparation",
  "blast and paint", "corrosion protection", "protective coating",
  // Specialty Air / Gas
  "nitrogen", "purging", "inerting", "commissioning air",
  "pipeline testing", "pressure testing", "leak testing",
  "pre-commissioning", "precommissioning", "nitrogen purge",
  "pipeline purge", "pipeline commissioning",
  // Temporary Plant Air
  "site air", "construction air", "temporary air supply",
  "plant air", "hire compressor", "rental compressor",
  // PAL (Power and Light)
  "generator", "power supply", "temporary power", "lighting",
  "substation", "transmission", "powerline",
  "switchgear", "transformer", "high voltage", "power station", "turbine",
  // BESS
  "battery", "energy storage", "bess", "solar farm", "wind farm",
  "renewable energy", "grid", "inverter", "solar", "wind",
  "photovoltaic", "hydrogen", "electrolysis",
  // Pump
  "pump", "dewatering", "water treatment", "pipeline", "sewage",
  "irrigation", "dam", "weir", "desalination",
  "water supply", "flood", "drainage", "wastewater", "bore",
  "groundwater", "aquifer", "reservoir", "water main",
  "water infrastructure", "sewer", "catchment",
  // General construction & infrastructure (tightened — removed generic false positives)
  "mining", "mine site", "rail", "railway", "port", "wharf",
  "defence", "military", "base", "facility", "infrastructure",
  "maintenance", "upgrade", "expansion",
  "highway", "depot", "warehouse", "terminal",
  "site preparation", "site works", "bulk earth",
  // Resource sector
  "ore", "mineral", "coal", "iron", "gold", "copper", "lithium",
  "nickel", "zinc", "bauxite", "alumina", "rare earth",
  "oil", "gas", "petroleum", "lng", "refinery", "petrochemical",
];

// ── Business Line Matching ──

function matchBusinessLinesFromContract(description: string, unspscCodes: string[]): ("air" | "pal" | "bess" | "pump")[] {
  const text = description.toLowerCase();
  const lines = new Set<"air" | "pal" | "bess" | "pump">();

  // Portable Air signals
  if (
    text.includes("compressor") || text.includes("compressed air") ||
    text.includes("drilling") || text.includes("tunnelling") || text.includes("tunnel") ||
    text.includes("blasting") || text.includes("excavation") ||
    // Blasting/coatings/surface prep — key Portable Air shutdown/maintenance signals
    text.includes("blast and paint") || text.includes("abrasive blasting") ||
    text.includes("grit blasting") || text.includes("surface preparation") ||
    text.includes("corrosion protection") || text.includes("protective coating") ||
    text.includes("shutdown") || text.includes("turnaround") ||
    text.includes("concrete") || text.includes("construction") ||
    text.includes("civil works") || text.includes("road") ||
    text.includes("bridge") || text.includes("earthworks") ||
    text.includes("mining") || text.includes("mine site") ||
    text.includes("rail") || text.includes("port") ||
    text.includes("defence") || text.includes("military")
  ) {
    lines.add("air");
  }

  // PAL signals
  if (
    text.includes("generator") || text.includes("power supply") ||
    text.includes("temporary power") || text.includes("lighting") ||
    text.includes("electrical") || text.includes("substation") ||
    text.includes("transmission") || text.includes("powerline") ||
    text.includes("construction") || text.includes("defence") ||
    text.includes("facility")
  ) {
    lines.add("pal");
  }

  // BESS signals
  if (
    text.includes("battery") || text.includes("energy storage") ||
    text.includes("bess") || text.includes("solar") ||
    text.includes("wind farm") || text.includes("renewable") ||
    text.includes("inverter") || text.includes("grid")
  ) {
    lines.add("bess");
  }

  // Pump signals
  if (
    text.includes("pump") || text.includes("dewatering") ||
    text.includes("water treatment") || text.includes("pipeline") ||
    text.includes("sewage") || text.includes("stormwater") ||
    text.includes("irrigation") || text.includes("dam") ||
    text.includes("weir") || text.includes("desalination") ||
    text.includes("water supply") || text.includes("flood") ||
    text.includes("drainage")
  ) {
    lines.add("pump");
  }

  // UNSPSC-based matching
  for (const code of unspscCodes) {
    if (code.startsWith("20")) lines.add("air"); // Mining machinery
    if (code.startsWith("72")) { lines.add("air"); lines.add("pal"); } // Construction
    if (code.startsWith("26")) { lines.add("pal"); lines.add("bess"); } // Power generation
    if (code.startsWith("40")) lines.add("pump"); // Distribution/conditioning
    if (code.startsWith("46")) { lines.add("air"); lines.add("pal"); } // Defence
  }

  // Default: if construction-related, at least air + pal
  if (lines.size === 0) {
    const hasConstruction = unspscCodes.some(c => c.startsWith("72") || c.startsWith("30"));
    if (hasConstruction) {
      lines.add("air");
      lines.add("pal");
    }
  }

  return Array.from(lines);
}

function isRelevantContract(release: OcdsRelease): boolean {
  const contract = release.contracts?.[0];
  if (!contract) return false;

  // Check value threshold
  const value = parseFloat(contract.value?.amount || "0");
  if (value < MIN_CONTRACT_VALUE) return false;

  // Check UNSPSC codes
  const unspscCodes = (contract.items || [])
    .map(i => i.classification?.id || "")
    .filter(Boolean);

  const hasRelevantCode = unspscCodes.some(code =>
    RELEVANT_UNSPSC_PREFIXES.some(prefix => code.startsWith(prefix))
  );

  // Check description keywords
  const description = (contract.description || "").toLowerCase() + " " + (contract.title || "").toLowerCase();
  const hasRelevantKeyword = RELEVANCE_KEYWORDS.some(kw => description.includes(kw));

  return hasRelevantCode || hasRelevantKeyword;
}

// ── Priority and CAPEX mapping ──

function mapPriority(value: number, endDate?: string): "hot" | "warm" | "cold" {
  // Active contracts with high value are hot
  if (value >= 50_000_000) return "hot"; // $50M+
  if (value >= 10_000_000) return "warm"; // $10M+
  return "cold";
}

function mapCapexGrade(value: number): "A" | "B" | "Unknown" {
  if (value >= 100_000_000) return "A"; // $100M+
  if (value >= 10_000_000) return "B"; // $10M+
  return "Unknown";
}

function mapSectorFromUnspsc(unspscCodes: string[], description: string): "infrastructure" | "energy" | "mining" | "oil_gas" | "defence" {
  const text = description.toLowerCase();

  if (text.includes("defence") || text.includes("military") || text.includes("navy") || text.includes("army") || text.includes("air force")) {
    return "defence";
  }
  if (text.includes("mining") || text.includes("mine site") || text.includes("mineral")) {
    return "mining";
  }
  if (text.includes("oil") || text.includes("gas") || text.includes("petroleum") || text.includes("lng")) {
    return "oil_gas";
  }
  if (text.includes("solar") || text.includes("wind") || text.includes("battery") || text.includes("energy") || text.includes("renewable") || text.includes("transmission")) {
    return "energy";
  }

  // UNSPSC-based
  if (unspscCodes.some(c => c.startsWith("46"))) return "defence";
  if (unspscCodes.some(c => c.startsWith("20"))) return "mining";
  if (unspscCodes.some(c => c.startsWith("26"))) return "energy";

  return "infrastructure";
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${amount.toLocaleString()}`;
}

// ── API Fetch ──

async function fetchAusTenderContracts(startDate: string, endDate: string): Promise<OcdsRelease[]> {
  const url = `${AUSTENDER_API_BASE}/findByDates/contractPublished/${startDate}/${endDate}`;
  console.log(`[AusTender] Fetching: ${url}`);

  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "AtlasCopco-MarketIntelligence/1.0",
    },
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`AusTender API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as OcdsResponse;
  return data.releases || [];
}

// ── Deduplication ──

async function isAusTenderDuplicate(contractId: string, projectName: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Check by contract ID in projectKey
  const byKey = await db
    .select({ id: projects.id })
    .from(projects)
    .where(sql`${projects.projectKey} = ${`austender-${contractId}`}`)
    .limit(1);

  if (byKey.length > 0) return true;

  // Fuzzy match on name
  const normalized = projectName.toLowerCase().trim();
  const existing = await db
    .select({ name: projects.name })
    .from(projects)
    .where(sql`LOWER(${projects.name}) LIKE ${`%${normalized.slice(0, 60)}%`}`)
    .limit(1);

  return existing.length > 0;
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
    executiveSummaryMain: "Auto-generated report from AusTender scraper",
    totalProjects: 0,
    hotProjects: 0,
    warmProjects: 0,
    coldProjects: 0,
    newProjectsCount: 0,
  }).$returningId();

  return newReport.id;
}

// ── Main Scraper ──

export async function runAusTenderScraper(): Promise<AusTenderScrapeResult> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const errors: string[] = [];
  let totalFetched = 0;
  let totalRelevant = 0;
  let totalNewProjects = 0;
  let totalDuplicates = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  console.log("[AusTender] Starting scrape...");

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - LOOKBACK_DAYS);

  const startIso = startDate.toISOString().replace(/\.\d{3}Z$/, "Z");
  const endIso = endDate.toISOString().replace(/\.\d{3}Z$/, "Z");

  // Fetch from API
  let releases: OcdsRelease[];
  try {
    releases = await fetchAusTenderContracts(startIso, endIso);
    totalFetched = releases.length;
    console.log(`[AusTender] Fetched ${totalFetched} contracts from last ${LOOKBACK_DAYS} days`);
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    console.error(`[AusTender] API fetch failed: ${msg}`);
    return {
      totalFetched: 0,
      totalRelevant: 0,
      totalNewProjects: 0,
      totalDuplicates: 0,
      totalSkipped: 0,
      totalErrors: 1,
      errors: [msg],
      duration: Math.round((Date.now() - startTime) / 1000),
    };
  }

  // Filter for relevant contracts
  const relevantReleases = releases.filter(isRelevantContract);
  totalRelevant = relevantReleases.length;
  totalSkipped = totalFetched - totalRelevant;
  console.log(`[AusTender] ${totalRelevant} relevant contracts (${totalSkipped} skipped — below threshold or irrelevant sector)`);

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

  // Process each relevant contract
  for (const release of relevantReleases) {
    const contract = release.contracts?.[0];
    if (!contract) continue;

    const contractId = contract.id || release.ocid;
    const value = parseFloat(contract.value?.amount || "0");
    const description = contract.description || contract.title || "Government contract";
    const title = contract.title || description.slice(0, 100);

    // Get supplier and procuring entity
    const supplier = release.parties.find(p => p.roles.includes("supplier"));
    const procuringEntity = release.parties.find(p => p.roles.includes("procuringEntity"));
    const location = supplier?.address?.region || procuringEntity?.address?.region || "Australia";

    // Build project name
    const projectName = `${title} — ${procuringEntity?.name || "Commonwealth"}`.slice(0, 200);

    // Dedup check
    const isDup = await isAusTenderDuplicate(contractId, projectName);
    if (isDup) {
      totalDuplicates++;
      continue;
    }

    // Classify
    const unspscCodes = (contract.items || []).map(i => i.classification?.id || "").filter(Boolean);
    const matchedLines = matchBusinessLinesFromContract(description + " " + title, unspscCodes);
    const mappedBLIds: number[] = [];
    for (const line of matchedLines) {
      if (blMap[line]) mappedBLIds.push(blMap[line]);
    }

    const priority = mapPriority(value, contract.period?.endDate);
    const capexGrade = mapCapexGrade(value);
    const sector = mapSectorFromUnspsc(unspscCodes, description + " " + title);

    // Build equipment signals based on business lines
    const equipmentSignals: string[] = [];
    if (matchedLines.includes("air")) equipmentSignals.push("Portable air compressors for construction/maintenance works");
    if (matchedLines.includes("pal")) equipmentSignals.push("Temporary power generation and lighting towers");
    if (matchedLines.includes("bess")) equipmentSignals.push("Battery energy storage systems for energy projects");
    if (matchedLines.includes("pump")) equipmentSignals.push("Dewatering and water management pump systems");

    const projectData: InsertProject = {
      reportId,
      projectKey: `austender-${contractId}`,
      name: projectName,
      location: `${location}, Australia`,
      value: formatCurrency(value),
      owner: procuringEntity?.name || "Commonwealth of Australia",
      priority,
      capexGrade,
      opportunityRoute: priority === "hot" ? "Direct CAPEX" : priority === "warm" ? "Fleet CAPEX" : "OPEX/Monitor",
      sector,
      isNew: true,
      stage: "Awarded — Active Contract",
      overview: description,
      equipmentSignals,
      contractors: supplier
        ? [{ name: supplier.name, status: "confirmed", confidence: 1.0, detail: `AusTender contract ${contractId}` }]
        : [],
      opportunityNote: `AusTender contract ${contractId} — ${formatCurrency(value)} awarded to ${supplier?.name || "TBC"}. ${equipmentSignals[0] || ""}`,
      sources: [
        { label: "AusTender", url: `https://www.tenders.gov.au/Search/Cn?CnId=${contractId}`, date: contract.dateSigned || new Date().toISOString().split("T")[0] },
      ],
      timeline: contract.period
        ? `${new Date(contract.period.startDate).toLocaleDateString("en-AU")} — ${new Date(contract.period.endDate).toLocaleDateString("en-AU")}`
        : "Active",
      completion: contract.period?.endDate
        ? new Date(contract.period.endDate).toLocaleDateString("en-AU")
        : "Ongoing",
      matchedBusinessLines: mappedBLIds.length > 0 ? mappedBLIds : undefined,
    };

    try {
      const [inserted] = await db.insert(projects).values(projectData).$returningId();
      scoreProjectAsync(inserted.id, "AusTender");
      totalNewProjects++;
      console.log(`[AusTender] New: ${projectName} (${formatCurrency(value)}, ${location})`);

      // Auto-discover contacts
      try {
        const contactResults = await generateAndEnrichContacts(
          inserted.id,
          reportId,
          projectName,
          supplier?.name || procuringEntity?.name || "Commonwealth",
          supplier ? [{ name: supplier.name, status: "confirmed" }] : [],
          sector
        );
        if (contactResults.length > 0) {
          console.log(`[AusTender] Auto-enriched ${contactResults.length} contacts for ${projectName}`);
        }
      } catch (enrichErr) {
        console.warn(`[AusTender] Contact enrichment failed for ${projectName}:`, enrichErr instanceof Error ? enrichErr.message : String(enrichErr));
      }
    } catch (insertErr) {
      const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
      errors.push(`Insert "${projectName}": ${msg}`);
      totalErrors++;
    }
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
  console.log(`[AusTender] Scrape complete in ${duration}s: ${totalFetched} fetched, ${totalRelevant} relevant, ${totalNewProjects} new, ${totalDuplicates} duplicates`);

  return {
    totalFetched,
    totalRelevant,
    totalNewProjects,
    totalDuplicates,
    totalSkipped,
    totalErrors,
    errors,
    duration,
  };
}

// ── Exported helpers for testing ──

export const _testing = {
  matchBusinessLinesFromContract,
  isRelevantContract,
  mapPriority,
  mapCapexGrade,
  mapSectorFromUnspsc,
  formatCurrency,
  RELEVANCE_KEYWORDS,
  RELEVANT_UNSPSC_PREFIXES,
  MIN_CONTRACT_VALUE,
};
