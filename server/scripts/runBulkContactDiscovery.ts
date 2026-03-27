/**
 * Bulk Contact Discovery Script
 *
 * Runs both Web Stakeholder Discovery (for projects with no contacts)
 * and Second-Pass Contact Search (for projects with <2 relevant contacts).
 *
 * Usage: npx tsx server/scripts/runBulkContactDiscovery.ts
 */

import "dotenv/config";
import { runBulkWebDiscovery } from "../webStakeholderDiscovery";
import { runBulkSecondPass } from "../secondPassContactSearch";

async function main() {
  console.log("=== Bulk Contact Discovery ===");
  console.log(`Started at: ${new Date().toISOString()}`);

  // ── Phase 1: Web Stakeholder Discovery (projects with no contacts) ──
  console.log("\n--- Phase 1: Web Stakeholder Discovery ---");
  try {
    const webResult = await runBulkWebDiscovery(50);
    console.log(`Web Discovery complete:`);
    console.log(`  Projects processed: ${webResult.processed}`);
    console.log(`  Contacts found: ${webResult.contactsFound}`);
    if (webResult.errors.length > 0) {
      console.log(`  Errors: ${webResult.errors.slice(0, 5).join(", ")}`);
    }
  } catch (err) {
    console.error("Web Discovery failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Phase 2: Second-Pass Contact Search (projects with <2 relevant contacts) ──
  console.log("\n--- Phase 2: Second-Pass Contact Search (batch 1 of 6) ---");
  let totalContactsAdded = 0;
  let totalProjectsImproved = 0;

  for (let batch = 1; batch <= 6; batch++) {
    console.log(`\n  Running batch ${batch}/6 (up to 50 projects)...`);
    try {
      const spResult = await runBulkSecondPass(50);
      totalContactsAdded += spResult.totalContactsAdded;
      totalProjectsImproved += spResult.projectsImproved;
      console.log(`  Batch ${batch}: ${spResult.totalContactsAdded} contacts added, ${spResult.projectsImproved} projects improved`);

      // If quota exhausted, stop
      if (spResult.errors.some(e => e.toLowerCase().includes("quota"))) {
        console.log("  LinkedIn quota exhausted — stopping early");
        break;
      }

      // If no projects were processed, we're done
      if (spResult.projectsProcessed === 0) {
        console.log("  No more projects to process");
        break;
      }

      // Delay between batches
      if (batch < 6) {
        console.log("  Waiting 5s before next batch...");
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Batch ${batch} failed:`, msg);
      if (msg.includes("quota") || msg.includes("QUOTA")) break;
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Total contacts added via second-pass: ${totalContactsAdded}`);
  console.log(`Total projects improved: ${totalProjectsImproved}`);
  console.log(`Completed at: ${new Date().toISOString()}`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
