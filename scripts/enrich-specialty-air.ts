/**
 * Targeted enrichment for zero-contact specialty air projects
 * Projects:
 *   1200065 - Ichthys LNG Project Operations (INPEX, Darwin NT)
 *   1290001 - Browse LNG Project (Woodside, Kimberley WA)
 *   1680001 - Ichthys LNG Export Terminal Operations (INPEX, Darwin NT)
 */
import "dotenv/config";
import { enrichProjectContacts } from "../server/apolloEnrichment";

const TARGET_PROJECTS = [1200065, 1290001, 1680001];
const DUMMY_REPORT_ID = 99999; // Standalone run, no pipeline report

async function main() {
  console.log(`\n=== Specialty Air Targeted Enrichment ===`);
  console.log(`Targeting ${TARGET_PROJECTS.length} projects...\n`);

  for (const projectId of TARGET_PROJECTS) {
    console.log(`\n--- Enriching project ${projectId} ---`);
    try {
      const result = await enrichProjectContacts(projectId, DUMMY_REPORT_ID, {
        enrichEmails: true,
        maxPerCompany: 5,
        targetTitles: [
          "Operations Manager",
          "Maintenance Manager",
          "Plant Manager",
          "Procurement Manager",
          "Contracts Manager",
          "Project Manager",
          "Engineering Manager",
          "Commissioning Manager",
          "Turnaround Manager",
          "Asset Manager",
          "Facilities Manager",
          "Site Manager",
        ],
      });
      console.log(`✓ Project ${projectId}: found=${result.found}, enriched=${result.enriched}, credits=${result.creditsUsed}`);
    } catch (err: any) {
      console.error(`✗ Project ${projectId} failed:`, err.message);
    }
  }

  console.log(`\n=== Done ===`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
