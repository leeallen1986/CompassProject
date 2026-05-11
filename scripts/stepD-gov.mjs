// Step D: Gov Major Projects (bypasses Tuesday-only guard)
import { register } from "tsx/esm/api";
const unregister = register();

const start = new Date();
console.log(`[StepD-Gov] START: ${start.toISOString()}`);

try {
  const { runGovScraper } = await import("../server/govScraper.ts");

  const result = await runGovScraper();

  const end = new Date();
  console.log(`[StepD-Gov] FINISH: ${end.toISOString()}`);
  console.log(`[StepD-Gov] Duration: ${((end - start) / 1000).toFixed(1)}s`);
  console.log(`[StepD-Gov] RESULT: ${JSON.stringify(result, null, 2)}`);
} catch (err) {
  console.error(`[StepD-Gov] FAILED: ${err.message}`);
  console.error(err.stack);
}

process.exit(0);
