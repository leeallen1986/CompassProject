/**
 * Seed script — Populates default business lines and RSS sources.
 * Called from an admin endpoint or run manually.
 *
 * Power Technique (PT) division business lines:
 *   - Portable Air (compressors, drilling, blasting)
 *   - PAL (power generators, lighting towers)
 *   - Pump (Flow) (dewatering, submersible, wellpoint)
 *   - BESS (battery energy storage systems)
 */
import { getDb } from "./db";
import { businessLines, rssSources } from "../drizzle/schema";
import { sql } from "drizzle-orm";

const DEFAULT_BUSINESS_LINES = [
  {
    name: "Portable Air",
    description: "Portable compressors for mining, construction, drilling, and infrastructure projects. Key products include XAS, XATS, XAHS, and XAVS series.",
    keywords: [
      // ── Family 1: Core Portable Air ──
      "compressor", "portable air", "compressed air", "drilling", "RC drilling",
      "diamond drilling", "blasting", "pneumatic", "CFM", "air compressor",
      "sandblasting", "shotcrete", "tunnelling", "mining equipment",
      "construction equipment", "atlas copco", "portable compressor",
      "air receiver", "aftercooler", "drill rig",
      // ── Family 2: Air Treatment / Quality ──
      "air dryer", "refrigerant dryer", "desiccant dryer", "air drying",
      "line drying", "pipe drying", "pipeline drying", "drying of pipeline",
      "moisture separator", "moisture trap", "dew point", "dew-point",
      "instrument air", "instrument-air", "instrument quality air",
      "control air", "control valve air", "oil-free air", "oil free air",
      "iso 8573", "moisture-sensitive", "moisture sensitive",
      // ── Family 3: Specialty Air / Gas ──
      "nitrogen", "nitrogen gas", "n2 membrane", "nitrogen membrane",
      "nitrogen generator", "nitrogen purging", "pipeline purging", "purging",
      "inerting", "inert gas", "inert atmosphere",
      "pipeline testing", "pipeline pressure test", "pneumatic pressure test",
      "hydrostatic testing", "hydrostatic pressure test", "pressure testing",
      "pre-commissioning", "pre commissioning", "precommissioning",
      "pipeline pre-commissioning", "dry-out", "dryout", "pipeline dry-out",
      "booster compressor", "pressure booster", "gas booster", "air booster",
      "high pressure testing", "high-pressure test", "high pressure air",
      "pipeline commissioning", "pipeline dewatering", "pipeline cleaning",
      "pipeline gauging", "pigging", "pig launcher", "pig receiver",
      "subsea pipeline", "export pipeline", "gas export",
    ],
    sectors: ["mining", "oil_gas", "infrastructure", "energy", "defence"],
    equipmentTypes: [
      "Portable Compressor", "Booster Compressor", "Drill Rig",
      "Air Treatment"
    ],
    defaultTerritories: ["WA", "QLD", "NSW", "SA", "NT", "VIC", "TAS"],
  },
  {
    name: "PAL",
    description: "Power generators, lighting towers, and BESS. QAS, QES series generators, HiLight towers, and ZenergiZe BESS.",
    keywords: [
      "generator", "power generation", "diesel generator", "portable generator",
      "lighting tower", "light tower", "temporary power", "standby power",
      "backup power", "construction power", "mine site power",
      "battery energy storage", "BESS", "energy storage system",
      "hybrid power", "solar hybrid", "ZenergiZe"
    ],
    sectors: ["mining", "infrastructure", "energy"],
    equipmentTypes: [
      "Diesel Generator", "Lighting Tower", "Battery Energy Storage",
      "Hybrid Power", "Power Pack"
    ],
    defaultTerritories: ["WA", "QLD", "NSW", "NT"],
  },
  {
    name: "Pump (Flow)",
    description: "Dewatering pumps, submersible pumps, and wellpoint systems for mining, construction, and flood recovery. PAS and WEDA series.",
    keywords: [
      "dewatering pump", "submersible pump", "wellpoint dewatering",
      "pump station", "water pump", "mine dewatering", "flood pump",
      "centrifugal pump", "drainage pump", "slurry pump",
      "water management", "pit dewatering", "stormwater",
      "water treatment", "tailings", "water table", "groundwater",
      "flood recovery", "dam construction", "water infrastructure",
      "sewage pump", "effluent pump", "bypass pumping"
    ],
    sectors: ["mining", "infrastructure", "energy"],
    equipmentTypes: [
      "Dewatering Pump", "Submersible Pump", "Wellpoint System",
      "Centrifugal Pump"
    ],
    defaultTerritories: ["WA", "QLD", "NSW", "NT", "SA"],
  },
  {
    name: "BESS",
    description: "Battery Energy Storage Systems for mining, construction, and renewable energy projects. ZenergiZe range, hybrid power solutions, and peak shaving.",
    keywords: [
      "battery energy storage", "BESS", "energy storage system",
      "battery storage", "hybrid power", "solar hybrid", "ZenergiZe",
      "peak shaving", "load management", "microgrid", "off-grid power",
      "renewable energy storage", "lithium battery", "containerised power"
    ],
    sectors: ["mining", "infrastructure", "energy"],
    equipmentTypes: [
      "Battery Energy Storage", "Hybrid Power System",
      "Containerised Power", "Microgrid"
    ],
    defaultTerritories: ["WA", "QLD", "NSW", "NT", "SA"],
  },
];

const DEFAULT_RSS_SOURCES = [
  // ── Mining & Resources ──
  { name: "Australian Mining", feedUrl: "https://www.australianmining.com.au/feed/", category: "industry" },
  { name: "International Mining", feedUrl: "https://www.mining.com/feed/", category: "industry" },
  { name: "Mining Technology", feedUrl: "https://www.mining-technology.com/feed/", category: "industry" },
  { name: "Mining Weekly SA", feedUrl: "https://www.miningweekly.com/page/home/feed", category: "mining" },
  { name: "Rigzone News", feedUrl: "https://www.rigzone.com/news/rss/rigzone_latest.aspx", category: "oil_gas" },

  // ── News Sources ──
  { name: "The Australian - Business", feedUrl: "https://www.theaustralian.com.au/business/rss", category: "news" },
  { name: "ABC News - Business", feedUrl: "https://www.abc.net.au/news/feed/51120/rss.xml", category: "news" },
  { name: "ABC News - Australia", feedUrl: "https://www.abc.net.au/news/feed/2942460/rss.xml", category: "news" },
  { name: "Small Caps", feedUrl: "https://smallcaps.com.au/feed/", category: "asx" },
  { name: "Stockhead", feedUrl: "https://stockhead.com.au/feed/", category: "asx" },

  // ── Infrastructure & Construction ──
  { name: "Infrastructure Magazine", feedUrl: "https://infrastructuremagazine.com.au/feed/", category: "industry" },
  { name: "Roads & Infrastructure", feedUrl: "https://roadsonline.com.au/feed/", category: "industry" },
  { name: "Inside Construction", feedUrl: "https://insideconstruction.com.au/feed/", category: "industry" },
  { name: "Build Australia", feedUrl: "https://buildaustralia.com.au/feed/", category: "infrastructure" },
  { name: "Sourceable", feedUrl: "https://sourceable.net/feed/", category: "infrastructure" },
  { name: "Quarry Magazine", feedUrl: "https://www.quarrymagazine.com/feed/", category: "industry" },
  { name: "Construction Equipment Guide", feedUrl: "https://feeds.feedburner.com/ceg", category: "industry" },
  { name: "Master Builders Australia", feedUrl: "https://www.masterbuilders.com.au/feed", category: "infrastructure" },

  // ── Energy & Renewables ──
  { name: "Renew Economy", feedUrl: "https://reneweconomy.com.au/feed/", category: "industry" },
  { name: "Energy Magazine", feedUrl: "https://www.energymagazine.com.au/feed/", category: "industry" },
  { name: "Energy Storage News", feedUrl: "https://www.energy-storage.news/feed/", category: "industry" },
  { name: "Renewables Now", feedUrl: "https://renewablesnow.com/news/news_feed/?source=solar", category: "industry" },
  { name: "PV Magazine Australia", feedUrl: "https://www.pv-magazine-australia.com/feed/", category: "industry" },
  { name: "One Step Off The Grid", feedUrl: "https://onestepoffthegrid.com.au/feed/", category: "industry" },
  { name: "Energy News Bulletin", feedUrl: "https://www.energynewsbulletin.net/feed/rss", category: "industry" },

  // ── Pumps & Water Management ──
  { name: "Fluid Handling Magazine", feedUrl: "https://fluidhandlingmag.com/feed/", category: "industry" },
  { name: "Pump Industry Australia", feedUrl: "https://www.pumpindustry.com.au/feed/", category: "industry" },
  { name: "Utility Magazine", feedUrl: "https://utilitymagazine.com.au/feed/", category: "industry" },

  // ── Construction Equipment & Power Generation ──
  { name: "Diesel Progress", feedUrl: "https://dieselnet.com/rss.xml", category: "industry" },

  // ── Project Databases & Tenders ──
  { name: "Projectory Australia", feedUrl: "https://www.projectory.com.au/rss.xml", category: "industry" },

  // ── Defence ──
  { name: "Defence Connect", feedUrl: "https://www.defenceconnect.com.au/news?format=feed&type=rss", category: "defence" },

];

export async function seedDefaultPipelineData(): Promise<{
  businessLinesCreated: number;
  rssSourcesCreated: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let businessLinesCreated = 0;
  let rssSourcesCreated = 0;

  // Seed business lines (skip if name already exists)
  for (const bl of DEFAULT_BUSINESS_LINES) {
    try {
      await db.insert(businessLines).values(bl);
      businessLinesCreated++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("Duplicate")) {
        console.error(`Failed to seed business line "${bl.name}":`, msg);
      }
    }
  }

  // Seed RSS sources (skip if feedUrl already exists)
  for (const src of DEFAULT_RSS_SOURCES) {
    try {
      // Check if source with same URL exists
      const existing = await db.select({ id: rssSources.id })
        .from(rssSources)
        .where(sql`${rssSources.feedUrl} = ${src.feedUrl}`)
        .limit(1);

      if (existing.length === 0) {
        await db.insert(rssSources).values(src);
        rssSourcesCreated++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to seed RSS source "${src.name}":`, msg);
    }
  }

  return { businessLinesCreated, rssSourcesCreated };
}
