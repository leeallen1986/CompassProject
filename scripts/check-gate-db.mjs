import { getDb } from '../server/db.ts';
import { repDigestGateResults } from '../drizzle/schema.ts';
import { desc } from 'drizzle-orm';

const db = await getDb();
if (!db) { console.log('No DB'); process.exit(0); }

const rows = await db.select().from(repDigestGateResults).orderBy(desc(repDigestGateResults.createdAt)).limit(20);
console.log(JSON.stringify(rows.map(r => ({
  userId: r.userId,
  decision: r.decision,
  blockers: r.blockers,
  createdAt: r.createdAt
})), null, 2));
process.exit(0);
