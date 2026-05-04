import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

const conn = await createConnection(process.env.DATABASE_URL);

// Get last 10 pipeline runs with all fields
const [runs] = await conn.execute(
  `SELECT id, runType, status, triggeredBy, startedAt, completedAt, 
   currentStep, lastProgressAt, lastActivityNote,
   feedsFetched, articlesIngested, articlesExtracted, projectsCreated, contactsEnriched,
   errors
   FROM pipelineRuns 
   ORDER BY startedAt DESC 
   LIMIT 10`
);

console.log("\n=== LAST 10 PIPELINE RUNS ===\n");
for (const run of runs) {
  const startedAt = run.startedAt ? new Date(run.startedAt) : null;
  const completedAt = run.completedAt ? new Date(run.completedAt) : null;
  const lastProgressAt = run.lastProgressAt ? new Date(run.lastProgressAt) : null;
  const now = new Date();
  
  const durationMin = startedAt && completedAt 
    ? Math.round((completedAt - startedAt) / 60000) 
    : startedAt 
      ? Math.round((now - startedAt) / 60000) + " (still running)"
      : "unknown";
  
  const lastProgressAgo = lastProgressAt 
    ? Math.round((now - lastProgressAt) / 60000) + " min ago"
    : "never";

  console.log(`Run #${run.id}`);
  console.log(`  Status:          ${run.status}`);
  console.log(`  Triggered by:    ${run.triggeredBy}`);
  console.log(`  Started:         ${startedAt?.toISOString() ?? "unknown"}`);
  console.log(`  Completed:       ${completedAt?.toISOString() ?? "(not completed)"}`);
  console.log(`  Duration:        ${durationMin} min`);
  console.log(`  Current step:    ${run.currentStep ?? "(none)"}`);
  console.log(`  Last progress:   ${lastProgressAgo}`);
  console.log(`  Last activity:   ${run.lastActivityNote ?? "(none)"}`);
  console.log(`  Feeds fetched:   ${run.feedsFetched ?? 0}`);
  console.log(`  Articles:        ${run.articlesIngested ?? 0} ingested, ${run.articlesExtracted ?? 0} extracted`);
  console.log(`  Projects:        ${run.projectsCreated ?? 0} created`);
  console.log(`  Contacts:        ${run.contactsEnriched ?? 0} enriched`);
  
  if (run.errors) {
    let errs;
    try { errs = JSON.parse(run.errors); } catch { errs = [run.errors]; }
    if (Array.isArray(errs) && errs.length > 0) {
      console.log(`  Errors:`);
      for (const e of errs.slice(0, 3)) {
        console.log(`    - ${e}`);
      }
    }
  }
  console.log();
}

// Check recent raw articles to see if pipeline is actually doing anything
const [articles] = await conn.execute(
  `SELECT COUNT(*) as cnt, MIN(createdAt) as oldest, MAX(createdAt) as newest 
   FROM rawArticles 
   WHERE createdAt > DATE_SUB(NOW(), INTERVAL 6 HOUR)`
);
console.log(`\n=== RAW ARTICLES (last 6h) ===`);
console.log(`  Count: ${articles[0].cnt}`);
console.log(`  Oldest: ${articles[0].oldest}`);
console.log(`  Newest: ${articles[0].newest}`);

// Check recent projects
const [projects] = await conn.execute(
  `SELECT COUNT(*) as cnt, MAX(createdAt) as newest 
   FROM projects 
   WHERE createdAt > DATE_SUB(NOW(), INTERVAL 6 HOUR)`
);
console.log(`\n=== PROJECTS CREATED (last 6h) ===`);
console.log(`  Count: ${projects[0].cnt}`);
console.log(`  Newest: ${projects[0].newest}`);

await conn.end();
