/**
 * Score all remaining unscored projects in batches.
 * Calls the bulk scoring function directly (bypasses tRPC auth).
 */
import 'dotenv/config';

// We need to import the scoring functions directly
import { getUnscoredProjectIds, scoreAndSaveProjects } from './server/businessLineScoring.ts';

const BATCH_SIZE = 50;
let totalScored = 0;
let totalFailed = 0;
let batchNum = 0;

async function runBatch() {
  const unscoredIds = await getUnscoredProjectIds(BATCH_SIZE);
  if (unscoredIds.length === 0) {
    console.log(`\n✅ All done! Total scored: ${totalScored}, Total failed: ${totalFailed}`);
    process.exit(0);
  }

  batchNum++;
  console.log(`\n📦 Batch ${batchNum}: Scoring ${unscoredIds.length} projects...`);
  
  const result = await scoreAndSaveProjects(unscoredIds, {
    onProgress: (done, total) => {
      if (done % 10 === 0 || done === total) {
        console.log(`  Progress: ${done}/${total} (batch ${batchNum})`);
      }
    }
  });

  totalScored += result.scored;
  totalFailed += result.failed;
  
  console.log(`  Batch ${batchNum} complete: ${result.scored} scored, ${result.failed} failed`);
  if (result.errors.length > 0) {
    console.log(`  Errors: ${result.errors.slice(0, 3).join('; ')}`);
  }
  console.log(`  Running total: ${totalScored} scored, ${totalFailed} failed`);

  // Continue with next batch
  await runBatch();
}

console.log('🚀 Starting bulk scoring of all unscored projects...');
const startTime = Date.now();

runBatch().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
}).finally(() => {
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n⏱️ Total time: ${elapsed} minutes`);
});
