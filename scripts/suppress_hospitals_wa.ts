import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

async function fix() {
  const db = await getDb();
  
  // Suppress hospital/health facility projects in WA - these are building fitouts, not PT-relevant
  await db.execute(sql`
    UPDATE projects
    SET suppressed = 1
    WHERE id IN (1200026, 990056, 810022)
      AND lifecycleStatus = 'active'
  `);
  console.log('Suppressed 3 hospital/health facility projects in WA');
  
  // Also suppress the 2 NULL-state NSW projects that could leak
  await db.execute(sql`
    UPDATE projects
    SET suppressed = 1
    WHERE id IN (660019, 480080)
      AND lifecycleStatus = 'active'
  `);
  console.log('Suppressed 2 NULL-state NSW projects');
  
  process.exit(0);
}

fix().catch(e => { console.error(e.message); process.exit(1); });
