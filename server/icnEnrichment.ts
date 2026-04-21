/**
 * ICN Gateway Enrichment Module
 *
 * SECONDARY CONFIRMATION source — NOT a primary crawler.
 *
 * When a project is discovered from other sources, this module:
 * 1. Checks if the project appears in the ICN Gateway curated list
 * 2. Validates known project details
 * 3. Extracts contractor information and capability requirements
 * 4. Confirms procurement stage (open/awarded/closed work packages)
 *
 * The curated ICN project list is maintained as a static dataset because
 * ICN Gateway is JavaScript-rendered and has no public API.
 */
import { eq, sql } from "drizzle-orm";
import { getDb, touchProjectSourceSeen } from "./db";
import { projects } from "../drizzle/schema";

// ── Types ──

interface IcnProjectEntry {
  name: string;
  owner: string;
  state: string;
  sector: string;
  icnProjectId: number;
  workPackages: { total: number; open: number; awarded: number; closed: number };
  openDate: string;
  closeDate: string;
  description: string;
  estimatedValue?: string;
  equipmentRelevance: string[];
  contractors?: string[];
  capabilities?: string[];
}

export interface IcnValidationResult {
  projectId: number;
  projectName: string;
  icnMatch: boolean;
  icnProjectName?: string;
  icnProjectUrl?: string;
  contractorsFound: string[];
  capabilitiesFound: string[];
  procurementStage: string;
  openWorkPackages: number;
  updated: boolean;
}

export interface IcnBulkValidationResult {
  totalChecked: number;
  totalMatched: number;
  totalUpdated: number;
  totalContractorsAdded: number;
  results: IcnValidationResult[];
  duration: number;
}

// ── Curated ICN Gateway Projects ──
// Source: https://gateway.icn.org.au/projects
// These are the highest-value projects visible on ICN Gateway
// Used for validation and contractor identification, not primary discovery

const ICN_CURATED_PROJECTS: IcnProjectEntry[] = [
  // Defence
  {
    name: "BAE Systems Hunter Class Frigate Program",
    owner: "BAE Systems Australia Limited",
    state: "SA",
    sector: "defence",
    icnProjectId: 16537,
    workPackages: { total: 125, open: 1, awarded: 52, closed: 72 },
    openDate: "2016-09-26",
    closeDate: "2027-01-31",
    description: "SEA 5000 Future Frigate Program — building 9 Hunter Class frigates at Osborne, SA.",
    estimatedValue: "$45 billion",
    equipmentRelevance: ["Shipyard compressed air", "Portable generators", "Dewatering pumps"],
    contractors: ["BAE Systems Australia", "ASC Shipbuilding"],
    capabilities: ["Compressed air systems", "Portable power", "Dewatering", "Lighting"],
  },
  {
    name: "AUKUS Pillar 1 — Nuclear Submarine Program",
    owner: "Australian Submarine Agency",
    state: "SA",
    sector: "defence",
    icnProjectId: 16537,
    workPackages: { total: 15, open: 5, awarded: 3, closed: 7 },
    openDate: "2023-03-01",
    closeDate: "2040-12-31",
    description: "AUKUS nuclear-powered submarine program. Australia's largest ever defence acquisition.",
    estimatedValue: "$368 billion",
    equipmentRelevance: ["Fleet-scale compressed air", "Nuclear-grade air systems", "Dewatering pumps", "Portable power and lighting fleet"],
    contractors: ["ASC Pty Ltd", "BAE Systems"],
    capabilities: ["High-pressure compressed air", "Portable power", "Dewatering", "Industrial lighting"],
  },
  // Transport Infrastructure
  {
    name: "Sydney Metro — City & Southwest",
    owner: "Sydney Metro",
    state: "NSW",
    sector: "infrastructure",
    icnProjectId: 0,
    workPackages: { total: 1, open: 1, awarded: 0, closed: 0 },
    openDate: "2013-01-01",
    closeDate: "2026-12-31",
    description: "Australia's biggest public transport project. 66km standalone metro railway with 31 stations.",
    estimatedValue: "$25.5 billion",
    equipmentRelevance: ["Tunnel boring compressed air", "Underground station power", "Dewatering pumps"],
    contractors: ["John Holland", "CPB Contractors", "Laing O'Rourke"],
    capabilities: ["High-volume compressed air (1200+ CFM)", "Portable power", "Dewatering", "Lighting"],
  },
  {
    name: "North East Link Program",
    owner: "North East Link Program (VIC)",
    state: "VIC",
    sector: "infrastructure",
    icnProjectId: 0,
    workPackages: { total: 1, open: 1, awarded: 0, closed: 0 },
    openDate: "2018-01-15",
    closeDate: "2028-06-30",
    description: "Melbourne's biggest ever road project — twin 6.5km tunnels.",
    estimatedValue: "$26.1 billion",
    equipmentRelevance: ["Twin tunnel boring compressed air", "Dewatering pumps", "Portable power fleet"],
    contractors: ["Spark Consortium", "Webuild"],
    capabilities: ["Compressed air systems", "Dewatering", "Portable power", "Ventilation"],
  },
  {
    name: "Level Crossing Removal Project",
    owner: "Department of Transport and Planning (VIC)",
    state: "VIC",
    sector: "infrastructure",
    icnProjectId: 0,
    workPackages: { total: 2, open: 2, awarded: 0, closed: 0 },
    openDate: "2015-08-01",
    closeDate: "2027-06-30",
    description: "Removing 110 dangerous level crossings across Melbourne.",
    estimatedValue: "$28.7 billion",
    equipmentRelevance: ["Bridge construction compressed air", "Portable power for cranes", "Dewatering pumps"],
    contractors: ["ACCIONA", "Coleman Rail", "Lendlease"],
    capabilities: ["Compressed air for piling", "Portable power", "Dewatering", "Lighting"],
  },
  // Mining & Resources
  {
    name: "Arrow Energy — Surat Gas Project",
    owner: "Arrow Energy Pty Ltd",
    state: "QLD",
    sector: "oil_gas",
    icnProjectId: 0,
    workPackages: { total: 68, open: 3, awarded: 0, closed: 65 },
    openDate: "2012-02-29",
    closeDate: "2026-03-07",
    description: "Major coal seam gas development in the Surat Basin, Queensland.",
    estimatedValue: "$10+ billion",
    equipmentRelevance: ["High-pressure compressed air for drilling", "Portable power", "Industrial pump systems"],
    contractors: ["Arrow Energy"],
    capabilities: ["High-pressure air (350+ psi)", "Portable power", "Pump systems", "Generator sets"],
  },
  {
    name: "Chevron Australia Operations — NWS & Gorgon",
    owner: "Chevron Australia Pty Ltd",
    state: "WA",
    sector: "oil_gas",
    icnProjectId: 0,
    workPackages: { total: 131, open: 0, awarded: 92, closed: 38 },
    openDate: "2014-01-01",
    closeDate: "2028-12-31",
    description: "Operations and maintenance of Chevron's North West Shelf and Gorgon LNG facilities.",
    estimatedValue: "$54 billion",
    equipmentRelevance: ["LNG plant turnaround compressed air", "Subsea air systems", "Portable power", "Industrial pumps"],
    contractors: ["Chevron Australia", "Monadelphous", "Downer"],
    capabilities: ["Fleet-scale compressed air", "High-pressure air", "Portable power", "Pumps"],
  },
  // Energy
  {
    name: "Snowy 2.0",
    owner: "Snowy Hydro Limited",
    state: "NSW",
    sector: "energy",
    icnProjectId: 0,
    workPackages: { total: 10, open: 1, awarded: 5, closed: 4 },
    openDate: "2018-01-01",
    closeDate: "2029-12-31",
    description: "2,000MW pumped hydro expansion of the Snowy Mountains Scheme.",
    estimatedValue: "$12 billion",
    equipmentRelevance: ["Tunnel boring compressed air", "Underground construction power", "Dewatering pumps"],
    contractors: ["Webuild", "Clough", "Future Generation JV"],
    capabilities: ["High-volume compressed air", "Portable power", "Dewatering", "Ventilation"],
  },
  {
    name: "Kurri Kurri Power Station",
    owner: "Snowy Hydro Limited",
    state: "NSW",
    sector: "energy",
    icnProjectId: 0,
    workPackages: { total: 5, open: 0, awarded: 3, closed: 2 },
    openDate: "2021-01-01",
    closeDate: "2026-12-31",
    description: "750MW gas-fired power station in the Hunter Valley.",
    estimatedValue: "$1.4 billion",
    equipmentRelevance: ["Power plant construction compressed air", "Portable power", "Dewatering"],
    contractors: ["Samsung C&T", "Clough"],
    capabilities: ["Compressed air", "Portable power", "Dewatering"],
  },
  {
    name: "Marinus Link",
    owner: "Marinus Link Pty Ltd",
    state: "TAS",
    sector: "energy",
    icnProjectId: 0,
    workPackages: { total: 3, open: 1, awarded: 1, closed: 1 },
    openDate: "2019-01-01",
    closeDate: "2030-12-31",
    description: "1,500MW undersea electricity interconnector between Tasmania and Victoria.",
    estimatedValue: "$3.5 billion",
    equipmentRelevance: ["Cable laying compressed air", "Converter station construction", "Dewatering"],
    contractors: ["Prysmian Group"],
    capabilities: ["Compressed air", "Portable power", "Dewatering"],
  },
];

// ── Fuzzy Matching ──

function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateMatchScore(projectName: string, icnName: string): number {
  const a = normalizeForMatch(projectName);
  const b = normalizeForMatch(icnName);

  // Exact match
  if (a === b) return 1.0;

  // One contains the other
  if (a.includes(b) || b.includes(a)) return 0.9;

  // Word overlap
  const wordsA = a.split(" ").filter(w => w.length > 3);
  const wordsB = b.split(" ").filter(w => w.length > 3);
  const wordsBSet = new Set(wordsB);
  const intersection = wordsA.filter(w => wordsBSet.has(w));
  const unionSet = new Set([...wordsA, ...wordsB]);

  if (unionSet.size === 0) return 0;
  return intersection.length / unionSet.size;
}

function findBestIcnMatch(projectName: string, owner: string): IcnProjectEntry | null {
  let bestMatch: IcnProjectEntry | null = null;
  let bestScore = 0;

  for (const icn of ICN_CURATED_PROJECTS) {
    // Check name match
    const nameScore = calculateMatchScore(projectName, icn.name);

    // Check owner match
    const ownerScore = calculateMatchScore(owner || "", icn.owner);

    // Combined score (name weighted more heavily)
    const combinedScore = nameScore * 0.7 + ownerScore * 0.3;

    if (combinedScore > bestScore && combinedScore >= 0.3) {
      bestScore = combinedScore;
      bestMatch = icn;
    }
  }

  return bestMatch;
}

// ── Validate a Single Project ──

export async function validateProject(projectId: number): Promise<IcnValidationResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return {
      projectId,
      projectName: "Unknown",
      icnMatch: false,
      contractorsFound: [],
      capabilitiesFound: [],
      procurementStage: "unknown",
      openWorkPackages: 0,
      updated: false,
    };
  }

  const icnMatch = findBestIcnMatch(project.name, project.owner);

  if (!icnMatch) {
    return {
      projectId,
      projectName: project.name,
      icnMatch: false,
      contractorsFound: [],
      capabilitiesFound: [],
      procurementStage: "unknown",
      openWorkPackages: 0,
      updated: false,
    };
  }

  // Extract contractor and capability data
  const contractorsFound = icnMatch.contractors || [];
  const capabilitiesFound = icnMatch.capabilities || [];
  const procurementStage = icnMatch.workPackages.open > 0
    ? "active_procurement"
    : icnMatch.workPackages.awarded > 5
      ? "mostly_awarded"
      : "closed";

  // Update project record with ICN data
  const existingContractors = (project.contractors as any[]) || [];
  const newContractors = [...existingContractors];
  let contractorsAdded = 0;

  for (const c of contractorsFound) {
    if (!newContractors.some(ec => ec.name?.toLowerCase() === c.toLowerCase())) {
      newContractors.push({
        name: c,
        status: "confirmed",
        confidence: 0.85,
        detail: "Confirmed via ICN Gateway",
      });
      contractorsAdded++;
    }
  }

  const updateData: Record<string, any> = {};
  let updated = false;

  if (contractorsAdded > 0) {
    updateData.contractors = newContractors;
    updated = true;
  }

  // Add ICN source if not already present
  const existingSources = (project.sources as any[]) || [];
  if (!existingSources.some((s: any) => s.label === "ICN Gateway")) {
    existingSources.push({
      label: "ICN Gateway",
      url: icnMatch.icnProjectId > 0
        ? `https://gateway.icn.org.au/projects/${icnMatch.icnProjectId}`
        : "https://gateway.icn.org.au/projects",
      date: new Date().toISOString().split("T")[0],
    });
    updateData.sources = existingSources;
    updated = true;
  }

  if (updated) {
    await db.update(projects).set(updateData).where(eq(projects.id, projectId));
  }
  // Stage 5A: ICN corroboration — update sourceLastSeenAt and re-activate if stale
  await touchProjectSourceSeen(projectId, true);

  return {
    projectId,
    projectName: project.name,
    icnMatch: true,
    icnProjectName: icnMatch.name,
    icnProjectUrl: icnMatch.icnProjectId > 0
      ? `https://gateway.icn.org.au/projects/${icnMatch.icnProjectId}`
      : undefined,
    contractorsFound,
    capabilitiesFound,
    procurementStage,
    openWorkPackages: icnMatch.workPackages.open,
    updated,
  };
}

// ── Bulk Validation ──

export async function validateAllProjects(): Promise<IcnBulkValidationResult> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const allProjects = await db
    .select({ id: projects.id, name: projects.name, owner: projects.owner })
    .from(projects)
    .where(sql`${projects.lifecycleStatus} != 'archived'`);

  const results: IcnValidationResult[] = [];
  let totalMatched = 0;
  let totalUpdated = 0;
  let totalContractorsAdded = 0;

  for (const project of allProjects) {
    const result = await validateProject(project.id);
    results.push(result);

    if (result.icnMatch) totalMatched++;
    if (result.updated) totalUpdated++;
    totalContractorsAdded += result.contractorsFound.length;
  }

  const duration = Math.round((Date.now() - startTime) / 1000);

  return {
    totalChecked: allProjects.length,
    totalMatched,
    totalUpdated,
    totalContractorsAdded,
    results,
    duration,
  };
}

// ── Exported helpers ──

export const _testing = {
  normalizeForMatch,
  calculateMatchScore,
  findBestIcnMatch,
  ICN_CURATED_PROJECTS,
};
