/**
 * Direct-Sale-Only Audit Script v2
 * Channel is computed at runtime by laneScoring.ts, not stored in DB.
 * This script audits:
 *   1. salesMotion column for all 18 reps (should all be direct_only)
 *   2. digestSafe gate status for the four key reps
 *   3. actionTier distribution + suppressed/active counts
 *   4. Top 5 Must Act projects per rep (by actionTier + relevanceScore proxy)
 *   5. Rental keyword presence in top projects (manual suppression check)
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

const KEY_REPS = ['Ryan Pemberton', 'Daniel Zec', 'Dan Day', 'Amit Bhargava'];

// Fetch actual user IDs from DB
const [users] = await db.execute(
  `SELECT u.id, u.name, up.salesMotion, up.territories, up.assignedBusinessLines
   FROM users u
   LEFT JOIN userProfiles up ON up.userId = u.id
   WHERE u.name IN (${KEY_REPS.map(() => '?').join(',')})`,
  KEY_REPS
);

console.log('\n=== DIRECT-SALE-ONLY AUDIT ===\n');

// ── 1. salesMotion check for all 18 reps ──
const [allReps] = await db.execute(
  `SELECT u.name, up.salesMotion FROM users u
   LEFT JOIN userProfiles up ON up.userId = u.id
   WHERE up.id IS NOT NULL
   ORDER BY u.name`
);
console.log('── salesMotion for all reps ──');
let allDirect = true;
for (const r of allReps) {
  const ok = r.salesMotion === 'direct_only';
  if (!ok) allDirect = false;
  console.log(`  ${(r.name || '(no name)').padEnd(25)} salesMotion=${r.salesMotion || 'NULL'} ${ok ? '✓' : '✗ WARN'}`);
}
console.log(`  → All direct_only: ${allDirect ? '✓ YES' : '✗ NO'}`);

// ── 2. digestSafe gate status ──
console.log('\n── digestSafe Gate Status ──');
for (const u of users) {
  const [gates] = await db.execute(
    `SELECT COUNT(*) as total, SUM(digestSafe) as safe FROM projectValidationGates WHERE userId = ?`,
    [u.id]
  );
  const g = gates[0];
  const status = g.safe >= 3 ? '✓ PASS' : '✗ FAIL';
  console.log(`  ${(u.name || '').padEnd(20)} digestSafe=${g.safe}/${g.total}  ${status}`);
}

// ── 3. Project pool stats ──
const [poolStats] = await db.execute(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN suppressed = 1 THEN 1 ELSE 0 END) as suppressed,
    SUM(CASE WHEN crmOrphan = 1 THEN 1 ELSE 0 END) as orphaned,
    SUM(CASE WHEN actionTier = 1 THEN 1 ELSE 0 END) as tier1,
    SUM(CASE WHEN actionTier = 2 THEN 1 ELSE 0 END) as tier2,
    SUM(CASE WHEN actionTier = 3 THEN 1 ELSE 0 END) as tier3,
    SUM(CASE WHEN actionTier IS NULL THEN 1 ELSE 0 END) as noTier
  FROM projects
  WHERE status = 'active'
`);
const ps = poolStats[0];
console.log('\n── Active Project Pool ──');
console.log(`  Total active:   ${ps.total}`);
console.log(`  Suppressed:     ${ps.suppressed}`);
console.log(`  CRM orphans:    ${ps.orphaned}`);
console.log(`  Tier 1 (Must):  ${ps.tier1}`);
console.log(`  Tier 2 (Close): ${ps.tier2}`);
console.log(`  Tier 3 (Watch): ${ps.tier3}`);
console.log(`  No tier:        ${ps.noTier}`);

// ── 4. Rental keyword check in top Must Act projects ──
// Check if any tier1/2 projects have rental-heavy keywords in name/overview
const [tier12] = await db.execute(`
  SELECT id, name, opportunityRoute, overview, productLane, projectState, actionTier
  FROM projects
  WHERE status = 'active' AND crmOrphan = 0 AND suppressed = 0
    AND actionTier IN (1,2)
  ORDER BY actionTier ASC
  LIMIT 100
`);

const rentalKeywords = ['rental', 'hire', 'fleet hire', 'equipment hire', 'rent '];
const rentalFlagged = tier12.filter(p => {
  const text = `${p.name || ''} ${p.opportunityRoute || ''} ${p.overview || ''}`.toLowerCase();
  return rentalKeywords.some(kw => text.includes(kw));
});
console.log(`\n── Rental-keyword projects in Must Act/Closing Soon: ${rentalFlagged.length} ──`);
if (rentalFlagged.length > 0) {
  for (const p of rentalFlagged.slice(0, 10)) {
    const snippet = `${p.name?.slice(0,50)} | route=${p.opportunityRoute} | tier=${p.actionTier}`;
    console.log(`  [FLAG] ${snippet}`);
  }
  console.log(`  → These will be scored at runtime; rental channel → -25pts penalty + suppressed from digest`);
} else {
  console.log('  ✓ No rental-keyword projects in tier 1/2 pool');
}

// ── 5. Top 5 Must Act per rep ──
for (const u of users) {
  const territories = JSON.parse(u.territories || '[]');
  const blIds = JSON.parse(u.assignedBusinessLines || '[]');
  const isNational = territories.includes('NATIONAL');

  const territoryClause = isNational ? '' :
    `AND (p.projectState IN (${territories.map(t => `'${t}'`).join(',')}) OR p.projectState IS NULL)`;
  const blClause = blIds.length > 0 ?
    `AND (${blIds.map(id => `JSON_CONTAINS(p.matchedBusinessLines, '${id}')`).join(' OR ')})` : '';

  const [topProjects] = await db.execute(`
    SELECT p.id, p.name, p.opportunityRoute, p.actionTier, p.projectState, p.sector,
           p.tenderCloseDate, p.productLane,
           (SELECT COUNT(*) FROM contacts c 
            JOIN contactProjects cp ON cp.contactId = c.id
            WHERE cp.projectId = p.id AND c.contactTrustTier = 'send_ready'
              AND c.roleRelevance IN ('high','medium')) as actionableContacts,
           (SELECT pvg.digestSafe FROM projectValidationGates pvg 
            WHERE pvg.projectId = p.id AND pvg.userId = ? LIMIT 1) as digestSafe
    FROM projects p
    WHERE p.status = 'active' AND p.crmOrphan = 0 AND p.suppressed = 0
      AND p.actionTier IN (1,2)
      ${territoryClause}
      ${blClause}
    ORDER BY p.actionTier ASC, p.id ASC
    LIMIT 10
  `, [u.id]);

  console.log(`\n── ${u.name} (salesMotion=${u.salesMotion || 'direct_only'}) ──`);
  console.log(`   Territories: ${territories.join(', ')} | BL IDs: ${blIds.join(', ')}`);
  console.log(`   Top Must Act projects (tier 1/2, non-suppressed, non-orphan):`);

  for (const p of topProjects.slice(0, 5)) {
    const hasRentalKw = rentalKeywords.some(kw => 
      `${p.name || ''} ${p.opportunityRoute || ''}`.toLowerCase().includes(kw));
    const rentalFlag = hasRentalKw ? ' [RENTAL KW → will be penalised]' : '';
    const gateStatus = p.digestSafe ? '✓ gated' : '○ ungated';
    const closeDate = p.tenderCloseDate ? new Date(p.tenderCloseDate).toISOString().slice(0,10) : 'no date';
    console.log(`  [T${p.actionTier}] ${(p.name || '').slice(0,55).padEnd(55)} | ${(p.opportunityRoute || '').slice(0,15).padEnd(15)} | contacts=${p.actionableContacts} | ${gateStatus} | close=${closeDate}${rentalFlag}`);
  }
  
  if (topProjects.length === 0) {
    console.log('  (no tier 1/2 projects in territory/BL scope)');
  }
}

// ── 6. Suppression report: projects that will be suppressed by gate ──
// These are projects with no portable air / direct equipment signals
const [noLaneProjects] = await db.execute(`
  SELECT COUNT(*) as cnt FROM projects
  WHERE status = 'active' AND crmOrphan = 0 AND suppressed = 0
    AND actionTier IN (1,2)
    AND (productLane IS NULL OR productLane = '')
`);
console.log(`\n── Portable Air Gate Exposure ──`);
console.log(`  Tier 1/2 projects with no productLane set: ${noLaneProjects[0].cnt}`);
console.log(`  (These will be evaluated by portableAirOpportunityGate at digest runtime)`);
console.log(`  (Gate uses name/overview/sector/equipmentSignals + BL score to decide suppress/monitor_only/pass)`);

await db.end();
console.log('\n=== AUDIT COMPLETE ===\n');
