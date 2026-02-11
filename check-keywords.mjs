/**
 * Check business line keywords and analyze skipped articles
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';

const pool = mysql.createPool(process.env.DATABASE_URL);
const db = drizzle(pool);

// Check business line keywords
const [bls] = await db.execute(sql`SELECT id, name, keywords FROM businessLines WHERE isActive = true`);
console.log("=== BUSINESS LINE KEYWORDS ===\n");
for (const bl of bls) {
  const kw = typeof bl.keywords === 'string' ? JSON.parse(bl.keywords) : bl.keywords;
  console.log(`${bl.id}: ${bl.name}`);
  console.log(`  Keywords: ${kw?.join(', ')}`);
  console.log();
}

// Count skipped articles
const [skippedCount] = await db.execute(sql`SELECT COUNT(*) as cnt FROM rawArticles WHERE status = 'skipped'`);
console.log(`\nSkipped articles: ${skippedCount[0].cnt}`);

// Sample some skipped article titles to see what we're missing
const [skippedSamples] = await db.execute(sql`
  SELECT title, summary FROM rawArticles WHERE status = 'skipped' ORDER BY createdAt DESC LIMIT 30
`);
console.log(`\n=== SAMPLE SKIPPED ARTICLES (last 30) ===\n`);
for (const a of skippedSamples) {
  console.log(`  - ${a.title}`);
}

await pool.end();
process.exit(0);
