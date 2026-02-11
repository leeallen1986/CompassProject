/**
 * Harvest all RSS feeds then run AI extraction on queued articles
 * Runs extraction in batches until all queued articles are processed
 */
import 'dotenv/config';

const { harvestAllFeeds } = await import('./server/rssHarvester.ts');
const { runExtractionPipeline } = await import('./server/aiExtractor.ts');

const startTime = Date.now();

// Step 1: Harvest
console.log("=== HARVESTING ALL 62 RSS FEEDS ===\n");
try {
  const r = await harvestAllFeeds();
  console.log(`Harvest complete:`);
  console.log(`  Sources: ${r.totalSources}`);
  console.log(`  Fetched: ${r.totalFetched}`);
  console.log(`  New articles: ${r.totalNew}`);
  console.log(`  Duplicates: ${r.totalDuplicates}`);
  console.log(`  Errors: ${r.totalErrors}`);
  
  // Show per-source results for new feeds
  const withNew = r.results.filter(s => s.newArticles > 0);
  if (withNew.length > 0) {
    console.log(`\n  Sources with new articles:`);
    for (const s of withNew) {
      console.log(`    ${s.sourceName}: ${s.newArticles} new (${s.fetched} fetched)`);
    }
  }
  
  const withErrors = r.results.filter(s => s.errors.length > 0);
  if (withErrors.length > 0) {
    console.log(`\n  Sources with errors:`);
    for (const s of withErrors) {
      console.log(`    ${s.sourceName}: ${s.errors.join(', ')}`);
    }
  }
} catch (e) {
  console.error(`Harvest failed: ${e.message}`);
}

// Step 2: AI Extraction (run multiple passes)
console.log("\n=== RUNNING AI EXTRACTION ===\n");
let totalExtracted = 0;
let totalProcessed = 0;
let pass = 0;

while (pass < 10) {  // Max 10 passes
  pass++;
  console.log(`\n--- Extraction pass ${pass} ---`);
  try {
    const r = await runExtractionPipeline();
    totalProcessed += r.processed;
    totalExtracted += r.extracted;
    console.log(`  Processed: ${r.processed}, Extracted: ${r.extracted}, Duplicates: ${r.duplicates}, Failed: ${r.failed}`);
    
    if (r.processed === 0) {
      console.log("  No more queued articles. Done.");
      break;
    }
  } catch (e) {
    console.error(`  Extraction pass ${pass} failed: ${e.message}`);
    break;
  }
}

const duration = Math.round((Date.now() - startTime) / 1000);
console.log(`\n=== COMPLETE in ${duration}s ===`);
console.log(`Total processed: ${totalProcessed}`);
console.log(`Total extracted: ${totalExtracted}`);

process.exit(0);
