// Step C: DMIRS MINEDEX API (bypasses Wednesday-only guard)
import { register } from "tsx/esm/api";
const unregister = register();

const start = new Date();
console.log(`[StepC-DMIRS] START: ${start.toISOString()}`);

try {
  const { runDmirsScraper } = await import("../server/dmirsScraper.ts");

  const result = await runDmirsScraper();

  const end = new Date();
  console.log(`[StepC-DMIRS] FINISH: ${end.toISOString()}`);
  console.log(`[StepC-DMIRS] Duration: ${((end - start) / 1000).toFixed(1)}s`);
  console.log(`[StepC-DMIRS] New projects: ${result.totalNewProjects}`);
  console.log(`[StepC-DMIRS] Duplicates: ${result.totalDuplicates}`);
  console.log(`[StepC-DMIRS] Errors: ${result.totalErrors}`);
  console.log(`[StepC-DMIRS] RESULT: ${JSON.stringify(result, null, 2)}`);
} catch (err) {
  console.error(`[StepC-DMIRS] FAILED: ${err.message}`);
  console.error(err.stack);
}

process.exit(0);
