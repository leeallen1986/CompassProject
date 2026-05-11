// Step 2: Run AI Extraction — manual recovery run
import { register } from "tsx/esm/api";
const unregister = register();

const start = new Date();
console.log(`[Step2] START: ${start.toISOString()}`);

try {
  const { runExtractionPipeline } = await import("../server/aiExtractor.ts");
  const result = await runExtractionPipeline();
  const end = new Date();
  console.log(`[Step2] FINISH: ${end.toISOString()}`);
  console.log(`[Step2] Duration: ${((end - start) / 1000).toFixed(1)}s`);
  console.log(`[Step2] Status: SUCCESS`);
  console.log(`[Step2] Articles processed: ${result.processed ?? 'N/A'}`);
  console.log(`[Step2] Projects created: ${result.projectsCreated ?? 'N/A'}`);
  console.log(`[Step2] Projects duplicate: ${result.projectsDuplicate ?? 'N/A'}`);
  console.log(`[Step2] Extracted: ${result.extracted ?? 'N/A'}`);
  console.log(`[Step2] Drilling campaigns: ${result.drillingCampaigns ?? 'N/A'}`);
  console.log(`[Step2] Awarded projects: ${result.awardedProjects ?? 'N/A'}`);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const end = new Date();
  console.log(`[Step2] FINISH: ${end.toISOString()}`);
  console.log(`[Step2] Status: FAILED`);
  console.log(`[Step2] Error: ${err.message}`);
  console.log(`[Step2] Stack: ${err.stack}`);
}

process.exit(0);
