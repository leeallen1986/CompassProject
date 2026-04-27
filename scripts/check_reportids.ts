import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  
  // What reportIds do projects use?
  const [reportDist]: any = await conn.execute(
    "SELECT reportId, COUNT(*) as cnt FROM projects GROUP BY reportId ORDER BY cnt DESC LIMIT 10"
  );
  console.log("Project reportId distribution:");
  reportDist.forEach((r: any) => console.log(`  reportId=${r.reportId}: ${r.cnt} projects`));
  
  // What reports exist?
  const [reports]: any = await conn.execute(
    "SELECT id, weekEnding, createdAt FROM reports ORDER BY id DESC LIMIT 5"
  );
  console.log("\nReports:");
  reports.forEach((r: any) => console.log(`  id=${r.id} weekEnding=${r.weekEnding} created=${r.createdAt}`));
  
  // TendersWA projects this week — what reportId do they have?
  const [tendersWA]: any = await conn.execute(
    `SELECT reportId, COUNT(*) as cnt FROM projects WHERE (projectKey LIKE 'wa-tender-%' OR projectKey LIKE 'tenders-wa-%' OR projectKey LIKE 'WAT-%') AND createdAt >= '2026-04-20' GROUP BY reportId`
  );
  console.log("\nTendersWA this week by reportId:");
  tendersWA.forEach((r: any) => console.log(`  reportId=${r.reportId}: ${r.cnt}`));
  
  // Check total projects by reportId for the two most recent reports
  if (reportDist.length >= 2) {
    const top2 = reportDist.slice(0, 2);
    for (const r of top2) {
      const [details]: any = await conn.execute(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN suppressed = 1 THEN 1 ELSE 0 END) as suppressed,
          SUM(CASE WHEN actionTier IS NOT NULL THEN 1 ELSE 0 END) as hasTier,
          SUM(CASE WHEN priority = 'hot' THEN 1 ELSE 0 END) as hot,
          MIN(createdAt) as earliest,
          MAX(createdAt) as latest
        FROM projects WHERE reportId = ?`,
        [r.reportId]
      );
      console.log(`\nReport ${r.reportId} details: ${JSON.stringify(details[0])}`);
    }
  }
  
  // Check if report 600001 was created by the pipeline or manually
  const [report600001]: any = await conn.execute(
    "SELECT * FROM reports WHERE id = 600001"
  );
  if (report600001.length > 0) {
    console.log("\nReport 600001 details:", JSON.stringify(report600001[0]));
  }
  
  await conn.end();
}

main().catch(err => { console.error(err); process.exit(1); });
