import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.log("No DB"); return; }
  
  // Check reports table
  const reports = await db.execute(sql`SELECT id, weekEnding, generatedTime FROM reports ORDER BY id DESC LIMIT 5`) as any;
  console.log("Recent reports:", JSON.stringify(reports[0], null, 2));
  
  // Check if there's a report with id 570001
  const r570 = await db.execute(sql`SELECT id, weekEnding FROM reports WHERE id = 570001`) as any;
  console.log("Report 570001:", r570[0]);
  
  // Check max report ID
  const maxId = await db.execute(sql`SELECT MAX(id) as maxId FROM reports`) as any;
  console.log("Max report ID:", maxId[0][0].maxId);
  
  // Check max project ID  
  const maxProjId = await db.execute(sql`SELECT MAX(id) as maxId FROM projects`) as any;
  console.log("Max project ID:", maxProjId[0][0].maxId);
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
