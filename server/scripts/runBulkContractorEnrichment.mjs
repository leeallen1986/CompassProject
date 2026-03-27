/**
 * One-time bulk contractor enrichment script.
 * Runs the enhanced contractor enrichment engine (with awarded project cross-referencing)
 * on ALL projects missing contractor information.
 * 
 * Usage: node server/scripts/runBulkContractorEnrichment.mjs
 * 
 * This script calls the server's tRPC endpoint via HTTP to trigger the enrichment.
 */

const BASE_URL = "http://localhost:3000";

async function main() {
  console.log("=== Bulk Contractor Enrichment (with Awarded Project Cross-Reference) ===\n");

  // First, get the current stats
  console.log("Fetching current enrichment stats...");
  
  try {
    // Get missing count via direct DB query through the API
    const statsRes = await fetch(`${BASE_URL}/api/trpc/contractorEnrichment.stats`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    
    if (statsRes.ok) {
      const statsData = await statsRes.json();
      const stats = statsData?.result?.data;
      if (stats) {
        console.log(`  Total projects: ${stats.totalProjects}`);
        console.log(`  With contractors: ${stats.projectsWithContractors}`);
        console.log(`  Missing contractors: ${stats.projectsMissingContractors}`);
        console.log(`  Coverage: ${stats.coveragePercent}%`);
      }
    }
  } catch (e) {
    console.log("  (Could not fetch stats - continuing anyway)");
  }

  console.log("\nStarting bulk enrichment pass (limit: 350)...");
  console.log("This will process all missing-contractor projects with LLM + awarded project cross-referencing.");
  console.log("Rate limited to 1.5s between requests. Estimated time: ~8-10 minutes for 292 projects.\n");

  try {
    const res = await fetch(`${BASE_URL}/api/trpc/contractorEnrichment.runPass`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        json: { limit: 350 },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`HTTP ${res.status}: ${text}`);
      
      // If auth required, we need a different approach
      if (res.status === 401) {
        console.log("\nAuth required. Will run enrichment directly via import instead.");
        process.exit(1);
      }
      return;
    }

    const data = await res.json();
    const result = data?.result?.data;
    
    if (result) {
      console.log("\n=== ENRICHMENT COMPLETE ===");
      console.log(`  Projects processed: ${result.total}`);
      console.log(`  Successfully enriched: ${result.enriched}`);
      console.log(`  Contractors discovered: ${result.contractorsDiscovered}`);
      console.log(`  Skipped (no results): ${result.skipped}`);
      console.log(`  Failed: ${result.failed}`);
      
      if (result.results && result.results.length > 0) {
        console.log(`\n  Sample results:`);
        for (const r of result.results.slice(0, 5)) {
          console.log(`    - ${r.projectName}: ${r.contractorsFound.length} contractors found`);
          for (const c of r.contractorsFound.slice(0, 2)) {
            console.log(`      • ${c.name} (${c.role}, ${c.confidence})`);
          }
        }
      }
    } else {
      console.log("Response:", JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error("Error running enrichment:", error.message);
    process.exit(1);
  }

  // Get updated stats
  console.log("\nFetching updated stats...");
  try {
    const statsRes = await fetch(`${BASE_URL}/api/trpc/contractorEnrichment.stats`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    
    if (statsRes.ok) {
      const statsData = await statsRes.json();
      const stats = statsData?.result?.data;
      if (stats) {
        console.log(`  Total projects: ${stats.totalProjects}`);
        console.log(`  With contractors: ${stats.projectsWithContractors}`);
        console.log(`  Missing contractors: ${stats.projectsMissingContractors}`);
        console.log(`  Coverage: ${stats.coveragePercent}%`);
      }
    }
  } catch (e) {
    console.log("  (Could not fetch updated stats)");
  }
}

main().catch(console.error);
