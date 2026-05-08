/**
 * Trigger script — fires the daily pipeline with triggeredBy="scheduled-task"
 * to simulate what the external Manus scheduled task would do.
 * 
 * This connects to the same production database as the deployed app.
 * The run will appear in Run History immediately.
 */
import 'dotenv/config';
import { runDailyPipeline } from '../server/dailyPipeline';

const TRIGGERED_BY = 'scheduled-task';

async function main() {
  console.log(`[TriggerScript] Launching pipeline with triggeredBy="${TRIGGERED_BY}"`);
  console.log(`[TriggerScript] This will appear in Run History as a scheduled-task run`);
  console.log(`[TriggerScript] Started at: ${new Date().toISOString()}`);

  try {
    const result = await runDailyPipeline(TRIGGERED_BY);
    console.log(`[TriggerScript] Pipeline completed successfully`);
    console.log(`[TriggerScript] Extracted: ${result?.extraction?.extracted ?? 0}`);
    console.log(`[TriggerScript] Enriched: ${result?.enrichment?.enriched ?? 0}`);
    console.log(`[TriggerScript] Duration: ${Math.round((result?.duration || 0) / 1000)}s`);
    process.exit(0);
  } catch (err) {
    console.error(`[TriggerScript] Pipeline failed:`, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
