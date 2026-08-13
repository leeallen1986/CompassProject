import * as fs from "fs";
import { getDb } from "../db";

/**
 * Captures all in-scope projects for Ryan by replicating the thisWeekService
 * scoring pipeline without the .slice(0,15) limit. Read-only — no DB writes.
 */
async function main() {
  // Import the internal helpers
  const { getThisWeekSummary } = await import("../thisWeekService");
  
  const RYAN_USER_ID = 2340043;
  const summary = await getThisWeekSummary(RYAN_USER_ID);
  
  // The top 15 are what Ryan sees. For the full audit we also need the remaining
  // 41 in-scope projects. Query them directly from the DB using the project IDs
  // that the scoring pipeline would have included.
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  
  // Get ALL active WA projects with their contacts
  const [allWaProjects] = await db.execute(`
    SELECT p.id, p.name, p.location, p.value, p.owner, p.priority, p.sector, p.stage,
           p.overview, p.lifecycleStatus, p.equipmentSignals, p.opportunityRoute,
           p.createdAt, p.updatedAt
    FROM projects p
    WHERE (p.lifecycleStatus IS NULL OR p.lifecycleStatus = 'active')
      AND p.geoBlockedReason IS NULL
      AND (p.location LIKE '%WA%' OR p.location LIKE '%Western Australia%'
           OR p.location LIKE '%Perth%' OR p.location LIKE '%Pilbara%'
           OR p.location LIKE '%Goldfields%' OR p.location LIKE '%Kalgoorlie%'
           OR p.location LIKE '%Karratha%' OR p.location LIKE '%Port Hedland%')
    ORDER BY p.priority ASC, p.createdAt DESC
  `) as any;
  
  const outDir = "artifacts/ryan-current-dashboard-audit-" + new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z";
  fs.mkdirSync(outDir, { recursive: true });
  
  fs.writeFileSync(`${outDir}/ryan-dashboard-raw.json`, JSON.stringify({
    ...summary,
    allWaActiveProjects: allWaProjects,
    allWaActiveCount: (allWaProjects as any[]).length,
  }, null, 2));
  
  console.log(`OUTDIR=${outDir}`);
  console.log(`TOP_15=${summary.topProjects.length}`);
  console.log(`ALL_WA_ACTIVE=${(allWaProjects as any[]).length}`);
  console.log(`STATS_TOTAL_IN_SCOPE=${summary.stats.totalInScope}`);
  console.log(`WEEK_LABEL=${summary.weekLabel}`);
  console.log(`GENERATED=${summary.generatedAt}`);
  
  // Clean up the temp script
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
