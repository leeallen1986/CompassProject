import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load env from system (DATABASE_URL is injected by platform)

const conn = await createConnection(process.env.DATABASE_URL);

// Get the current running run in detail
const [rows] = await conn.execute(`SELECT * FROM pipelineRuns WHERE status = 'running' ORDER BY startedAt DESC LIMIT 1`);

if (rows.length === 0) {
  console.log('No running pipeline found.');
} else {
  const run = rows[0];
  const startedAt = new Date(run.startedAt);
  const ageMin = Math.round((Date.now() - startedAt.getTime()) / 60000);
  
  console.log(`\n=== CURRENT RUNNING PIPELINE (Run #${run.id}) ===`);
  console.log(`Started:      ${run.startedAt} (${ageMin} minutes ago)`);
  console.log(`Triggered by: ${run.triggeredBy}`);
  console.log(`Run type:     ${run.runType}`);
  console.log(`\nProgress so far:`);
  console.log(`  Feeds fetched:    ${run.feedsFetched ?? 0}`);
  console.log(`  Feed errors:      ${run.feedErrors ?? 0}`);
  console.log(`  Articles ingested:${run.articlesIngested ?? 0}`);
  console.log(`  Articles skipped: ${run.articlesSkippedKeyword ?? 0}`);
  console.log(`  Articles dupes:   ${run.articlesDuplicate ?? 0}`);
  console.log(`  Articles extracted:${run.articlesExtracted ?? 0}`);
  console.log(`  Projects created: ${run.projectsCreated ?? 0}`);
  console.log(`  Projects dupes:   ${run.projectsDuplicate ?? 0}`);
  console.log(`  Contacts enriched:${run.contactsEnriched ?? 0}`);
  console.log(`  Apollo credits:   ${run.apolloCreditsUsed ?? 0}`);
  
  if (run.steps) {
    const steps = typeof run.steps === 'string' ? JSON.parse(run.steps) : run.steps;
    if (Array.isArray(steps) && steps.length > 0) {
      console.log(`\nCompleted steps (${steps.length}):`);
      for (const s of steps) {
        console.log(`  - ${JSON.stringify(s).substring(0, 120)}`);
      }
    } else {
      console.log(`\nSteps: none recorded yet`);
    }
  }
  
  if (run.errors) {
    const errs = typeof run.errors === 'string' ? JSON.parse(run.errors) : run.errors;
    console.log(`\nErrors so far: ${JSON.stringify(errs).substring(0, 500)}`);
  }
  
  if (run.sourceStats) {
    const ss = typeof run.sourceStats === 'string' ? JSON.parse(run.sourceStats) : run.sourceStats;
    console.log(`\nSource stats: ${JSON.stringify(ss).substring(0, 500)}`);
  }
}

// Also check how many raw articles were ingested in the last 3 hours
const [recentArticles] = await conn.execute(`
  SELECT COUNT(*) as count FROM rawArticles WHERE createdAt > DATE_SUB(NOW(), INTERVAL 3 HOUR)
`);
console.log(`\nRaw articles ingested in last 3 hours: ${recentArticles[0].count}`);

// Check if any projects were created in last 3 hours
const [recentProjects] = await conn.execute(`
  SELECT COUNT(*) as count FROM projects WHERE createdAt > DATE_SUB(NOW(), INTERVAL 3 HOUR)
`);
console.log(`Projects created in last 3 hours: ${recentProjects[0].count}`);

// Check total project count
const [totalProjects] = await conn.execute(`SELECT COUNT(*) as count FROM projects`);
console.log(`Total projects in DB: ${totalProjects[0].count}`);

await conn.end();
