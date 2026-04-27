/**
 * Supervised pipeline run — triggers runDailyPipeline directly
 * and prints the result summary.
 */
import { runDailyPipeline } from "../server/dailyPipeline";

async function main() {
  console.log("=== SUPERVISED PIPELINE RUN ===");
  console.log(`Started: ${new Date().toISOString()}`);
  console.log("Triggering runDailyPipeline('supervised-manual')...\n");

  try {
    const result = await runDailyPipeline("supervised-manual");
    
    console.log("\n=== PIPELINE RESULT ===");
    console.log(`Duration: ${result.duration}s`);
    console.log(`Completed at: ${result.completedAt}`);
    
    console.log("\nHarvest:");
    console.log(`  Sources: ${result.harvest.totalSources}`);
    console.log(`  New articles: ${result.harvest.totalNew}`);
    console.log(`  Duplicates: ${result.harvest.totalDuplicates}`);
    console.log(`  Errors: ${result.harvest.totalErrors}`);
    
    console.log("\nExtraction:");
    console.log(`  Processed: ${result.extraction.processed}`);
    console.log(`  Extracted: ${result.extraction.extracted}`);
    console.log(`  Duplicates: ${result.extraction.duplicates}`);
    console.log(`  Failed: ${result.extraction.failed}`);
    
    console.log("\nEnrichment:");
    console.log(`  Processed: ${result.enrichment.processed}`);
    console.log(`  Enriched: ${result.enrichment.enriched}`);
    console.log(`  Not found: ${result.enrichment.notFound}`);
    console.log(`  Failed: ${result.enrichment.failed}`);
    console.log(`  Daily used: ${result.enrichment.dailyUsed}`);
    
    console.log("\nSteps:");
    for (const step of result.steps) {
      const icon = step.status === "completed" ? "✓" : step.status === "failed" ? "✗" : "○";
      console.log(`  ${icon} ${step.name} (${step.status}, ${step.durationMs}ms)`);
    }
    
    console.log("\n=== SUPERVISED RUN COMPLETE ===");
  } catch (err) {
    console.error("\n=== PIPELINE FAILED ===");
    console.error(err instanceof Error ? err.message : String(err));
    console.error(err instanceof Error ? err.stack : "");
  }
  
  process.exit(0);
}

main();
