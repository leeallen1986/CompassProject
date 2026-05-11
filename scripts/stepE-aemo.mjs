// Step E: AEMO Generation Info (bypasses Friday-only guard)
import { register } from "tsx/esm/api";
const unregister = register();

const start = new Date();
console.log(`[StepE-AEMO] START: ${start.toISOString()}`);

try {
  const { runAemoScraper } = await import("../server/aemoScraper.ts");

  const result = await runAemoScraper();

  const end = new Date();
  console.log(`[StepE-AEMO] FINISH: ${end.toISOString()}`);
  console.log(`[StepE-AEMO] Duration: ${((end - start) / 1000).toFixed(1)}s`);
  console.log(`[StepE-AEMO] RESULT: ${JSON.stringify(result, null, 2)}`);
} catch (err) {
  console.error(`[StepE-AEMO] FAILED: ${err.message}`);
  console.error(err.stack);
}

process.exit(0);
