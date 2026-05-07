/**
 * Manual harvest targeting the new oil & gas / offshore RSS feeds only.
 * Runs harvestAllFeeds() which picks up all active DB sources,
 * then runs the extraction pipeline on the resulting queued articles.
 */
import * as dotenv from "dotenv";
dotenv.config();

import { harvestAllFeeds } from "../server/rssHarvester";
import { runExtractionPipeline } from "../server/aiExtractor";
import mysql from "mysql2/promise";

const OIL_GAS_FEED_NAMES = [
  "Offshore Technology",
  "OilPrice.com",
  "LNG Prime",
  "Drilling Contractor",
  "NS Energy Business",
  "Hydrocarbons Technology",
  "Gas Today Australia",
  // Also include existing O&G sources
  "Rigzone",
  "Oil and Gas Australia",
  "Energy Voice",
];

const SPECIALTY_AIR_KEYWORDS = [
  "scarborough", "pluto", "barossa", "prelude", "flng", "fpso",
  "bw opal", "tieback", "subsea commissioning",
  "pipeline test", "purging", "inerting", "dry-out", "pre-commission",
  "instrument air", "booster compressor", "nitrogen membrane",
  "lng train", "north west shelf", "browse basin", "ichthys",
  "wheatstone", "gorgon", "pluto train 2", "offshore wa",
  "pipeline commissioning", "pipeline purging", "line drying",
  "dew point", "air dryer", "oil-free air", "instrument-air",
];

async function main() {
  console.log("\n=== MANUAL OIL & GAS HARVEST ===");
  console.log(`Targeting ${OIL_GAS_FEED_NAMES.length} O&G feed sources`);
  console.log(`Specialty-air keyword watch: ${SPECIALTY_AIR_KEYWORDS.length} terms\n`);

  // Step 1: Run full harvest (picks up all active feeds including new ones)
  console.log("Step 1: Running RSS harvest across all active feeds...");
  const harvestResult = await harvestAllFeeds();
  
  console.log(`\nHarvest complete:`);
  console.log(`  Sources processed: ${harvestResult.totalSources}`);
  console.log(`  Articles fetched: ${harvestResult.totalFetched}`);
  console.log(`  New articles queued: ${harvestResult.totalNew}`);
  console.log(`  Duplicates skipped: ${harvestResult.totalDuplicates}`);
  console.log(`  Errors: ${harvestResult.totalErrors}`);
  
  // Show results per O&G feed
  console.log("\nO&G feed results:");
  for (const result of harvestResult.results) {
    const isOilGas = OIL_GAS_FEED_NAMES.some(n => 
      result.sourceName?.toLowerCase().includes(n.toLowerCase())
    );
    if (isOilGas || result.newArticles > 0) {
      console.log(`  ${result.sourceName}: fetched=${result.fetched}, new=${result.newArticles}, dups=${result.duplicates}${result.errors.length > 0 ? `, errors=${result.errors.length}` : ''}`);
    }
  }

  // Step 2: Check for specialty-air articles in the queue
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const kwConditions = SPECIALTY_AIR_KEYWORDS.map(k => 
    `(LOWER(a.title) LIKE '%${k}%' OR LOWER(a.summary) LIKE '%${k}%')`
  ).join(' OR ');
  
  const [specialtyArticles] = await conn.execute(`
    SELECT a.id, a.title, a.status, a.publishedAt, s.name as sourceName
    FROM raw_articles a
    LEFT JOIN rss_sources s ON s.id = a.sourceId
    WHERE a.status IN ('queued', 'pending')
    AND (${kwConditions})
    ORDER BY a.publishedAt DESC
    LIMIT 50
  `) as any[];
  
  console.log(`\nSpecialty-air articles now in queue: ${specialtyArticles.length}`);
  if (specialtyArticles.length > 0) {
    specialtyArticles.forEach((a: any) => {
      console.log(`  [ID:${a.id}] ${a.title?.slice(0, 80)}`);
      console.log(`    Source: ${a.sourceName} | Status: ${a.status} | Published: ${a.publishedAt}`);
    });
  } else {
    console.log("  ⚠️  No specialty-air articles found in queue.");
    console.log("  This means either:");
    console.log("  1. The new feeds don't currently have specialty-air articles in their RSS");
    console.log("  2. The keyword gate is not matching — check matchedKeywords in raw_articles");
    
    // Check if any articles were saved from O&G feeds at all
    const [recentOilGas] = await conn.execute(`
      SELECT a.id, a.title, a.status, s.name as sourceName
      FROM raw_articles a
      LEFT JOIN rss_sources s ON s.id = a.sourceId
      WHERE s.name IN (${OIL_GAS_FEED_NAMES.map(n => `'${n}'`).join(',')})
      ORDER BY a.id DESC
      LIMIT 20
    `) as any[];
    
    console.log(`\nMost recent articles from O&G feeds (any status): ${recentOilGas.length}`);
    recentOilGas.forEach((a: any) => {
      console.log(`  [${a.status}] ${a.sourceName}: ${a.title?.slice(0, 70)}`);
    });
  }

  // Step 3: Run extraction pipeline on queued articles
  if (specialtyArticles.length > 0 || harvestResult.totalNew > 0) {
    console.log(`\nStep 2: Running AI extraction pipeline (max 30 articles)...`);
    const extractResult = await runExtractionPipeline(30);
    console.log(`\nExtraction complete:`);
    console.log(`  Articles processed: ${extractResult.processed}`);
    console.log(`  Projects extracted: ${extractResult.extracted}`);
    console.log(`  Errors: ${extractResult.errors}`);
  } else {
    console.log("\nStep 2: Skipping extraction — no new articles to process.");
  }

  // Step 4: Check if any new WA specialty-air projects were created
  const [newProjects] = await conn.execute(`
    SELECT p.id, p.name, p.location, p.projectState, p.priority, p.sector,
           LEFT(p.overview, 150) as overviewSnip
    FROM projects p
    WHERE p.lifecycleStatus = 'active'
    AND p.suppressed != 1
    AND p.updatedAt >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
    AND (${SPECIALTY_AIR_KEYWORDS.slice(0, 10).map(k => 
      `(LOWER(p.name) LIKE '%${k}%' OR LOWER(p.overview) LIKE '%${k}%')`
    ).join(' OR ')})
    ORDER BY p.updatedAt DESC
    LIMIT 20
  `) as any[];
  
  console.log(`\nNew/updated specialty-air projects (last 2 hours): ${newProjects.length}`);
  newProjects.forEach((p: any) => {
    console.log(`  [ID:${p.id}] ${p.name}`);
    console.log(`    Location: ${p.location} | State: ${p.projectState} | Priority: ${p.priority}`);
    console.log(`    Overview: ${p.overviewSnip?.replace(/\n/g, ' ')}`);
    console.log('');
  });

  await conn.end();
  console.log("\n=== HARVEST COMPLETE ===\n");
  process.exit(0);
}

main().catch(e => {
  console.error("Harvest failed:", e.message);
  process.exit(1);
});
