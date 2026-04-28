import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';

config({ path: '.env.local' });
config();

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);

  // Count all geo states
  const [summary] = await conn.execute(`
    SELECT geoBlockedReason, COUNT(*) as cnt
    FROM projects
    GROUP BY geoBlockedReason
    ORDER BY cnt DESC
  `);
  console.log('=== GEO CLASSIFICATION SUMMARY (BEFORE) ===');
  for (const r of summary) {
    console.log(`  ${r.geoBlockedReason ?? 'NULL (unclassified)'}: ${r.cnt}`);
  }
  console.log('');

  // Get all blocked_cross_border_signal projects
  const [blocked] = await conn.execute(`
    SELECT id, name, location, owner, overview, 
           projectCountry, projectState, locationConfidence, geoBlockedReason
    FROM projects
    WHERE geoBlockedReason = 'blocked_cross_border_signal'
    ORDER BY id ASC
  `);
  console.log(`=== BLOCKED_CROSS_BORDER_SIGNAL PROJECTS: ${blocked.length} total ===`);
  for (const r of blocked) {
    const overview = (r.overview || '').slice(0, 120);
    console.log(`  [${r.id}] ${r.name.slice(0, 60)}`);
    console.log(`    location="${r.location}" owner="${r.owner.slice(0, 50)}"`);
    console.log(`    overview: ${overview}...`);
    console.log('');
  }

  await conn.end();
}
main().catch(console.error);
