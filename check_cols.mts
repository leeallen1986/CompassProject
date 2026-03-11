import { getDb } from "./server/db.js";
import { sql } from "drizzle-orm";
(async () => {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }
  const cols = await db.execute(sql`SHOW COLUMNS FROM projects`);
  for (const c of cols as any[]) console.log(c.Field);
  process.exit(0);
})();
