// Step 3: Score Business Lines — manual recovery run
import { register } from "tsx/esm/api";
const unregister = register();

const start = new Date();
console.log(`[Step3] START: ${start.toISOString()}`);

try {
  const { getUnscoredProjectIds, scoreAndSaveProjects } = await import("../server/businessLineScoring.ts");
  const unscoredIds = await getUnscoredProjectIds(200);
  console.log(`[Step3] Unscored projects found: ${unscoredIds.length}`);
  
  if (unscoredIds.length > 0) {
    const result = await scoreAndSaveProjects(unscoredIds);
    const end = new Date();
    console.log(`[Step3] FINISH: ${end.toISOString()}`);
    console.log(`[Step3] Duration: ${((end - start) / 1000).toFixed(1)}s`);
    console.log(`[Step3] Status: SUCCESS`);
    console.log(`[Step3] Scored: ${result.scored}`);
    console.log(`[Step3] Failed: ${result.failed}`);
    console.log(`[Step3] Total: ${unscoredIds.length}`);
  } else {
    const end = new Date();
    console.log(`[Step3] FINISH: ${end.toISOString()}`);
    console.log(`[Step3] Duration: ${((end - start) / 1000).toFixed(1)}s`);
    console.log(`[Step3] Status: SUCCESS (no unscored projects)`);
    console.log(`[Step3] Scored: 0`);
    console.log(`[Step3] Failed: 0`);
    console.log(`[Step3] Total: 0`);
  }
} catch (err) {
  const end = new Date();
  console.log(`[Step3] FINISH: ${end.toISOString()}`);
  console.log(`[Step3] Status: FAILED`);
  console.log(`[Step3] Error: ${err.message}`);
  console.log(`[Step3] Stack: ${err.stack}`);
}

process.exit(0);
