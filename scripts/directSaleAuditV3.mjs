/**
 * Direct-Sale-Only Audit Script v3
 * Verifies global direct-sale-only rule is enforced across all reps.
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

console.log('\n=== DIRECT-SALE-ONLY AUDIT ===\n');

// 1. salesMotion for all reps
const [reps] = await db.execute(
  'SELECT u.name, up.salesMotion FROM users u JOIN userProfiles up ON up.userId=u.id ORDER BY u.name'
);
console.log('── salesMotion for all reps ──');
let allDirect = true;
for (const r of reps) {
  const ok = r.salesMotion === 'direct_only';
  if (!ok) allDirect = false;
  const status = ok ? ' ✓' : ' ✗ WARN';
  console.log(`  ${(r.name || '').padEnd(25)} salesMotion=${r.salesMotion}${status}`);
}
console.log(`  → All direct_only: ${allDirect ? '✓ YES' : '✗ NO'}`);

// 2. digestSafe gates
const [gates] = await db.execute(
  'SELECT COUNT(*) as total, SUM(digestSafe) as safe FROM projectValidationGates'
);
console.log('\n── digestSafe Gates (global pool) ──');
console.log(`  Total gates: ${gates[0].total}  digestSafe: ${gates[0].safe}`);

// 3. Pool stats
const [ps] = await db.execute(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN suppressed=1 THEN 1 ELSE 0 END) as suppressed,
    SUM(CASE WHEN actionTier=1 THEN 1 ELSE 0 END) as tier1,
    SUM(CASE WHEN actionTier=2 THEN 1 ELSE 0 END) as tier2,
    SUM(CASE WHEN actionTier=3 THEN 1 ELSE 0 END) as tier3
  FROM projects WHERE lifecycleStatus='active'
`);
const pool = ps[0];
console.log('\n── Active Project Pool ──');
console.log(`  Total active:   ${pool.total}  Suppressed: ${pool.suppressed}`);
console.log(`  Tier 1 (Must):  ${pool.tier1}  Tier 2 (Close): ${pool.tier2}  Tier 3 (Watch): ${pool.tier3}`);

// 4. Rental keyword check in tier 1/2
const [tier12] = await db.execute(`
  SELECT id, name, opportunityRoute, actionTier
  FROM projects
  WHERE lifecycleStatus='active' AND suppressed=0 AND actionTier IN (1,2)
  ORDER BY actionTier ASC LIMIT 300
`);
const rentalKws = ['rental', ' hire', 'fleet hire', 'equipment hire'];
const flagged = tier12.filter(p =>
  rentalKws.some(kw => `${p.name || ''} ${p.opportunityRoute || ''}`.toLowerCase().includes(kw))
);
console.log(`\n── Rental-keyword projects in tier 1/2: ${flagged.length} ──`);
for (const p of flagged.slice(0, 8)) {
  console.log(`  [T${p.actionTier}] ${(p.name || '').slice(0, 60)} | route=${p.opportunityRoute || ''}`);
}
if (flagged.length === 0) {
  console.log('  ✓ None found — clean pool');
} else {
  console.log('  → Runtime scoring will apply -25pts rental penalty and suppress from digest');
}

// 5. BL name → ID map
const [blRows] = await db.execute('SELECT id, name FROM businessLines');
const blMap = {};
for (const b of blRows) blMap[b.name.toLowerCase()] = b.id;

// 6. Top 5 per rep
const [repRows] = await db.execute(`
  SELECT u.id, u.name, up.territories, up.assignedBusinessLines, up.salesMotion
  FROM users u JOIN userProfiles up ON up.userId=u.id
  WHERE u.name IN ('Ryan Pemberton','Daniel Zec','Dan Day','Amit Bhargava')
`);

for (const u of repRows) {
  const territories = Array.isArray(u.territories) ? u.territories : JSON.parse(u.territories || '[]');
  const blNames = Array.isArray(u.assignedBusinessLines) ? u.assignedBusinessLines : JSON.parse(u.assignedBusinessLines || '[]');
  const blIds = blNames.map(n => blMap[n.toLowerCase()]).filter(Boolean);
  const isNational = territories.length >= 6;

  let tClause = '';
  if (!isNational && territories.length > 0) {
    const tList = territories.map(t => `'${t}'`).join(',');
    tClause = `AND (p.projectState IN (${tList}) OR p.projectState IS NULL)`;
  }
  let blClause = '';
  if (blIds.length > 0) {
    const blParts = blIds.map(id => `JSON_CONTAINS(p.matchedBusinessLines, '${id}')`).join(' OR ');
    blClause = `AND (${blParts})`;
  }

  const [top] = await db.execute(`
    SELECT p.id, p.name, p.opportunityRoute, p.actionTier, p.projectState, p.tenderCloseDate,
           (SELECT COUNT(*) FROM contacts c 
            JOIN contactProjects cp ON cp.contactId=c.id
            WHERE cp.projectId=p.id AND c.contactTrustTier='send_ready'
              AND c.roleRelevance IN ('high','medium')) as contacts,
           (SELECT pvg.digestSafe FROM projectValidationGates pvg WHERE pvg.projectId=p.id LIMIT 1) as digestSafe
    FROM projects p
    WHERE p.lifecycleStatus='active' AND p.suppressed=0 AND p.actionTier IN (1,2)
      ${tClause}
      ${blClause}
    ORDER BY p.actionTier ASC LIMIT 8
  `);

  const label = isNational ? 'NATIONAL' : territories.join(', ');
  console.log(`\n── ${u.name} (salesMotion=${u.salesMotion || 'direct_only'}) ──`);
  console.log(`   Territories: ${label} | BLs: ${blNames.join(', ')} (IDs: ${blIds.join(',')})`);

  for (const p of top.slice(0, 5)) {
    const hasRental = rentalKws.some(kw =>
      `${p.name || ''} ${p.opportunityRoute || ''}`.toLowerCase().includes(kw)
    );
    const rentalNote = hasRental ? ' [RENTAL KW → -25pts]' : '';
    const gate = p.digestSafe ? '✓gate' : '○';
    const close = p.tenderCloseDate ? new Date(p.tenderCloseDate).toISOString().slice(0, 10) : 'no date';
    console.log(`  [T${p.actionTier}] ${(p.name || '').slice(0, 55).padEnd(55)} | contacts=${p.contacts} | ${gate} | ${close}${rentalNote}`);
  }
  if (top.length === 0) {
    console.log('  (no tier 1/2 in scope)');
  }
}

await db.end();
console.log('\n=== AUDIT COMPLETE ===\n');
