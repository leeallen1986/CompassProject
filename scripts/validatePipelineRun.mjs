/**
 * Pipeline Run Validation Script (corrected column names)
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  console.log('=== Pipeline Run Validation ===\n');

  // Get last 10 pipeline runs with correct column names
  const [runs] = await conn.execute(`
    SELECT id, status, triggeredBy, startedAt, completedAt,
           projectsCreated, projectsDuplicate, contactsEnriched,
           articlesExtracted, errors,
           TIMESTAMPDIFF(MINUTE, startedAt, completedAt) AS durationMin
    FROM pipelineRuns
    ORDER BY id DESC
    LIMIT 10
  `);

  console.log('Last 10 pipeline runs:');
  console.log('─'.repeat(110));
  runs.forEach(r => {
    const dur = r.durationMin !== null ? `${r.durationMin}min` : 'running/unknown';
    const errSnip = r.errors ? ` | ERR: ${String(r.errors).slice(0, 50)}` : '';
    console.log(
      `[${r.id}] ${(r.status || '').padEnd(12)} | ${(r.triggeredBy || 'unknown').padEnd(22)} | ` +
      `started=${r.startedAt?.toISOString().slice(0,16)} | dur=${dur.padEnd(8)} | ` +
      `created=${r.projectsCreated ?? 0} enriched=${r.contactsEnriched ?? 0}${errSnip}`
    );
  });

  // Find last automatic run
  const lastAutoRun = runs.find(r => r.triggeredBy === 'scheduler' || r.triggeredBy === 'automatic');
  const lastSuccessfulRun = runs.find(r => r.status === 'completed');
  const lastAutoSuccessful = runs.find(r =>
    (r.triggeredBy === 'scheduler' || r.triggeredBy === 'automatic') && r.status === 'completed'
  );

  console.log('\n=== Key Signals ===');
  if (lastAutoRun) {
    const dur = lastAutoRun.durationMin !== null ? `${lastAutoRun.durationMin}min` : 'unknown';
    console.log(`Last automatic run:        [${lastAutoRun.id}] ${lastAutoRun.status} | dur=${dur} | enriched=${lastAutoRun.contactsEnriched ?? 0}`);
    if (lastAutoRun.status === 'failed' && lastAutoRun.errors) {
      const errStr = String(lastAutoRun.errors);
      const isTimeout = errStr.toLowerCase().includes('timeout') || errStr.toLowerCase().includes('timed out');
      console.log(`  → Timeout? ${isTimeout ? 'YES' : 'NO'} | Error: ${errStr.slice(0, 120)}`);
    }
  } else {
    console.log('Last automatic run:        none found');
  }

  if (lastAutoSuccessful) {
    const dur = lastAutoSuccessful.durationMin !== null ? `${lastAutoSuccessful.durationMin}min` : 'unknown';
    console.log(`Last successful auto run:  [${lastAutoSuccessful.id}] ${lastAutoSuccessful.triggeredBy} | dur=${dur} | enriched=${lastAutoSuccessful.contactsEnriched ?? 0}`);
  } else {
    console.log('Last successful auto run:  none found');
  }

  if (lastSuccessfulRun) {
    const dur = lastSuccessfulRun.durationMin !== null ? `${lastSuccessfulRun.durationMin}min` : 'unknown';
    console.log(`Last successful run (any): [${lastSuccessfulRun.id}] ${lastSuccessfulRun.triggeredBy} | dur=${dur} | enriched=${lastSuccessfulRun.contactsEnriched ?? 0}`);
  }

  // Enrichment batch validation — check if recent runs enriched ≤ 200 contacts
  console.log('\n=== Enrichment Batch Validation ===');
  const enrichedRuns = runs.filter(r => r.contactsEnriched !== null && r.contactsEnriched > 0);
  if (enrichedRuns.length > 0) {
    enrichedRuns.forEach(r => {
      const batchOk = r.contactsEnriched <= 200;
      console.log(`  [${r.id}] ${r.triggeredBy} | enriched=${r.contactsEnriched} | ${batchOk ? '✓ ≤200' : '⚠ >200'}`);
    });
  } else {
    console.log('  No enrichment activity in last 10 runs');
  }

  // Check the steps JSON column if available
  const lastRun = runs[0];
  if (lastRun && lastRun.steps) {
    try {
      const steps = typeof lastRun.steps === 'string' ? JSON.parse(lastRun.steps) : lastRun.steps;
      if (Array.isArray(steps) && steps.length > 0) {
        console.log(`\nSteps for run [${lastRun.id}]:`);
        steps.forEach(s => {
          console.log(`  ${(s.name || s.step || '').padEnd(30)} | ${(s.status || '').padEnd(10)} | items=${s.items ?? s.count ?? 0}`);
        });
      }
    } catch {
      // steps not JSON parseable
    }
  }

  await conn.end();
}

main().catch(err => {
  console.error('Validation failed:', err);
  process.exit(1);
});
