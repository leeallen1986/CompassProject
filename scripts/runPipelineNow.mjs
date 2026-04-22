/**
 * runPipelineNow.mjs
 * Triggers the full daily pipeline (harvest → extract → enrich → notify)
 * and prints a structured result summary.
 */
import { createRequire } from "module";
import { register } from "tsx/esm/api";

register();

const { runDailyPipeline } = await import("../server/dailyPipeline.ts");

const startTime = new Date();
console.log(`\n[Pipeline] START: ${startTime.toISOString()}\n`);

let result;
try {
  result = await runDailyPipeline("pre-send-check");
} catch (err) {
  console.error("[Pipeline] FATAL ERROR:", err);
  process.exit(1);
}

const endTime = new Date();
const durationMs = endTime - startTime;
const durationMin = (durationMs / 60000).toFixed(1);

console.log(`\n[Pipeline] FINISH: ${endTime.toISOString()}`);
console.log(`[Pipeline] Duration: ${durationMin} minutes`);
console.log(`\n=== PIPELINE RESULT SUMMARY ===`);
console.log(`Status:             ${result.success ? "SUCCESS ✅" : "FAILED ❌"}`);
console.log(`Start time:         ${startTime.toISOString()}`);
console.log(`Finish time:        ${endTime.toISOString()}`);
console.log(`Duration:           ${durationMin} min`);

if (result.steps) {
  console.log(`\nStep results:`);
  for (const [stepName, stepResult] of Object.entries(result.steps)) {
    const status = stepResult?.success !== false ? "✅" : "❌";
    const detail = stepResult?.articlesHarvested != null
      ? `harvested=${stepResult.articlesHarvested}`
      : stepResult?.extracted != null
      ? `extracted=${stepResult.extracted}`
      : stepResult?.enriched != null
      ? `enriched=${stepResult.enriched}`
      : stepResult?.error
      ? `error=${stepResult.error}`
      : "";
    console.log(`  ${status} ${stepName}${detail ? ` (${detail})` : ""}`);
  }
}

if (result.errors && result.errors.length > 0) {
  console.log(`\nFailed steps / errors:`);
  for (const err of result.errors) {
    console.log(`  ❌ ${err}`);
  }
}

if (result.projectsAdded != null) console.log(`\nProjects added:     ${result.projectsAdded}`);
if (result.projectsUpdated != null) console.log(`Projects updated:   ${result.projectsUpdated}`);
if (result.contactsEnriched != null) console.log(`Contacts enriched:  ${result.contactsEnriched}`);
if (result.articlesHarvested != null) console.log(`Articles harvested: ${result.articlesHarvested}`);
if (result.articlesExtracted != null) console.log(`Articles extracted: ${result.articlesExtracted}`);

console.log(`\n=== END PIPELINE SUMMARY ===\n`);

process.exit(result.success ? 0 : 1);
