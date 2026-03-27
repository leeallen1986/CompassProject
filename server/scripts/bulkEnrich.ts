/**
 * Direct-execution bulk contractor enrichment script.
 * Imports the enrichment functions directly and runs them without needing auth.
 * 
 * Usage: npx tsx server/scripts/bulkEnrich.ts [limit]
 */

import { runContractorEnrichmentPass, getEnrichmentPassStats, getMissingContractorCount } from "../contractorEnrichmentPass";

async function main() {
  const limit = parseInt(process.argv[2] || "350", 10);
  
  console.log("=== Bulk Contractor Enrichment (with Awarded Project Cross-Reference) ===\n");

  // Get current stats
  try {
    const stats = await getEnrichmentPassStats();
    console.log("Current state:");
    console.log(`  Total projects: ${stats.totalProjects}`);
    console.log(`  With contractors: ${stats.projectsWithContractors}`);
    console.log(`  Missing contractors: ${stats.projectsMissingContractors}`);
    console.log(`  Coverage: ${stats.coveragePercent}%`);
  } catch (e: any) {
    console.log(`  (Could not fetch stats: ${e.message})`);
  }

  console.log(`\nStarting enrichment pass (limit: ${limit})...`);
  console.log("Rate limited to 1.5s between LLM calls.");
  console.log("Each project gets LLM prediction cross-referenced with awarded project patterns.\n");

  const startTime = Date.now();
  
  try {
    const result = await runContractorEnrichmentPass(limit);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log("\n=== ENRICHMENT COMPLETE ===");
    console.log(`  Time elapsed: ${elapsed}s`);
    console.log(`  Projects processed: ${result.total}`);
    console.log(`  Successfully enriched: ${result.enriched}`);
    console.log(`  Contractors discovered: ${result.contractorsDiscovered}`);
    console.log(`  Skipped (no results): ${result.skipped}`);
    console.log(`  Failed: ${result.failed}`);
    
    if (result.results && result.results.length > 0) {
      console.log(`\n  Sample results (first 10):`);
      for (const r of result.results.slice(0, 10)) {
        console.log(`    - ${r.projectName}: ${r.contractorsFound.length} contractors`);
        for (const c of r.contractorsFound.slice(0, 3)) {
          console.log(`      • ${c.name} (${c.role}, ${c.confidence}): ${c.detail}`);
        }
      }
    }
  } catch (error: any) {
    console.error("Error running enrichment:", error.message);
    console.error(error.stack);
    process.exit(1);
  }

  // Get updated stats
  console.log("\nFetching updated stats...");
  try {
    const stats = await getEnrichmentPassStats();
    console.log(`  Total projects: ${stats.totalProjects}`);
    console.log(`  With contractors: ${stats.projectsWithContractors}`);
    console.log(`  Missing contractors: ${stats.projectsMissingContractors}`);
    console.log(`  Coverage: ${stats.coveragePercent}%`);
  } catch (e: any) {
    console.log(`  (Could not fetch updated stats: ${e.message})`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
