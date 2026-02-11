import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

const db = drizzle(process.env.DATABASE_URL);

const [projRows] = await db.execute(sql`SELECT COUNT(*) as cnt FROM projects`);
const [contRows] = await db.execute(sql`SELECT COUNT(*) as cnt FROM contacts`);
const [rawRows] = await db.execute(sql`SELECT COUNT(*) as cnt FROM rawArticles`);
const [queuedRows] = await db.execute(sql`SELECT COUNT(*) as cnt FROM rawArticles WHERE status = 'queued'`);
const [rssRows] = await db.execute(sql`SELECT COUNT(*) as cnt FROM rssSources`);

console.log('Projects:', projRows[0].cnt);
console.log('Contacts:', contRows[0].cnt);
console.log('Raw Articles:', rawRows[0].cnt);
console.log('Queued Articles:', queuedRows[0].cnt);
console.log('RSS Sources:', rssRows[0].cnt);

// Business line breakdown
const blRows = await db.execute(sql`SELECT matchedBusinessLines, COUNT(*) as cnt FROM projects GROUP BY matchedBusinessLines`);
console.log('\nBusiness Line Breakdown:');
for (const row of blRows[0]) {
  console.log(`  ${row.matchedBusinessLines || 'untagged'}: ${row.cnt}`);
}

// Priority breakdown
const prRows = await db.execute(sql`SELECT priority, COUNT(*) as cnt FROM projects GROUP BY priority`);
console.log('\nPriority Breakdown:');
for (const row of prRows[0]) {
  console.log(`  ${row.priority}: ${row.cnt}`);
}

process.exit(0);
