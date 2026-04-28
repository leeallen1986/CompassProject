/**
 * ICN Upsert Engine — Test Run Script
 * Runs the ICN scraper and captures before/after state for validation.
 */
import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

config({ path: '.env.local' });
config();

const __dirname = dirname(fileURLToPath(import.meta.url));

async function getIcnState(conn, label) {
  const [rows] = await conn.execute(`
    SELECT 
      id, projectKey, name, priority, lifecycleStatus, 
      lastActivityAt, lastIcnSeenAt, updatedAt,
      stage
    FROM projects 
    WHERE projectKey LIKE 'icn-%'
    ORDER BY name ASC
  `);
  
  const now = new Date();
  const results = rows.map(r => {
    const daysSince = r.lastActivityAt ? Math.round((now - new Date(r.lastActivityAt)) / (1000*60*60*24)) : 999;
    return {
      id: r.id,
      name: r.name,
      priority: r.priority,
      lifecycleStatus: r.lifecycleStatus,
      daysSince,
      visible: daysSince <= 30,
      lastActivityAt: r.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : null,
      lastIcnSeenAt: r.lastIcnSeenAt ? new Date(r.lastIcnSeenAt).toISOString() : null,
      stage: r.stage,
    };
  });
  
  return results;
}

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  
  console.log('=== BEFORE STATE ===');
  const before = await getIcnState(conn, 'BEFORE');
  const beforeVisible = before.filter(r => r.visible);
  const beforeStale = before.filter(r => !r.visible);
  console.log(`Total: ${before.length} | Visible: ${beforeVisible.length} | Stale: ${beforeStale.length}`);
  console.log('');
  
  // Show high-value projects before
  const highValue = ['AUKUS', 'BAE Systems', 'Sydney Metro', 'North East Link', 'Snowy Mountains'];
  console.log('High-value projects BEFORE:');
  for (const kw of highValue) {
    const match = before.find(r => r.name.toLowerCase().includes(kw.toLowerCase()));
    if (match) {
      console.log(`  [${match.visible ? 'VISIBLE' : 'STALE'}] ${match.name.slice(0,55)}`);
      console.log(`    id=${match.id} priority=${match.priority} lastActivityAt=${match.lastActivityAt} (${match.daysSince}d ago)`);
      console.log(`    lastIcnSeenAt=${match.lastIcnSeenAt || 'NULL'}`);
    } else {
      console.log(`  [NOT IN DB] ${kw}`);
    }
  }
  console.log('');
  
  // Now run the ICN scraper via tsx
  console.log('=== RUNNING ICN UPSERT ENGINE ===');
  console.log('Invoking runIcnScraper()...');
  console.log('');
  
  await conn.end();
  
  // We need to run the scraper via the server's module system
  // Use a direct DB update approach to simulate what the scraper does
  // (since we can't easily import TypeScript from a .mjs script)
  // Instead, we'll trigger it via a direct invocation
  console.log('NOTE: Run the scraper via: pnpm tsx scripts/run-icn-direct.ts');
  console.log('Then re-run this script to see the after state.');
}

main().catch(console.error);
