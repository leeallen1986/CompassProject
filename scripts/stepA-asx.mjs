// Step A: ASX Targeted Monitoring (bypasses day-of-week guard)
import { register } from "tsx/esm/api";
const unregister = register();

const start = new Date();
console.log(`[StepA-ASX] START: ${start.toISOString()}`);

try {
  const { scanTargetCompanies } = await import("../server/asxMonitor.ts");

  const result = await scanTargetCompanies(7);

  const end = new Date();
  console.log(`[StepA-ASX] FINISH: ${end.toISOString()}`);
  console.log(`[StepA-ASX] Duration: ${((end - start) / 1000).toFixed(1)}s`);
  console.log(`[StepA-ASX] Companies checked: ${result.totalCompaniesChecked}`);
  console.log(`[StepA-ASX] Announcements scanned: ${result.totalAnnouncementsScanned}`);
  console.log(`[StepA-ASX] Project signals: ${result.totalProjectSignals}`);
  console.log(`[StepA-ASX] New projects: ${result.totalNewProjects}`);
  console.log(`[StepA-ASX] Duplicates: ${result.totalDuplicates}`);
  console.log(`[StepA-ASX] Errors: ${result.totalErrors}`);
  console.log(`[StepA-ASX] RESULT: ${JSON.stringify(result, null, 2)}`);
} catch (err) {
  console.error(`[StepA-ASX] FAILED: ${err.message}`);
  console.error(err.stack);
}

process.exit(0);
