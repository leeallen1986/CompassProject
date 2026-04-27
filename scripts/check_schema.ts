import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.log("No DB"); return; }
  
  // Get actual DB columns
  const cols = await db.execute(sql`SHOW COLUMNS FROM projects`) as any;
  const dbCols = cols[0].map((c: any) => c.Field);
  console.log("DB projects columns:", dbCols.join(", "));
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
