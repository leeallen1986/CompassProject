/**
 * scoreReactivatedProjects.ts
 * Triggers BL scoring for the 7 reactivated specialty-air projects
 * that were previously stale and have no pre-computed dimension scores.
 */
import * as dotenv from "dotenv";
dotenv.config();

import mysql2 from "mysql2/promise";
import { scoreAndSaveProjects, getProjectScoresBatch } from "../server/businessLineScoring";

const REACTIVATED_IDS = [
  4,      // BW Opal FPSO / Barossa LNG Commissioning
  7,      // Woodside Scarborough Energy Project
  8,      // Shell Prelude FLNG Turnaround 2026
  120229, // Scarborough Gas Project
  120230, // Barossa Gas Project
  510034, // Barossa LNG Project
  120007, // Chevron Australia Operations — NWS & Gorgon (was already active but check)
  120008, // Woodside NWS Subsea Tieback Program
];

async function main() {
  console.log("=== BL SCORING FOR REACTIVATED SPECIALTY-AIR PROJECTS ===\n");

  // Check which ones already have scores
  const existingScores = await getProjectScoresBatch(REACTIVATED_IDS);
  console.log("Pre-existing scores:");
  for (const id of REACTIVATED_IDS) {
    const scores = existingScores.get(id) ?? [];
    console.log(`  ID ${id}: ${scores.length} dimension scores`);
  }

  // Find which need scoring
  const needsScoring = REACTIVATED_IDS.filter(id => {
    const scores = existingScores.get(id) ?? [];
    return scores.length === 0;
  });

  console.log(`\n${needsScoring.length} projects need scoring: ${needsScoring.join(", ")}`);

  if (needsScoring.length === 0) {
    console.log("All projects already have scores. Nothing to do.");
    process.exit(0);
  }

  console.log("\nRunning BL scoring pipeline...");
  const result = await scoreAndSaveProjects(needsScoring);
  console.log(`Scored: ${result.scored} | Failed: ${result.failed} | Skipped: ${result.skipped}`);

  // Verify scores were saved
  console.log("\nPost-scoring verification:");
  const newScores = await getProjectScoresBatch(REACTIVATED_IDS);
  for (const id of REACTIVATED_IDS) {
    const scores = newScores.get(id) ?? [];
    const paScore = scores.find(s => s.dimension === "Portable Air & Low Pressure");
    console.log(`  ID ${id}: ${scores.length} dimensions | PA score: ${paScore?.score ?? "N/A"}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
