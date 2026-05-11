// Step 4: Enrich Contacts — manual recovery run
// Uses the same batch size (200) as the daily pipeline
import { register } from "tsx/esm/api";
const unregister = register();

const start = new Date();
console.log(`[Step4] START: ${start.toISOString()}`);

try {
  const { runEnrichmentPipeline } = await import("../server/contactEnrichment.ts");
  const result = await runEnrichmentPipeline(200);
  const end = new Date();
  console.log(`[Step4] FINISH: ${end.toISOString()}`);
  console.log(`[Step4] Duration: ${((end - start) / 1000).toFixed(1)}s`);
  console.log(`[Step4] Status: SUCCESS`);
  console.log(`[Step4] Processed: ${result.processed}`);
  console.log(`[Step4] Enriched: ${result.enriched}`);
  console.log(`[Step4] Not found: ${result.notFound}`);
  console.log(`[Step4] Failed: ${result.failed}`);
  console.log(`[Step4] Daily used: ${result.dailyUsed}`);
  console.log(`[Step4] Daily cap: ${result.dailyCap}`);
} catch (err) {
  const end = new Date();
  console.log(`[Step4] FINISH: ${end.toISOString()}`);
  console.log(`[Step4] Status: FAILED`);
  console.log(`[Step4] Error: ${err.message}`);
  console.log(`[Step4] Stack: ${err.stack}`);
}

process.exit(0);
