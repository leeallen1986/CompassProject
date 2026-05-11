// Step 1: Harvest RSS Feeds — manual recovery run
import { register } from "tsx/esm/api";
const unregister = register();

const start = new Date();
console.log(`[Step1] START: ${start.toISOString()}`);

try {
  const { harvestAllFeeds } = await import("../server/rssHarvester.ts");
  const result = await harvestAllFeeds();
  const end = new Date();
  console.log(`[Step1] FINISH: ${end.toISOString()}`);
  console.log(`[Step1] Duration: ${((end - start) / 1000).toFixed(1)}s`);
  console.log(`[Step1] Status: SUCCESS`);
  console.log(`[Step1] Total sources: ${result.totalSources}`);
  console.log(`[Step1] New articles: ${result.totalNew}`);
  console.log(`[Step1] Duplicates: ${result.totalDuplicates}`);
  console.log(`[Step1] Errors: ${result.totalErrors}`);
  if (result.errors && result.errors.length > 0) {
    console.log(`[Step1] Error details:`);
    result.errors.slice(0, 5).forEach(e => console.log(`  - ${e}`));
  }
} catch (err) {
  const end = new Date();
  console.log(`[Step1] FINISH: ${end.toISOString()}`);
  console.log(`[Step1] Status: FAILED`);
  console.log(`[Step1] Error: ${err.message}`);
  console.log(`[Step1] Stack: ${err.stack}`);
}

process.exit(0);
