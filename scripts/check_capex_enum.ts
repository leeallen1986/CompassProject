import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.log("No DB"); return; }
  
  const r = await db.execute(sql`SHOW COLUMNS FROM projects LIKE 'capexGrade'`) as any;
  console.log("capexGrade column:", JSON.stringify(r[0], null, 2));
  
  // Also check what values are actually in the DB for capexGrade
  const vals = await db.execute(sql`SELECT DISTINCT capexGrade, COUNT(*) as cnt FROM projects GROUP BY capexGrade`) as any;
  console.log("capexGrade values in DB:", JSON.stringify(vals[0], null, 2));
  
  // Check the error more carefully - try to insert a test project with capexGrade='A'
  // Actually let's check what the DB enum type says
  const cols = await db.execute(sql`SHOW CREATE TABLE projects`) as any;
  const createTable = cols[0][0]['Create Table'] as string;
  const capexLine = createTable.split('\n').find(l => l.includes('capexGrade'));
  console.log("\ncapexGrade definition:", capexLine);
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
