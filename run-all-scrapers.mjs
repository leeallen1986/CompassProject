/**
 * Full Pipeline Runner — runs ALL scrapers regardless of day-of-week
 * Usage: node run-all-scrapers.mjs
 */
import 'dotenv/config';

// Dynamic import of the compiled server modules
const { harvestAllFeeds } = await import('./server/rssHarvester.ts');
const { runExtractionPipeline } = await import('./server/aiExtractor.ts');
const { runProjectoryScraper } = await import('./server/projectoryScraper.ts');
const { runDmirsScraper } = await import('./server/dmirsScraper.ts');
const { runAemoScraper } = await import('./server/aemoScraper.ts');
const { runGovScraper } = await import('./server/govScraper.ts');
const { runAusTenderScraper } = await import('./server/austenderScraper.ts');
const { runIcnScraper } = await import('./server/icnScraper.ts');
const { runEnrichmentPipeline } = await import('./server/contactEnrichment.ts');

const startTime = Date.now();
const results = {};

console.log("=== FULL PIPELINE RUN (ALL SCRAPERS) ===\n");

// Step 1: RSS Harvest
console.log("[1/9] Harvesting RSS feeds...");
try {
  const r = await harvestAllFeeds();
  results.rss = r;
  console.log(`  ✓ ${r.totalNew} new articles from ${r.totalSources} sources (${r.totalDuplicates} duplicates)\n`);
} catch (e) {
  console.error(`  ✗ RSS Harvest failed: ${e.message}\n`);
  results.rss = { error: e.message };
}

// Step 2: AI Extraction
console.log("[2/9] Running AI extraction on queued articles...");
try {
  const r = await runExtractionPipeline();
  results.extraction = r;
  console.log(`  ✓ ${r.extracted} projects extracted from ${r.processed} articles (${r.creditsUsed} LLM credits)\n`);
} catch (e) {
  console.error(`  ✗ AI Extraction failed: ${e.message}\n`);
  results.extraction = { error: e.message };
}

// Step 3: Projectory
console.log("[3/9] Scraping Projectory...");
try {
  const r = await runProjectoryScraper();
  results.projectory = r;
  console.log(`  ✓ ${r.totalNewProjects} new projects, ${r.totalNewContacts} contacts (${r.totalDuplicates} duplicates, ${Math.round(r.duration)}s)\n`);
} catch (e) {
  console.error(`  ✗ Projectory failed: ${e.message}\n`);
  results.projectory = { error: e.message };
}

// Step 4: DMIRS
console.log("[4/9] Scraping DMIRS MINEDEX...");
try {
  const r = await runDmirsScraper();
  results.dmirs = r;
  console.log(`  ✓ ${r.totalNewProjects} new projects (${r.totalDuplicates} duplicates, ${Math.round(r.duration)}s)\n`);
} catch (e) {
  console.error(`  ✗ DMIRS failed: ${e.message}\n`);
  results.dmirs = { error: e.message };
}

// Step 5: AEMO
console.log("[5/9] Scraping AEMO generation projects...");
try {
  const r = await runAemoScraper();
  results.aemo = r;
  console.log(`  ✓ ${r.totalNewProjects} new projects (${r.totalDuplicates} duplicates, ${r.totalSkipped} skipped, ${Math.round(r.duration)}s)\n`);
} catch (e) {
  console.error(`  ✗ AEMO failed: ${e.message}\n`);
  results.aemo = { error: e.message };
}

// Step 6: Government Major Projects
console.log("[6/9] Scraping Government major projects...");
try {
  const r = await runGovScraper();
  results.gov = r;
  console.log(`  ✓ ${r.totalNewProjects} new projects (${r.totalDuplicates} duplicates, ${Math.round(r.duration)}s)\n`);
} catch (e) {
  console.error(`  ✗ Gov scraper failed: ${e.message}\n`);
  results.gov = { error: e.message };
}

// Step 7: AusTender
console.log("[7/9] Scraping AusTender contracts...");
try {
  const r = await runAusTenderScraper();
  results.austender = r;
  console.log(`  ✓ ${r.totalNewProjects} new projects from ${r.totalRelevant} relevant (${r.totalFetched} fetched, ${Math.round(r.duration)}s)\n`);
} catch (e) {
  console.error(`  ✗ AusTender failed: ${e.message}\n`);
  results.austender = { error: e.message };
}

// Step 8: ICN Gateway
console.log("[8/9] Scraping ICN Gateway...");
try {
  const r = await runIcnScraper();
  results.icn = r;
  console.log(`  ✓ ${r.totalNewProjects} new projects (${r.totalDuplicates} duplicates, ${Math.round(r.duration)}s)\n`);
} catch (e) {
  console.error(`  ✗ ICN failed: ${e.message}\n`);
  results.icn = { error: e.message };
}

// Step 9: Contact Enrichment
console.log("[9/9] Running contact enrichment...");
try {
  const r = await runEnrichmentPipeline();
  results.enrichment = r;
  console.log(`  ✓ ${r.enriched} contacts enriched from ${r.processed} processed\n`);
} catch (e) {
  console.error(`  ✗ Contact enrichment failed: ${e.message}\n`);
  results.enrichment = { error: e.message };
}

const duration = Math.round((Date.now() - startTime) / 1000);
console.log(`\n=== PIPELINE COMPLETE in ${duration}s ===`);
console.log(JSON.stringify(results, null, 2));

process.exit(0);
