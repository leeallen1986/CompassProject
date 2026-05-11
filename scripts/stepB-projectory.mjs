// Step B: Projectory Enrichment (bypasses day-of-week guard)
import { register } from "tsx/esm/api";
const unregister = register();

const start = new Date();
console.log(`[StepB-Projectory] START: ${start.toISOString()}`);

try {
  const { enrichUnenrichedProjects } = await import("../server/projectoryEnrichment.ts");

  const result = await enrichUnenrichedProjects();

  const end = new Date();
  console.log(`[StepB-Projectory] FINISH: ${end.toISOString()}`);
  console.log(`[StepB-Projectory] Duration: ${((end - start) / 1000).toFixed(1)}s`);
  console.log(`[StepB-Projectory] RESULT: ${JSON.stringify(result, null, 2)}`);
} catch (err) {
  console.error(`[StepB-Projectory] FAILED: ${err.message}`);
  console.error(err.stack);
}

process.exit(0);
