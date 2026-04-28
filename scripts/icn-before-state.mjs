import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';

config({ path: '.env.local' });
config();

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  
  const [rows] = await conn.execute(`
    SELECT 
      id, projectKey, name, priority, lifecycleStatus, 
      lastActivityAt, lastIcnSeenAt, updatedAt,
      stage, value, owner
    FROM projects 
    WHERE projectKey LIKE 'icn-%'
    ORDER BY lastActivityAt DESC
  `);
  
  console.log('=== ICN PROJECTS BEFORE STATE ===');
  console.log(`Total ICN projects: ${rows.length}`);
  console.log('');
  
  const now = new Date();
  const results = [];
  for (const r of rows) {
    const daysSince = r.lastActivityAt ? Math.round((now - new Date(r.lastActivityAt)) / (1000*60*60*24)) : 999;
    const visible = daysSince <= 30 ? 'VISIBLE' : 'STALE/INVISIBLE';
    results.push({ id: r.id, name: r.name, visible, daysSince, priority: r.priority, lastActivityAt: r.lastActivityAt, lastIcnSeenAt: r.lastIcnSeenAt });
    console.log(`[${visible}] ${r.name.slice(0,60)}`);
    console.log(`  id=${r.id} priority=${r.priority} status=${r.lifecycleStatus}`);
    console.log(`  lastActivityAt=${r.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : 'NULL'} (${daysSince}d ago)`);
    console.log(`  lastIcnSeenAt=${r.lastIcnSeenAt ? new Date(r.lastIcnSeenAt).toISOString() : 'NULL'}`);
    console.log('');
  }
  
  const visible = results.filter(r => r.daysSince <= 30);
  const stale = results.filter(r => r.daysSince > 30);
  console.log(`=== SUMMARY ===`);
  console.log(`Visible (<=30 days): ${visible.length}/${rows.length}`);
  console.log(`Stale/Invisible (>30 days): ${stale.length}/${rows.length}`);
  console.log('');
  console.log('High-value projects status:');
  const highValue = ['AUKUS', 'BAE', 'Sydney Metro', 'North East Link', 'Snowy'];
  for (const keyword of highValue) {
    const match = results.find(r => r.name.toLowerCase().includes(keyword.toLowerCase()));
    if (match) {
      console.log(`  ${keyword}: id=${match.id} [${match.visible}] ${match.daysSince}d ago priority=${match.priority}`);
    } else {
      console.log(`  ${keyword}: NOT FOUND`);
    }
  }
  
  await conn.end();
}
main().catch(console.error);
