// Step F: ICN Validation — runs both icnValidateAllProjects and runIcnScraper
// Bypasses Saturday-only guard
import { register } from "tsx/esm/api";
const unregister = register();

const start = new Date();
console.log(`[StepF-ICN] START: ${start.toISOString()}`);

// Part 1: ICN Enrichment Validation (validates existing projects against ICN API)
try {
  console.log(`[StepF-ICN] Running ICN Validation (icnValidateAllProjects)...`);
  const { validateAllProjects: icnValidateAllProjects } = await import("../server/icnEnrichment.ts");
  const validationResult = await icnValidateAllProjects();
  console.log(`[StepF-ICN] ICN Validation complete: ${JSON.stringify(validationResult, null, 2)}`);
} catch (err) {
  console.error(`[StepF-ICN] ICN Validation FAILED: ${err.message}`);
  console.error(err.stack);
}

// Part 2: ICN Legacy Scraper (scrapes ICN for new projects)
try {
  console.log(`[StepF-ICN] Running ICN Legacy Scraper (runIcnScraper)...`);
  const { runIcnScraper } = await import("../server/icnScraper.ts");
  const scrapeResult = await runIcnScraper();
  console.log(`[StepF-ICN] ICN Scraper complete: ${JSON.stringify(scrapeResult, null, 2)}`);
} catch (err) {
  console.error(`[StepF-ICN] ICN Scraper FAILED: ${err.message}`);
  console.error(err.stack);
}

const end = new Date();
console.log(`[StepF-ICN] FINISH: ${end.toISOString()}`);
console.log(`[StepF-ICN] Total Duration: ${((end - start) / 1000).toFixed(1)}s`);

process.exit(0);
