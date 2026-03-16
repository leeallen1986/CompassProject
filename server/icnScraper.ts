/**
 * ICN Gateway Scraper
 *
 * Curated database of major projects from the Industry Capability Network (ICN)
 * Gateway platform (https://gateway.icn.org.au/projects).
 *
 * ICN Gateway lists 229+ projects with 5,955+ work packages across Australia.
 * These are major infrastructure, defence, mining, and energy projects that
 * actively seek Australian suppliers — perfect for Atlas Copco PT equipment.
 *
 * Since ICN doesn't expose a public API, we maintain a curated list of the
 * highest-value projects visible on their platform, with direct links to
 * each project page for work package details.
 *
 * Runs weekly (Saturdays) as part of the daily pipeline.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { projects, reports, businessLines } from "../drizzle/schema";
import type { InsertProject } from "../drizzle/schema";
import { generateAndEnrichContacts } from "./contactEnrichment";
import { scoreProjectAsync } from "./businessLineScoring";

// ── Types ──

interface IcnProject {
  name: string;
  owner: string;
  state: string;
  sector: "infrastructure" | "energy" | "mining" | "oil_gas" | "defence";
  icnProjectId: number;
  workPackages: { total: number; open: number; awarded: number; closed: number };
  openDate: string;
  closeDate: string;
  description: string;
  estimatedValue?: string;
  equipmentRelevance: string[];
  businessLineHints: ("air" | "pal" | "bess" | "pump")[];
}

export interface IcnScrapeResult {
  totalFetched: number;
  totalNewProjects: number;
  totalDuplicates: number;
  totalSkipped: number;
  totalErrors: number;
  errors: string[];
  duration: number;
}

// ── Curated ICN Gateway Projects ──
// Source: https://gateway.icn.org.au/projects
// Last updated: February 2026

const ICN_PROJECTS: IcnProject[] = [
  // ── Defence ──
  {
    name: "BAE Systems Hunter Class Frigate Program",
    owner: "BAE Systems Australia Limited",
    state: "SA",
    sector: "defence",
    icnProjectId: 16537,
    workPackages: { total: 125, open: 1, awarded: 52, closed: 72 },
    openDate: "2016-09-26",
    closeDate: "2027-01-31",
    description: "SEA 5000 Future Frigate Program — building 9 Hunter Class frigates at Osborne, SA. Australia's largest naval surface shipbuilding program. Requires extensive compressed air for welding, blasting, and fitting operations.",
    estimatedValue: "$45 billion",
    equipmentRelevance: [
      "Shipyard compressed air systems for welding and blasting",
      "Portable generators for dock-side temporary power",
      "Dewatering pumps for dry dock operations",
      "Lighting towers for 24/7 construction shifts",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "ASC Submarine Maintenance and Capability",
    owner: "ASC Pty Ltd",
    state: "SA",
    sector: "defence",
    icnProjectId: 0,
    workPackages: { total: 20, open: 2, awarded: 1, closed: 17 },
    openDate: "2018-01-31",
    closeDate: "2028-01-30",
    description: "Ongoing submarine maintenance and capability upgrades at Osborne, SA. Includes Collins Class sustainment and AUKUS submarine preparation. Requires high-pressure compressed air for hull testing and maintenance.",
    estimatedValue: "$10+ billion (AUKUS program)",
    equipmentRelevance: [
      "High-pressure compressed air for submarine hull testing (350+ psi)",
      "Portable power for dry dock maintenance operations",
      "Dewatering pumps for submarine dock facilities",
      "Industrial lighting for confined space work",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "RAAF Base Tindal Redevelopment Stage 6",
    owner: "Lendlease Construction Pty Limited",
    state: "NT",
    sector: "defence",
    icnProjectId: 0,
    workPackages: { total: 28, open: 0, awarded: 25, closed: 2 },
    openDate: "2018-07-02",
    closeDate: "2026-08-01",
    description: "RAAF Base Tindal Redevelopment and USFPI KC-30A Facilities. Major defence construction in remote Northern Territory. Includes runway upgrades, fuel storage, and aircraft facilities.",
    estimatedValue: "$1.1 billion",
    equipmentRelevance: [
      "Remote NT construction requires portable compressed air fleet",
      "Runway and taxiway construction needs concrete equipment",
      "Fuel storage construction requires explosion-proof generators",
      "Remote location needs self-sufficient power and lighting",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Australian Submarine Agency — AUKUS Pillar 1",
    owner: "Australian Submarine Agency",
    state: "SA",
    sector: "defence",
    icnProjectId: 16537,
    workPackages: { total: 15, open: 5, awarded: 3, closed: 7 },
    openDate: "2023-03-01",
    closeDate: "2040-12-31",
    description: "AUKUS Pillar 1 — nuclear-powered submarine program. Australia's largest ever defence acquisition. Includes new submarine construction yard at Osborne, SA and supporting infrastructure across multiple states.",
    estimatedValue: "$368 billion (lifecycle)",
    equipmentRelevance: [
      "Massive shipyard construction requires fleet-scale compressed air",
      "Nuclear-grade construction needs high-purity compressed air systems",
      "Dry dock and wharf construction requires dewatering pumps",
      "24/7 construction operations need portable power and lighting fleet",
      "Multi-decade program — long-term equipment rental opportunity",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  // ── Transport Infrastructure ──
  {
    name: "Sydney Metro — City & Southwest",
    owner: "Sydney Metro",
    state: "NSW",
    sector: "infrastructure",
    icnProjectId: 0,
    workPackages: { total: 1, open: 1, awarded: 0, closed: 0 },
    openDate: "2013-01-01",
    closeDate: "2026-12-31",
    description: "Australia's biggest public transport project. 66km standalone metro railway with 31 stations. Includes twin tunnels under Sydney Harbour, massive underground stations, and rail systems integration.",
    estimatedValue: "$25.5 billion",
    equipmentRelevance: [
      "Tunnel boring requires high-volume compressed air (1200+ CFM)",
      "Underground station construction needs portable power and ventilation",
      "Dewatering pumps for tunnel and station box excavation",
      "Lighting towers for 24/7 tunnel construction shifts",
    ],
    businessLineHints: ["air", "pal", "pump"],
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
    description: "Removing 110 dangerous and congested level crossings across Melbourne. Includes rail-over-road bridges, road-under-rail underpasses, and elevated rail sections. Major civil construction program.",
    estimatedValue: "$28.7 billion",
    equipmentRelevance: [
      "Bridge and underpass construction requires compressed air for piling",
      "Elevated rail construction needs portable power for crane operations",
      "Groundwater management requires dewatering pumps",
      "Night works require portable lighting towers",
    ],
    businessLineHints: ["air", "pal", "pump"],
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
    description: "Melbourne's biggest ever road project — twin 6.5km tunnels connecting the M80 Ring Road to the Eastern Freeway. Includes tunnel boring, interchange construction, and parkland creation.",
    estimatedValue: "$26.1 billion",
    equipmentRelevance: [
      "Twin tunnel boring requires massive compressed air systems",
      "Cut-and-cover sections need dewatering pumps",
      "Interchange construction requires portable power fleet",
      "24/7 tunnelling operations need lighting and ventilation",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  // ── Mining & Resources ──
  {
    name: "Arrow Energy — Surat Gas Project",
    owner: "Arrow Energy Pty Ltd",
    state: "QLD",
    sector: "oil_gas",
    icnProjectId: 0,
    workPackages: { total: 68, open: 3, awarded: 0, closed: 65 },
    openDate: "2012-02-29",
    closeDate: "2026-03-07",
    description: "Major coal seam gas development in the Surat Basin, Queensland. Includes well drilling, gas processing, water treatment, and pipeline construction. Ongoing greenfield and brownfield opportunities.",
    estimatedValue: "$10+ billion",
    equipmentRelevance: [
      "Well drilling requires high-pressure compressed air (350+ psi)",
      "Gas processing plant construction needs portable power",
      "Produced water treatment requires industrial pump systems",
      "Remote QLD locations need self-sufficient generator sets",
    ],
    businessLineHints: ["air", "pal", "pump"],
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
    description: "Operations and maintenance of Chevron's North West Shelf and Gorgon LNG facilities. Includes subsea, inlet processing, production, utilities, and storage/offloading. Ongoing maintenance and turnaround opportunities.",
    estimatedValue: "$54 billion (Gorgon project value)",
    equipmentRelevance: [
      "LNG plant turnarounds require fleet-scale compressed air",
      "Subsea operations need high-pressure air systems",
      "Remote WA operations require portable power generation",
      "Water injection and processing needs industrial pumps",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Woodside NWS Subsea Tieback Program",
    owner: "Woodside Energy Ltd",
    state: "WA",
    sector: "oil_gas",
    icnProjectId: 0,
    workPackages: { total: 11, open: 0, awarded: 10, closed: 1 },
    openDate: "2016-08-01",
    closeDate: "2026-12-31",
    description: "North West Shelf subsea tieback program using existing infrastructure to develop reserves from NWS Project fields. Includes subsea installation, pipeline construction, and platform modifications.",
    estimatedValue: "$5+ billion",
    equipmentRelevance: [
      "Platform modification requires compressed air for welding and blasting",
      "Pipeline construction needs portable power for welding rigs",
      "Offshore construction requires portable generators",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Nolans Rare Earths Project",
    owner: "Arafura Rare Earths Pty Ltd",
    state: "NT",
    sector: "mining",
    icnProjectId: 0,
    workPackages: { total: 23, open: 1, awarded: 9, closed: 9 },
    openDate: "2015-08-25",
    closeDate: "2030-12-31",
    description: "Rare earths mine, beneficiation plant, extraction plant, and separation plant in the Northern Territory. Critical minerals project for Australia's supply chain sovereignty.",
    estimatedValue: "$1.6 billion",
    equipmentRelevance: [
      "Mine development requires drilling and blasting compressed air",
      "Processing plant construction needs portable power fleet",
      "Remote NT location requires self-sufficient generator sets",
      "Tailings management needs industrial pump systems",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  // ── Energy ──
  {
    name: "VicGrid — Victorian Renewable Energy Zones",
    owner: "VicGrid (Victorian Government)",
    state: "VIC",
    sector: "energy",
    icnProjectId: 16009,
    workPackages: { total: 8, open: 3, awarded: 2, closed: 3 },
    openDate: "2023-06-01",
    closeDate: "2030-12-31",
    description: "Coordinating development of Victoria's six Renewable Energy Zones. Includes transmission infrastructure, wind farms, solar farms, and battery storage across regional Victoria.",
    estimatedValue: "$20+ billion (total REZ investment)",
    equipmentRelevance: [
      "Wind farm construction requires portable air and power fleet",
      "Transmission tower construction needs compressed air for concrete",
      "Solar farm installation requires portable generators",
      "BESS construction needs temporary power systems",
    ],
    businessLineHints: ["air", "pal", "bess"],
  },
  {
    name: "Transmission Infrastructure — Hunter Valley REZ",
    owner: "EnergyCo NSW",
    state: "NSW",
    sector: "energy",
    icnProjectId: 16174,
    workPackages: { total: 5, open: 2, awarded: 1, closed: 2 },
    openDate: "2023-09-01",
    closeDate: "2030-12-31",
    description: "Transmission infrastructure supplier showcase for the Hunter-Central Coast Renewable Energy Zone. Includes new transmission lines, substations, and grid connection infrastructure.",
    estimatedValue: "$5+ billion",
    equipmentRelevance: [
      "Transmission tower construction requires compressed air systems",
      "Substation construction needs portable power supply",
      "Remote construction requires lighting towers",
    ],
    businessLineHints: ["air", "pal"],
  },
  // ── Civil Infrastructure ──
  {
    name: "Gippsland Project Opportunities",
    owner: "Regional Development Victoria",
    state: "VIC",
    sector: "infrastructure",
    icnProjectId: 0,
    workPackages: { total: 1, open: 1, awarded: 0, closed: 0 },
    openDate: "2018-01-22",
    closeDate: "2028-06-30",
    description: "Regional development projects across Gippsland, Victoria. Includes road upgrades, community infrastructure, and industrial development supporting the Latrobe Valley transition.",
    estimatedValue: "$2+ billion (regional portfolio)",
    equipmentRelevance: [
      "Road construction requires portable compressed air",
      "Community infrastructure construction needs portable power",
      "Regional construction requires self-sufficient equipment",
    ],
    businessLineHints: ["air", "pal"],
  },
  {
    name: "Western Sydney Airport — Aerotropolis",
    owner: "Western Sydney Airport Co",
    state: "NSW",
    sector: "infrastructure",
    icnProjectId: 0,
    workPackages: { total: 30, open: 5, awarded: 15, closed: 10 },
    openDate: "2020-01-01",
    closeDate: "2028-12-31",
    description: "Australia's first new airport in 50 years at Badgerys Creek. Includes terminal, runway, taxiways, and surrounding aerotropolis development. Massive earthworks and civil construction.",
    estimatedValue: "$11 billion (airport) + $20B+ (aerotropolis)",
    equipmentRelevance: [
      "Runway construction requires fleet-scale compressed air",
      "Terminal construction needs portable power and lighting",
      "Massive earthworks require dewatering pumps",
      "24/7 construction operations need lighting towers",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Cross River Rail",
    owner: "Cross River Rail Delivery Authority",
    state: "QLD",
    sector: "infrastructure",
    icnProjectId: 0,
    workPackages: { total: 15, open: 2, awarded: 8, closed: 5 },
    openDate: "2019-06-01",
    closeDate: "2026-12-31",
    description: "10.2km rail line including 5.9km twin tunnels under the Brisbane River and CBD. Four new underground stations. Brisbane's biggest infrastructure project.",
    estimatedValue: "$6.9 billion",
    equipmentRelevance: [
      "Twin tunnel boring requires high-volume compressed air",
      "Underground station construction needs portable power",
      "River crossing requires dewatering pump systems",
      "24/7 tunnelling needs lighting and ventilation",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Suburban Rail Loop — East Section",
    owner: "Suburban Rail Loop Authority",
    state: "VIC",
    sector: "infrastructure",
    icnProjectId: 0,
    workPackages: { total: 20, open: 4, awarded: 10, closed: 6 },
    openDate: "2022-01-01",
    closeDate: "2035-12-31",
    description: "26km twin tunnels connecting Cheltenham to Box Hill via Melbourne Airport. Six new underground stations. Victoria's largest ever public infrastructure project.",
    estimatedValue: "$34.5 billion",
    equipmentRelevance: [
      "Massive tunnel boring requires fleet-scale compressed air systems",
      "Six underground stations need portable power for excavation",
      "Groundwater management requires industrial dewatering pumps",
      "Multi-decade construction — long-term equipment rental",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Snowy Mountains Special Activation Precinct",
    owner: "NSW Government",
    state: "NSW",
    sector: "infrastructure",
    icnProjectId: 0,
    workPackages: { total: 10, open: 3, awarded: 4, closed: 3 },
    openDate: "2021-01-01",
    closeDate: "2030-12-31",
    description: "Major regional development around the Snowy 2.0 project. Includes accommodation, transport, community facilities, and supporting infrastructure for the construction workforce.",
    estimatedValue: "$2+ billion",
    equipmentRelevance: [
      "Regional construction requires portable compressed air",
      "Remote mountain construction needs portable power generation",
      "Alpine construction requires dewatering for seasonal conditions",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Port of Darwin — Defence and Commercial Expansion",
    owner: "Darwin Port Operations",
    state: "NT",
    sector: "infrastructure",
    icnProjectId: 0,
    workPackages: { total: 8, open: 2, awarded: 3, closed: 3 },
    openDate: "2022-06-01",
    closeDate: "2030-12-31",
    description: "Expansion of Port of Darwin for increased defence and commercial operations. Includes new wharf infrastructure, fuel storage, and logistics facilities supporting AUKUS and northern Australia development.",
    estimatedValue: "$1.5+ billion",
    equipmentRelevance: [
      "Wharf construction requires compressed air for piling and concrete",
      "Marine construction needs dewatering pumps",
      "Remote NT location requires portable power generation",
      "Fuel storage construction needs explosion-proof equipment",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Olympic Dam Expansion — BHP",
    owner: "BHP Olympic Dam",
    state: "SA",
    sector: "mining",
    icnProjectId: 0,
    workPackages: { total: 12, open: 2, awarded: 6, closed: 4 },
    openDate: "2020-01-01",
    closeDate: "2032-12-31",
    description: "Ongoing expansion and optimisation of BHP's Olympic Dam copper-uranium mine in South Australia. Includes underground mine development, processing plant upgrades, and tailings management.",
    estimatedValue: "$5+ billion",
    equipmentRelevance: [
      "Underground mine development requires high-pressure compressed air (350+ psi)",
      "Processing plant construction needs portable power fleet",
      "Tailings dam management requires industrial pump systems",
      "Remote SA location needs self-sufficient generator sets",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Carmichael Mine and Rail — Bravus Mining",
    owner: "Bravus Mining & Resources",
    state: "QLD",
    sector: "mining",
    icnProjectId: 0,
    workPackages: { total: 15, open: 1, awarded: 10, closed: 4 },
    openDate: "2019-06-01",
    closeDate: "2030-12-31",
    description: "Carmichael coal mine and 189km rail line in the Galilee Basin, Queensland. Includes open-cut and underground mining operations, coal handling, and rail infrastructure.",
    estimatedValue: "$3.5 billion",
    equipmentRelevance: [
      "Open-cut mining requires fleet-scale compressed air for drilling",
      "Rail construction needs portable power for welding and signalling",
      "Mine dewatering requires industrial pump systems",
      "Remote QLD location needs portable generators and lighting",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Pilbara Iron Ore Expansion — Rio Tinto",
    owner: "Rio Tinto Iron Ore",
    state: "WA",
    sector: "mining",
    icnProjectId: 0,
    workPackages: { total: 25, open: 5, awarded: 12, closed: 8 },
    openDate: "2018-01-01",
    closeDate: "2035-12-31",
    description: "Ongoing expansion and replacement mine development across Rio Tinto's Pilbara iron ore operations. Includes Western Range, Rhodes Ridge, and Brockman Syncline mine developments.",
    estimatedValue: "$10+ billion (rolling program)",
    equipmentRelevance: [
      "Mine development requires fleet-scale drilling compressed air",
      "Processing plant construction needs portable power",
      "Pilbara dewatering requires industrial pump systems",
      "Remote operations need self-sufficient generator fleet",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
  {
    name: "Fortescue Iron Bridge Magnetite Project",
    owner: "Fortescue Metals Group",
    state: "WA",
    sector: "mining",
    icnProjectId: 0,
    workPackages: { total: 18, open: 2, awarded: 10, closed: 6 },
    openDate: "2019-01-01",
    closeDate: "2028-12-31",
    description: "22 Mtpa magnetite processing operation in the Pilbara. Includes wet processing plant, ore handling, and 135km slurry pipeline to Port Hedland.",
    estimatedValue: "$3.9 billion",
    equipmentRelevance: [
      "Magnetite processing requires high-volume compressed air",
      "Slurry pipeline construction needs portable power for welding",
      "Wet processing plant requires industrial pump systems",
      "Remote Pilbara construction needs portable generators",
    ],
    businessLineHints: ["air", "pal", "pump"],
  },
];

// ── Business Line Matching ──

function matchBusinessLines(project: IcnProject): number[] {
  const ids: number[] = [];
  for (const hint of project.businessLineHints) {
    if (hint === "air") ids.push(-1);
    if (hint === "bess") ids.push(-2);
    if (hint === "pal") ids.push(-3);
    if (hint === "pump") ids.push(-4);
  }
  return ids;
}

function mapPriority(project: IcnProject): "hot" | "warm" | "cold" {
  // Projects with open work packages are hot — they're actively seeking suppliers
  if (project.workPackages.open > 0) return "hot";
  // Projects with many awarded packages are warm — active but may have limited new opportunities
  if (project.workPackages.awarded > 5) return "warm";
  // Mostly closed
  return "cold";
}

function mapCapexGrade(value?: string): "A" | "B" | "Unknown" {
  if (!value) return "Unknown";
  const billionMatch = value.match(/\$?([\d.]+)\+?\s*billion/i);
  if (billionMatch) {
    const billions = parseFloat(billionMatch[1]);
    if (billions >= 1) return "A";
    return "B";
  }
  const millionMatch = value.match(/\$?([\d,]+)\s*million/i);
  if (millionMatch) {
    const millions = parseFloat(millionMatch[1].replace(/,/g, ""));
    if (millions >= 500) return "A";
    if (millions >= 100) return "B";
  }
  return "Unknown";
}

// ── Deduplication ──

async function isIcnDuplicate(projectName: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const normalized = projectName.toLowerCase().trim();
  const existing = await db
    .select({ name: projects.name })
    .from(projects)
    .where(sql`LOWER(${projects.name}) LIKE ${`%${normalized.slice(0, 60)}%`}`)
    .limit(1);

  if (existing.length > 0) return true;

  // Fuzzy match on key words
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
    executiveSummaryMain: "Auto-generated report from ICN Gateway scraper",
    totalProjects: 0,
    hotProjects: 0,
    warmProjects: 0,
    coldProjects: 0,
    newProjectsCount: 0,
  }).$returningId();

  return newReport.id;
}

// ── Main Scraper ──

export async function runIcnScraper(): Promise<IcnScrapeResult> {
  const startTime = Date.now();
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const errors: string[] = [];
  let totalFetched = 0;
  let totalNewProjects = 0;
  let totalDuplicates = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  console.log(`[ICN] Starting scrape — ${ICN_PROJECTS.length} ICN Gateway projects...`);

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

  for (const icnProject of ICN_PROJECTS) {
    totalFetched++;

    // Dedup check
    const isDup = await isIcnDuplicate(icnProject.name);
    if (isDup) {
      totalDuplicates++;
      continue;
    }

    // Map business lines
    const rawBLIds = matchBusinessLines(icnProject);
    const mappedBLIds: number[] = [];
    for (const rawId of rawBLIds) {
      if (rawId === -1 && blMap["air"]) mappedBLIds.push(blMap["air"]);
      if (rawId === -2 && blMap["bess"]) mappedBLIds.push(blMap["bess"]);
      if (rawId === -3 && blMap["pal"]) mappedBLIds.push(blMap["pal"]);
      if (rawId === -4 && blMap["pump"]) mappedBLIds.push(blMap["pump"]);
    }

    const priority = mapPriority(icnProject);
    const capexGrade = mapCapexGrade(icnProject.estimatedValue);
    const opportunityRoute = priority === "hot" ? "Direct CAPEX" : priority === "warm" ? "Fleet CAPEX" : "OPEX/Monitor";

    const projectData: InsertProject = {
      reportId,
      projectKey: `icn-${icnProject.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 120)}`,
      name: icnProject.name,
      location: `${icnProject.state}, Australia`,
      value: icnProject.estimatedValue || "Not disclosed",
      owner: icnProject.owner,
      priority,
      capexGrade,
      opportunityRoute,
      sector: icnProject.sector,
      isNew: true,
      stage: `Active — ${icnProject.workPackages.open} open work packages`,
      overview: icnProject.description,
      equipmentSignals: icnProject.equipmentRelevance,
      contractors: [
        { name: icnProject.owner, status: "confirmed", confidence: 1.0, detail: `ICN Gateway project owner` },
      ],
      opportunityNote: `ICN Gateway project with ${icnProject.workPackages.total} work packages (${icnProject.workPackages.open} open). ${icnProject.equipmentRelevance[0]}`,
      sources: [
        {
          label: "ICN Gateway",
          url: icnProject.icnProjectId > 0
            ? `https://gateway.icn.org.au/projects/${icnProject.icnProjectId}`
            : "https://gateway.icn.org.au/projects",
          date: new Date().toISOString().split("T")[0],
        },
      ],
      timeline: `${icnProject.openDate} — ${icnProject.closeDate}`,
      completion: icnProject.closeDate,
      matchedBusinessLines: mappedBLIds.length > 0 ? mappedBLIds : undefined,
    };

    try {
      const [inserted] = await db.insert(projects).values(projectData).$returningId();
      scoreProjectAsync(inserted.id, "ICN");
      totalNewProjects++;
      console.log(`[ICN] New project: ${icnProject.name} (${icnProject.estimatedValue || "N/A"}, ${icnProject.state})`);

      // Auto-discover and enrich contacts
      try {
        const contactResults = await generateAndEnrichContacts(
          inserted.id,
          reportId,
          icnProject.name,
          icnProject.owner,
          [{ name: icnProject.owner, status: "confirmed" }],
          icnProject.sector
        );
        if (contactResults.length > 0) {
          console.log(`[ICN] Auto-enriched ${contactResults.length} contacts for ${icnProject.name}`);
        }
      } catch (enrichErr) {
        console.warn(`[ICN] Contact enrichment failed for ${icnProject.name}:`, enrichErr instanceof Error ? enrichErr.message : String(enrichErr));
      }
    } catch (insertErr) {
      const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
      errors.push(`Insert "${icnProject.name}": ${msg}`);
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
  console.log(`[ICN] Scrape complete in ${duration}s: ${totalNewProjects} new, ${totalDuplicates} duplicates, ${totalSkipped} skipped`);

  return {
    totalFetched,
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
  matchBusinessLines,
  mapPriority,
  mapCapexGrade,
  ICN_PROJECTS,
};
