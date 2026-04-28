/**
 * ICN Gateway Operational Health Audit
 */
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== ICN GATEWAY OPERATIONAL HEALTH AUDIT ===\n");

// 1. Pipeline execution history — ICN-specific columns
console.log("--- 1. PIPELINE EXECUTION HISTORY ---");
const [pipelineRuns] = await conn.execute(`
  SELECT id, status, startedAt, completedAt, icnProjects,
    JSON_EXTRACT(errors, '$') as errorsJson,
    JSON_EXTRACT(steps, '$') as stepsJson
  FROM pipelineRuns
  ORDER BY startedAt DESC
  LIMIT 20
`);

console.log(`Last ${pipelineRuns.length} pipeline runs with ICN data:`);
let icnRanCount = 0, icnSkippedCount = 0, icnFailedCount = 0;
for (const run of pipelineRuns) {
  let icnScrapeStep = null, icnValidStep = null;
  try {
    const steps = JSON.parse(run.stepsJson || '[]');
    for (const s of steps) {
      if (s.name && s.name.toLowerCase().includes('icn gateway')) icnScrapeStep = s;
      if (s.name && s.name.toLowerCase().includes('icn validation')) icnValidStep = s;
    }
  } catch {}
  
  const scrapeStatus = icnScrapeStep ? icnScrapeStep.status : 'not_in_steps';
  const validStatus = icnValidStep ? icnValidStep.status : 'not_in_steps';
  
  if (scrapeStatus === 'completed') icnRanCount++;
  else if (scrapeStatus === 'skipped') icnSkippedCount++;
  else if (scrapeStatus === 'failed') icnFailedCount++;
  
  console.log(`  Run #${run.id} | ${run.status} | ${run.startedAt} → ${run.completedAt || 'running'} | icnProjects=${run.icnProjects}`);
  console.log(`    ICN Scrape: ${scrapeStatus} | ICN Validation: ${validStatus}`);
  if (icnScrapeStep && icnScrapeStep.error) console.log(`    Error: ${icnScrapeStep.error}`);
}
console.log(`\n  Summary: ICN ran=${icnRanCount}, skipped=${icnSkippedCount}, failed=${icnFailedCount}`);

// 2. sourceRuns check (may not exist)
console.log("\n--- 2. SOURCE RUN HISTORY ---");
try {
  const [sourceRuns] = await conn.execute(`
    SELECT * FROM sourceRuns WHERE sourceKey = 'icn_gateway' ORDER BY runAt DESC LIMIT 10
  `);
  if (sourceRuns.length === 0) {
    console.log("  NO sourceRuns records for icn_gateway");
  } else {
    for (const r of sourceRuns) {
      console.log(`  ${r.runAt} | success=${r.success} | items=${r.itemsFound} | error=${r.errorMessage || 'none'}`);
    }
  }
} catch (e) {
  console.log("  sourceRuns table not found:", e.message);
}

// 3. ICN projects in DB
console.log("\n--- 3. ICN PROJECTS IN DATABASE ---");
const [icnProjects] = await conn.execute(`
  SELECT id, name, location, priority, lifecycleStatus, 
    createdAt, updatedAt, lastActivityAt, geoBlockedReason,
    projectCountry, locationConfidence, stage, value, sector
  FROM projects
  WHERE JSON_SEARCH(sources, 'one', 'ICN Gateway', NULL, '$[*].label') IS NOT NULL
    OR projectKey LIKE 'icn-%'
  ORDER BY createdAt DESC
`);
console.log(`Total ICN-linked projects: ${icnProjects.length}`);

const now = Date.now();
const day30 = now - 30 * 24 * 60 * 60 * 1000;
const day60 = now - 60 * 24 * 60 * 60 * 1000;
const day90 = now - 90 * 24 * 60 * 60 * 1000;

let active = 0, stale = 0, suppressed = 0, geoBlocked = 0;
let last30 = 0, last60 = 0, last90 = 0;
let withWorkPackages = 0;

for (const p of icnProjects) {
  if (p.lifecycleStatus === 'active') active++;
  else if (p.lifecycleStatus === 'stale') stale++;
  else if (p.lifecycleStatus === 'suppressed') suppressed++;
  if (p.geoBlockedReason) geoBlocked++;
  const updated = new Date(p.updatedAt).getTime();
  if (updated > day30) last30++;
  if (updated > day60) last60++;
  if (updated > day90) last90++;
  if (p.stage && p.stage.toLowerCase().includes('work package')) withWorkPackages++;
}

console.log(`  Active: ${active} | Stale: ${stale} | Suppressed: ${suppressed} | Geo-blocked: ${geoBlocked}`);
console.log(`  Updated in last 30d: ${last30} | 60d: ${last60} | 90d: ${last90}`);
console.log(`  With work-package data in stage: ${withWorkPackages}`);

console.log("\n  Most recent 10 ICN projects:");
for (const p of icnProjects.slice(0, 10)) {
  console.log(`    #${p.id} | ${p.name.slice(0, 55)} | ${p.lifecycleStatus} | ${p.priority} | updated: ${p.updatedAt} | geo: ${p.geoBlockedReason || 'OK'}`);
}

// 4. Downstream drop-off
console.log("\n--- 4. DOWNSTREAM DROP-OFF ANALYSIS ---");

// Geo-blocked ICN projects
const geoBlockedProjects = icnProjects.filter(p => p.geoBlockedReason);
console.log(`  Geo-blocked: ${geoBlockedProjects.length}`);
for (const p of geoBlockedProjects) {
  console.log(`    #${p.id} | ${p.name.slice(0, 55)} | reason: ${p.geoBlockedReason} | conf: ${p.locationConfidence}`);
}

// ICN projects without business line scores
const [unscored] = await conn.execute(`
  SELECT p.id, p.name, p.lifecycleStatus
  FROM projects p
  LEFT JOIN projectBusinessLineScores s ON s.projectId = p.id
  WHERE (JSON_SEARCH(p.sources, 'one', 'ICN Gateway', NULL, '$[*].label') IS NOT NULL OR p.projectKey LIKE 'icn-%')
    AND s.projectId IS NULL
`);
console.log(`  ICN projects with NO business line scores: ${unscored.length}`);
for (const p of unscored.slice(0, 5)) {
  console.log(`    #${p.id} | ${p.name.slice(0, 55)} | ${p.lifecycleStatus}`);
}

// ICN projects with no contacts
const [noContacts] = await conn.execute(`
  SELECT p.id, p.name, p.lifecycleStatus
  FROM projects p
  LEFT JOIN contactProjects cp ON cp.projectId = p.id
  WHERE (JSON_SEARCH(p.sources, 'one', 'ICN Gateway', NULL, '$[*].label') IS NOT NULL OR p.projectKey LIKE 'icn-%')
    AND cp.projectId IS NULL
`);
console.log(`  ICN projects with NO contacts: ${noContacts.length}`);

// 5. Freshness analysis
console.log("\n--- 5. FRESHNESS FIELD ANALYSIS ---");
const [freshness] = await conn.execute(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN lastActivityAt IS NULL THEN 1 ELSE 0 END) as noActivity,
    SUM(CASE WHEN lastActivityAt < DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as activityOver30d,
    SUM(CASE WHEN lastActivityAt < DATE_SUB(NOW(), INTERVAL 60 DAY) THEN 1 ELSE 0 END) as activityOver60d,
    MIN(lastActivityAt) as oldestActivity,
    MAX(lastActivityAt) as newestActivity,
    MIN(createdAt) as oldestCreated,
    MAX(createdAt) as newestCreated
  FROM projects
  WHERE JSON_SEARCH(sources, 'one', 'ICN Gateway', NULL, '$[*].label') IS NOT NULL OR projectKey LIKE 'icn-%'
`);
const f = freshness[0];
console.log(`  Total: ${f.total} | No lastActivityAt: ${f.noActivity} | Activity >30d ago: ${f.activityOver30d} | >60d: ${f.activityOver60d}`);
console.log(`  Oldest activity: ${f.oldestActivity} | Newest activity: ${f.newestActivity}`);
console.log(`  Oldest created: ${f.oldestCreated} | Newest created: ${f.newestCreated}`);

// 6. Stale breakdown
console.log("\n--- 6. STALE STATUS BREAKDOWN ---");
const [staleCheck] = await conn.execute(`
  SELECT lifecycleStatus, COUNT(*) as cnt, 
    MIN(lastActivityAt) as minActivity, MAX(lastActivityAt) as maxActivity,
    MIN(updatedAt) as minUpdated, MAX(updatedAt) as maxUpdated
  FROM projects
  WHERE JSON_SEARCH(sources, 'one', 'ICN Gateway', NULL, '$[*].label') IS NOT NULL OR projectKey LIKE 'icn-%'
  GROUP BY lifecycleStatus
`);
for (const row of staleCheck) {
  console.log(`  ${row.lifecycleStatus}: ${row.cnt} | lastActivity: ${row.minActivity} → ${row.maxActivity} | updated: ${row.minUpdated} → ${row.maxUpdated}`);
}

// 7. Commercial usefulness
console.log("\n--- 7. COMMERCIAL USEFULNESS ---");
const [commercial] = await conn.execute(`
  SELECT 
    SUM(CASE WHEN stage LIKE '%work package%' THEN 1 ELSE 0 END) as withWorkPackageStage,
    SUM(CASE WHEN JSON_LENGTH(contractors) > 0 THEN 1 ELSE 0 END) as withContractors,
    SUM(CASE WHEN opportunityRoute IS NOT NULL AND opportunityRoute != '' THEN 1 ELSE 0 END) as withRoute,
    SUM(CASE WHEN priority = 'hot' THEN 1 ELSE 0 END) as hot,
    SUM(CASE WHEN priority = 'warm' THEN 1 ELSE 0 END) as warm,
    SUM(CASE WHEN priority = 'cold' THEN 1 ELSE 0 END) as cold,
    SUM(CASE WHEN value LIKE '%billion%' OR value LIKE '%million%' THEN 1 ELSE 0 END) as withValue
  FROM projects
  WHERE JSON_SEARCH(sources, 'one', 'ICN Gateway', NULL, '$[*].label') IS NOT NULL OR projectKey LIKE 'icn-%'
`);
const c = commercial[0];
console.log(`  Hot: ${c.hot} | Warm: ${c.warm} | Cold: ${c.cold}`);
console.log(`  With work-package stage: ${c.withWorkPackageStage} | With contractors: ${c.withContractors} | With route: ${c.withRoute} | With value: ${c.withValue}`);

// 8. ICN validation (enrichment) runs
console.log("\n--- 8. ICN ENRICHMENT MATCH STATS ---");
const [enriched] = await conn.execute(`
  SELECT 
    SUM(CASE WHEN JSON_SEARCH(sources, 'one', 'ICN Gateway', NULL, '$[*].label') IS NOT NULL THEN 1 ELSE 0 END) as withIcnSource,
    SUM(CASE WHEN stage LIKE '%open work packages%' THEN 1 ELSE 0 END) as withOpenWP
  FROM projects
  WHERE projectKey LIKE 'icn-%'
`);
console.log(`  ICN projects with ICN Gateway source: ${enriched[0].withIcnSource} | With open WP in stage: ${enriched[0].withOpenWP}`);

// 9. ICN scraper curated list vs DB
console.log("\n--- 9. CURATED LIST vs DB COVERAGE ---");
// The scraper has ~25 projects in ICN_PROJECTS
// Check how many are in DB
const [icnKeys] = await conn.execute(`
  SELECT projectKey, name, lifecycleStatus FROM projects WHERE projectKey LIKE 'icn-%' ORDER BY createdAt
`);
console.log(`  Projects with icn- prefix in DB: ${icnKeys.length}`);
for (const p of icnKeys) {
  console.log(`    ${p.projectKey.slice(0, 60)} | ${p.lifecycleStatus}`);
}

await conn.end();
console.log("\n=== AUDIT COMPLETE ===");
process.exit(0);
