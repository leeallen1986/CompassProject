import { getDb } from '../server/db';
import { pipelineRuns } from '../drizzle/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) { console.log('No DB'); process.exit(1); }
  const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, 690001));
  if (!run) { console.log('Run 690001 not found'); process.exit(1); }
  console.log('Run 690001:');
  console.log('  status:', run.status);
  console.log('  triggeredBy:', run.triggeredBy);
  console.log('  durationMs:', run.durationMs);
  console.log('  feedsFetched:', run.feedsFetched);
  console.log('  articlesIngested:', run.articlesIngested);
  console.log('  articlesExtracted:', run.articlesExtracted);
  console.log('  projectsCreated:', run.projectsCreated);
  console.log('  contactsEnriched:', run.contactsEnriched);
  console.log('  apolloCreditsUsed:', run.apolloCreditsUsed);
  console.log('  completedAt:', run.completedAt);
  console.log('  errors:', JSON.stringify(run.errors));
  process.exit(0);
}
main();
