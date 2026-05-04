import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

const db = await createConnection(process.env.DATABASE_URL);

// Get the 5 most recent pipeline runs
const [runs] = await db.execute(`
  SELECT 
    id, status, triggeredBy, startedAt, completedAt, durationMs,
    currentStep, lastProgressAt, lastActivityNote,
    articlesIngested, projectsCreated, contactsEnriched,
    errors,
    TIMESTAMPDIFF(MINUTE, startedAt, NOW()) as minutesAgo,
    TIMESTAMPDIFF(MINUTE, lastProgressAt, NOW()) as minutesSinceProgress
  FROM pipelineRuns 
  ORDER BY startedAt DESC 
  LIMIT 5
`);

console.log("\n=== PIPELINE RUN HISTORY (last 5) ===\n");
for (const run of runs) {
  const progressAge = run.minutesSinceProgress != null ? `${run.minutesSinceProgress}m ago` : "never";
  const runningState = run.status === "running"
    ? (run.minutesSinceProgress > 240 ? "ORPHANED" : run.minutesSinceProgress > 45 ? "STALLED" : "ACTIVE")
    : run.status.toUpperCase();

  console.log(`Run #${run.id}`);
  console.log(`  Status:         ${run.status} → ${runningState}`);
  console.log(`  Started:        ${run.startedAt} (${run.minutesAgo}m ago)`);  
  console.log(`  Triggered by:   ${run.triggeredBy}`);
  console.log(`  Current step:   ${run.currentStep || "(none)"}`);
  console.log(`  Last progress:  ${progressAge}`);
  console.log(`  Activity note:  ${run.lastActivityNote || "(none)"}`);
  console.log(`  Articles:       ${run.articlesIngested ?? 0}`);
  console.log(`  Projects:       ${run.projectsCreated ?? 0}`);
  console.log(`  Contacts:       ${run.contactsEnriched ?? 0}`);
  if (run.errors) console.log(`  ERRORS:         ${run.errors}`);
  if (run.completedAt) console.log(`  Duration:       ${Math.round((run.durationMs || 0) / 60000)}m`);
  console.log();
}

// Also check recent raw articles to see if harvesting is happening
const [recentArticles] = await db.execute(`
  SELECT COUNT(*) as count, MAX(createdAt) as latest
  FROM rawArticles
  WHERE createdAt > DATE_SUB(NOW(), INTERVAL 4 HOUR)
`);
console.log(`=== RAW ARTICLES (last 4h): ${recentArticles[0].count} ingested, latest: ${recentArticles[0].latest} ===\n`);

// Check for any server errors in the last run
const [latestRun] = await db.execute(`
  SELECT id, status, errorMessage, steps
  FROM pipelineRuns 
  ORDER BY triggeredAt DESC 
  LIMIT 1
`);
if (latestRun[0]?.steps) {
  try {
    const steps = JSON.parse(latestRun[0].steps);
    const failedSteps = steps.filter(s => s.status === "failed");
    if (failedSteps.length > 0) {
      console.log("=== FAILED STEPS ===");
      for (const s of failedSteps) {
        console.log(`  ${s.name}: ${s.error}`);
      }
    }
  } catch {}
}

await db.end();
