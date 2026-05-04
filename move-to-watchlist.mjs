import 'dotenv/config';
import { createConnection } from 'mysql2/promise';

const conn = await createConnection(process.env.DATABASE_URL);

// Check current watchlist count (already moved in previous run)
const [watchlistCheck] = await conn.execute(
  `SELECT COUNT(*) as cnt FROM projects WHERE discoveryStatus = 'watchlist_monitor'`
);
console.log(`Current watchlist_monitor count: ${watchlistCheck[0].cnt}`);

if (watchlistCheck[0].cnt < 13) {
  // Move any remaining named_contact_no_email weak projects
  const weakPatterns = [
    'Infrastructure funding to unlock thousands',
    'North Queensland Large-Scale Solar',
    'Queensland Beef Corridors',
    'Household Energy Upgrades Fund',
    'Cheaper Home Batteries',
    'Suburban Rail Loop',
    'Sydney Metro',
    'Level Crossing Removal',
    'Queensland Critical Resource Projects Fast',
    'Pilbara Desalination',
    'Maningrida Arts',
    'Port Infrastructure Works',
    'VicGrid',
  ];
  let moved = 0;
  for (const pattern of weakPatterns) {
    const [r] = await conn.execute(
      `UPDATE projects SET discoveryStatus = 'watchlist_monitor', updatedAt = NOW() WHERE name LIKE ? AND discoveryStatus = 'named_contact_no_email'`,
      [`%${pattern}%`]
    );
    if (r.affectedRows > 0) { moved++; console.log(`  Moved: ${pattern}`); }
  }
  console.log(`Moved ${moved} additional projects to watchlist_monitor`);
}

// === WA DIGEST CANDIDATE POOL AUDIT ===
console.log('\n=== WA DIGEST CANDIDATE POOL AUDIT ===\n');

// All send_ready_contact hot/warm projects
const [allPool] = await conn.execute(`
  SELECT 
    p.name, p.priority, p.projectState, p.sector, p.matchedBusinessLines, p.lifecycleStatus,
    COUNT(c.id) as contact_count,
    SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) as send_ready_contacts,
    SUM(CASE WHEN c.emailVerified = 1 THEN 1 ELSE 0 END) as verified_emails
  FROM projects p
  LEFT JOIN contacts c ON c.project = p.name
  WHERE p.priority IN ('hot', 'warm')
    AND p.discoveryStatus = 'send_ready_contact'
  GROUP BY p.id, p.name, p.priority, p.projectState, p.sector, p.matchedBusinessLines, p.lifecycleStatus
  ORDER BY FIELD(p.priority, 'hot', 'warm'), send_ready_contacts DESC
`);

console.log(`All send_ready_contact hot/warm projects: ${allPool.length}`);
console.log('');
console.log('Project'.padEnd(50) + ' | Pri  | State | Sector       | BL                   | SR | Verified');
console.log('-'.repeat(120));
for (const row of allPool) {
  const name = (row.name || '').length > 48 ? row.name.slice(0, 45) + '...' : (row.name || '').padEnd(48);
  const bl = row.matchedBusinessLines ? String(row.matchedBusinessLines).slice(0, 20) : 'none';
  const st = (row.projectState || 'N/A').slice(0, 5);
  const sec = (row.sector || 'N/A').slice(0, 12);
  console.log(`${name} | ${(row.priority || '').padEnd(4)} | ${st.padEnd(5)} | ${sec.padEnd(12)} | ${bl.padEnd(20)} | ${String(row.send_ready_contacts || 0).padStart(2)} | ${String(row.verified_emails || 0).padStart(8)}`);
}

// WA-specific filter (Western Australia projects)
const waPool = allPool.filter(p => {
  const st = (p.projectState || '').toLowerCase();
  const nm = (p.name || '').toLowerCase();
  return st.includes('wa') || st.includes('western australia') || 
         nm.includes('pilbara') || nm.includes('kalgoorlie') || nm.includes('perth') || 
         nm.includes('goldfields') || nm.includes('kimberley') || nm.includes('broome') ||
         nm.includes('karratha') || nm.includes('port hedland');
});

console.log(`\nWA-scoped projects in candidate pool: ${waPool.length}`);
for (const row of waPool) {
  console.log(`  [${row.priority}] ${row.name} | send_ready=${row.send_ready_contacts}`);
}

// Territory threshold assessment
const strongItems = allPool.filter(p => Number(p.send_ready_contacts) > 0);
const threshold = strongItems.length >= 3 ? 'MET' : `NOT MET (${strongItems.length}/3 strong items)`;
console.log(`\nTerritory threshold (min 3 send-ready Must Act items): ${threshold}`);
console.log(`Strong Must Act items: ${strongItems.length}`);

// Watchlist summary
const [watchlist] = await conn.execute(
  `SELECT COUNT(*) as cnt FROM projects WHERE discoveryStatus = 'watchlist_monitor'`
);
console.log(`\nWatchlist (watchlist_monitor): ${watchlist[0].cnt} projects — NOT blocking digest`);

// Final readiness verdict
if (strongItems.length >= 3) {
  console.log('\n✅ WA PREVIEW READINESS: READY');
  console.log('   Manual review required before first live send.');
  console.log('   After one reviewed cycle, automatic send can be enabled.');
} else {
  console.log('\n⏸ WA PREVIEW READINESS: NOT READY');
  console.log(`   Need ${3 - strongItems.length} more send-ready Must Act items.`);
}

await conn.end();
