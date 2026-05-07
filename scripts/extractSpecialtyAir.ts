/**
 * Run AI extraction on the queued specialty-air articles.
 * Processes up to 50 articles from the queue.
 */
import * as dotenv from "dotenv";
dotenv.config();

import { runExtractionPipeline } from "../server/aiExtractor";

async function main() {
  console.log("\n=== SPECIALTY-AIR EXTRACTION PIPELINE ===");
  console.log("Processing up to 50 queued articles...\n");

  const result = await runExtractionPipeline(50);

  console.log("\nExtraction complete:");
  console.log(`  Articles processed: ${result.processed}`);
  console.log(`  Projects extracted: ${result.extracted}`);
  console.log(`  Errors: ${result.errors}`);
  if (result.details) {
    console.log("\nDetails:");
    result.details.forEach((d: any) => {
      console.log(`  [${d.status}] ${d.title?.slice(0, 70)}`);
      if (d.projectName) console.log(`    → Project: ${d.projectName}`);
      if (d.error) console.log(`    Error: ${d.error}`);
    });
  }

  process.exit(0);
}

main().catch(e => {
  console.error("Extraction failed:", e.message);
  process.exit(1);
});
