import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }
  
  const result = await db.execute(sql`SELECT id, name FROM projects WHERE projectState = 'WA' AND lifecycleStatus = 'active' AND suppressed = 0 LIMIT 2`);
  console.log("type:", typeof result);
  console.log("isArray:", Array.isArray(result));
  console.log("keys:", Object.keys(result));
  console.log("result[0]:", result[0]);
  console.log("result[1]:", result[1]);
  
  // Check if it's [rows, fields]
  if (Array.isArray(result) && result.length >= 1) {
    console.log("first element type:", typeof result[0]);
    console.log("first element isArray:", Array.isArray(result[0]));
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
