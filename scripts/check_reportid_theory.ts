import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  
  // Check if 660001 and 690001 are pipeline run IDs
  const [runs]: any = await conn.execute(
    "SELECT id, status, startedAt FROM pipelineRuns WHERE id IN (660001, 690001, 630001, 540001)"
  );
  console.log("Pipeline runs matching TendersWA reportIds:");
  runs.forEach((r: any) => console.log(`  id=${r.id} status=${r.status} started=${r.startedAt}`));
  
  // Check if those same IDs are also reports
  const [reps]: any = await conn.execute(
    "SELECT id, weekEnding FROM reports WHERE id IN (660001, 690001, 630001, 540001)"
  );
  console.log("\nReports matching those IDs:");
  reps.forEach((r: any) => console.log(`  id=${r.id} weekEnding=${r.weekEnding}`));
  
  // Count all non-suppressed projects regardless of reportId
  const [allActive]: any = await conn.execute(
    "SELECT COUNT(*) as cnt FROM projects WHERE (suppressed = 0 OR suppressed IS NULL)"
  );
  console.log(`\nTotal non-suppressed projects (all reports): ${allActive[0].cnt}`);
  
  // Count projects with actionTier
  const [withTier]: any = await conn.execute(
    "SELECT COUNT(*) as cnt FROM projects WHERE actionTier IS NOT NULL AND (suppressed = 0 OR suppressed IS NULL)"
  );
  console.log(`Non-suppressed with actionTier: ${withTier[0].cnt}`);
  
  // Check the digest code path — read how getProjectsByReportId works
  // For now, check what the digest would see with the latest report
  const [latestReport]: any = await conn.execute(
    "SELECT id, weekEnding FROM reports ORDER BY id DESC LIMIT 1"
  );
  console.log(`\nLatest report: id=${latestReport[0].id} weekEnding=${latestReport[0].weekEnding}`);
  
  const [projectsInLatest]: any = await conn.execute(
    "SELECT COUNT(*) as cnt FROM projects WHERE reportId = ?", [latestReport[0].id]
  );
  console.log(`Projects in latest report: ${projectsInLatest[0].cnt}`);
  
  // Check the TendersWA scraper — does it use runId as reportId?
  // Look at projects with reportId = 660001 (a known pipeline run ID)
  const [tendersWA660]: any = await conn.execute(
    "SELECT COUNT(*) as cnt, MIN(createdAt) as earliest, MAX(createdAt) as latest FROM projects WHERE reportId = 660001"
  );
  console.log(`\nProjects with reportId=660001: ${tendersWA660[0].cnt} (earliest: ${tendersWA660[0].earliest}, latest: ${tendersWA660[0].latest})`);
  
  // Check if 660001 exists in reports table
  const [report660]: any = await conn.execute(
    "SELECT id FROM reports WHERE id = 660001"
  );
  console.log(`Report 660001 exists in reports table: ${report660.length > 0}`);
  
  // Check if 660001 exists in pipelineRuns table
  const [run660]: any = await conn.execute(
    "SELECT id, status FROM pipelineRuns WHERE id = 660001"
  );
  console.log(`Pipeline run 660001 exists: ${run660.length > 0} ${run660.length > 0 ? `status=${run660[0].status}` : ''}`);
  
  // Now check how the digest actually queries — read the emailDigest code
  // For now, check if the digest uses getLatestReport or something else
  // Let's check what the thisWeekService uses
  const [allReportIds]: any = await conn.execute(
    "SELECT DISTINCT reportId FROM projects ORDER BY reportId DESC LIMIT 15"
  );
  console.log("\nAll distinct reportIds used by projects:");
  allReportIds.forEach((r: any) => console.log(`  ${r.reportId}`));
  
  await conn.end();
}

main().catch(err => { console.error(err); process.exit(1); });
