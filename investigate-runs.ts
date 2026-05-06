import 'dotenv/config';
import { getDb } from './server/db';
import { pipelineRuns } from './drizzle/schema';
import { eq, desc } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) { console.error('No DB'); process.exit(1); }

  // Find runs #930001 and #960001 — these IDs may be sequential DB IDs or display IDs
  // First check recent runs to understand the ID scheme
  const recentRuns = await db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.id)).limit(20);
  console.log('\n=== Recent 20 pipeline runs ===');
  for (const r of recentRuns) {
    console.log(`  ID=${r.id} | triggeredBy=${r.triggeredBy} | status=${r.status} | startedAt=${r.startedAt?.toISOString()} | completedAt=${r.completedAt?.toISOString()} | error=${r.error?.slice(0,120)}`);
  }

  // Find the two failing runs by triggeredBy=scheduler-dev
  const devRuns = await db.select().from(pipelineRuns)
    .where(eq(pipelineRuns.triggeredBy, 'scheduler-dev'))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(10);
  console.log('\n=== All scheduler-dev runs ===');
  for (const r of devRuns) {
    console.log(`  ID=${r.id} | status=${r.status} | startedAt=${r.startedAt?.toISOString()} | completedAt=${r.completedAt?.toISOString()} | error=${r.error?.slice(0,200)}`);
  }

  // Get step logs for the two most recent scheduler-dev runs
  if (devRuns.length > 0) {
    for (const run of devRuns.slice(0, 2)) {
      console.log(`\n=== Step logs for run ID=${run.id} (${run.triggeredBy}, ${run.status}) ===`);
      // Steps are stored in the JSON steps column on the run itself
      const fullRun = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, run.id)).limit(1);
      const runData = fullRun[0];
      if (!runData) { console.log('  (run not found)'); continue; }
      console.log(`  currentStep=${runData.currentStep} | lastActivityNote=${runData.lastActivityNote}`);
      console.log(`  feedsFetched=${runData.feedsFetched} | articlesIngested=${runData.articlesIngested} | projectsCreated=${runData.projectsCreated}`);
      console.log(`  contactsEnriched=${runData.contactsEnriched} | apolloCreditsUsed=${runData.apolloCreditsUsed}`);
      console.log(`  error=${runData.errors ? JSON.stringify(runData.errors).slice(0,300) : 'none'}`);
      if (runData.steps && Array.isArray(runData.steps)) {
        console.log(`  Steps (${runData.steps.length}):`);
        for (const s of runData.steps as Array<{name:string;status:string;startedAt?:string;completedAt?:string;error?:string}>) {
          console.log(`    [${s.status}] ${s.name} | start=${s.startedAt?.slice(0,19)} | end=${s.completedAt?.slice(0,19)} | err=${s.error?.slice(0,120) ?? ''}`);
        }
      } else {
        console.log('  (no steps JSON)');
      }
    }
  }

  // Also check all scheduled-task runs for comparison
  const scheduledRuns = await db.select().from(pipelineRuns)
    .where(eq(pipelineRuns.triggeredBy, 'scheduled-task'))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(5);
  console.log('\n=== Recent scheduled-task runs ===');
  for (const r of scheduledRuns) {
    console.log(`  ID=${r.id} | status=${r.status} | startedAt=${r.startedAt?.toISOString()} | completedAt=${r.completedAt?.toISOString()} | error=${r.error?.slice(0,120)}`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
