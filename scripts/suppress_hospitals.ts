import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function fix() {
  const db = await getDb();
  // Suppress hospital projects — these are building fitouts, not PT-relevant
  const result = await db.execute(sql`
    UPDATE projects
    SET suppressed = 1, lifecycleStatus = 'archived'
    WHERE lifecycleStatus = 'active'
      AND (suppressed = 0 OR suppressed IS NULL)
      AND (
        name LIKE '%Hospital%'
        OR name LIKE '%Health Service%'
        OR name LIKE '%Medical Centre%'
        OR name LIKE '%Clinic%'
      )
      AND name NOT LIKE '%Water%'
      AND name NOT LIKE '%Pipeline%'
      AND name NOT LIKE '%Power%'
  `);
  console.log("Suppressed hospital/health projects:", (result as any)[0].affectedRows);
  process.exit(0);
}
fix().catch(e => { console.error(e.message); process.exit(1); });
