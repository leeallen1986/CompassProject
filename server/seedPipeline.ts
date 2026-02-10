/**
 * Seed script — Populates default business lines and RSS sources.
 * Called from an admin endpoint or run manually.
 */
import { getDb } from "./db";
import { businessLines, rssSources } from "../drizzle/schema";
import { sql } from "drizzle-orm";

const DEFAULT_BUSINESS_LINES = [
  {
    name: "Portable Air",
    description: "Portable compressors for mining, construction, drilling, and infrastructure projects. Key products include XAS, XATS, XAHS, and XAVS series.",
    keywords: [
      "compressor", "portable air", "compressed air", "drilling", "RC drilling",
      "diamond drilling", "blasting", "pneumatic", "CFM", "air compressor",
      "sandblasting", "shotcrete", "tunnelling", "mining equipment",
      "construction equipment", "atlas copco", "portable compressor",
      "air receiver", "aftercooler", "drill rig"
    ],
    sectors: ["mining", "oil_gas", "infrastructure", "energy", "defence"],
    equipmentTypes: [
      "Portable Compressor", "Booster Compressor", "Drill Rig",
      "Air Treatment", "Lighting Tower"
    ],
    defaultTerritories: ["WA", "QLD", "NSW", "SA", "NT", "VIC", "TAS"],
  },
  {
    name: "Industrial Compressors",
    description: "Stationary compressors for manufacturing, process industries, food & beverage, and energy. GA, ZR, ZT series.",
    keywords: [
      "industrial compressor", "stationary compressor", "oil-free compressor",
      "screw compressor", "centrifugal compressor", "manufacturing plant",
      "process air", "instrument air", "plant air", "nitrogen generation",
      "food processing", "pharmaceutical", "semiconductor", "data centre",
      "compressed air system", "energy efficiency", "VSD compressor"
    ],
    sectors: ["energy", "infrastructure"],
    equipmentTypes: [
      "Screw Compressor", "Centrifugal Compressor", "Oil-Free Compressor",
      "Nitrogen Generator", "Air Dryer"
    ],
    defaultTerritories: ["NSW", "VIC", "QLD", "SA", "WA"],
  },
  {
    name: "Power Technique",
    description: "Generators, pumps, and lighting towers for construction, mining, and events. QAS, QES, PAS series.",
    keywords: [
      "generator", "power generation", "diesel generator", "portable generator",
      "dewatering pump", "lighting tower", "light tower", "temporary power",
      "standby power", "backup power", "construction power", "mine site power",
      "pump station", "submersible pump", "wellpoint dewatering"
    ],
    sectors: ["mining", "infrastructure", "energy"],
    equipmentTypes: [
      "Diesel Generator", "Lighting Tower", "Dewatering Pump",
      "Submersible Pump", "Power Pack"
    ],
    defaultTerritories: ["WA", "QLD", "NSW", "NT"],
  },
  {
    name: "Vacuum Solutions",
    description: "Vacuum pumps and systems for semiconductor, food packaging, and industrial processes.",
    keywords: [
      "vacuum pump", "vacuum system", "semiconductor", "food packaging",
      "vacuum technology", "dry vacuum", "liquid ring", "rotary vane",
      "central vacuum", "vacuum conveying", "packaging line"
    ],
    sectors: ["infrastructure", "energy"],
    equipmentTypes: [
      "Dry Vacuum Pump", "Liquid Ring Pump", "Rotary Vane Pump",
      "Vacuum Booster", "Central Vacuum System"
    ],
    defaultTerritories: ["NSW", "VIC", "QLD"],
  },
];

const DEFAULT_RSS_SOURCES = [
  // Industry Publications
  { name: "Australian Mining", feedUrl: "https://www.australianmining.com.au/feed/", category: "industry" },
  { name: "Mining Magazine", feedUrl: "https://www.miningmagazine.com/feed/", category: "industry" },
  { name: "International Mining", feedUrl: "https://im-mining.com/feed/", category: "industry" },
  { name: "Mining.com", feedUrl: "https://www.mining.com/feed/", category: "industry" },
  { name: "Mining Technology", feedUrl: "https://www.mining-technology.com/feed/", category: "industry" },
  { name: "Energy News Bulletin", feedUrl: "https://www.energynewsbulletin.net/feed/", category: "industry" },

  // News Sources
  { name: "Australian Financial Review - Companies", feedUrl: "https://www.afr.com/rss/companies", category: "news" },
  { name: "The Australian - Business", feedUrl: "https://www.theaustralian.com.au/business/rss", category: "news" },

  // Infrastructure
  { name: "Infrastructure Magazine", feedUrl: "https://infrastructuremagazine.com.au/feed/", category: "industry" },
  { name: "Roads & Infrastructure", feedUrl: "https://roadsonline.com.au/feed/", category: "industry" },

  // Energy
  { name: "Renew Economy", feedUrl: "https://reneweconomy.com.au/feed/", category: "industry" },
  { name: "Energy Magazine", feedUrl: "https://www.energymagazine.com.au/feed/", category: "industry" },

  // Oil & Gas
  { name: "Energy News Australia", feedUrl: "https://www.energynewsaustralia.com/feed/", category: "industry" },

  // Government / Tenders
  { name: "WA Government Media", feedUrl: "https://www.mediastatements.wa.gov.au/RSS", category: "government" },
  { name: "QLD Government News", feedUrl: "https://statements.qld.gov.au/feed", category: "government" },

  // ASX / Financial
  { name: "Proactive Investors AU", feedUrl: "https://www.proactiveinvestors.com.au/pages/rss", category: "asx" },
  { name: "Small Caps", feedUrl: "https://smallcaps.com.au/feed/", category: "asx" },
  { name: "Stockhead", feedUrl: "https://stockhead.com.au/feed/", category: "asx" },
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
