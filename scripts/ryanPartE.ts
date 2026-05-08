import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  console.log('═══════════════════════════════════════════════');
  console.log('PART E: CORRECTED RYAN TOP 20 + MUST ACT / WAITING');
  console.log('═══════════════════════════════════════════════\n');

  // Get all WA projects with PA scores, contact counts, and discovery status
  const [allProjects]: any = await conn.query(`
    SELECT 
      p.id, p.name, p.projectState, p.priority, p.sector, p.stage,
      p.equipmentSignals, p.overview, p.sourcePurpose, p.discoveryStatus,
      p.actionTier, p.productLane, p.lastActivityAt,
      pbs.score as paScore,
      (SELECT COUNT(*) FROM contactProjects cp WHERE cp.projectId = p.id) as contactCount,
      (SELECT COUNT(*) FROM contactProjects cp 
        JOIN contacts c ON c.id = cp.contactId 
        WHERE cp.projectId = p.id AND c.verificationStatus = 'verified') as verifiedCount
    FROM projects p
    LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Portable Air'
    WHERE p.projectState IN ('WA', 'OFFSHORE_AU')
      AND (p.suppressed IS NULL OR p.suppressed = 0 OR p.suppressed = '')
      AND p.lifecycleStatus != 'dead'
      AND p.priority IN ('hot', 'warm')
    ORDER BY 
      CASE p.priority WHEN 'hot' THEN 0 ELSE 1 END,
      pbs.score DESC,
      p.lastActivityAt DESC
  `);

  console.log(`Total hot/warm WA projects: ${allProjects.length}\n`);

  // Classify into Must Act vs Waiting
  const mustAct: any[] = [];
  const waiting: any[] = [];
  const blocked: any[] = [];

  for (const p of allProjects) {
    const hasContacts = p.contactCount > 0;
    const hasVerified = p.verifiedCount > 0;
    const isHot = p.priority === 'hot';
    const paScore = p.paScore || 0;

    // Must Act: hot + contacts + PA score >= 80
    if (isHot && hasContacts && paScore >= 80) {
      mustAct.push(p);
    }
    // Waiting: warm + contacts + PA score >= 80, OR hot without contacts
    else if ((p.priority === 'warm' && hasContacts && paScore >= 80) || (isHot && !hasContacts && paScore >= 80)) {
      waiting.push(p);
    }
    // Blocked: high PA but no contacts or discovery stuck
    else if (paScore >= 80 && !hasContacts) {
      blocked.push(p);
    }
  }

  // === CORRECTED TOP 20 ===
  // Criteria: hot priority, PA score >= 80, has contacts, ordered by PA score then recency
  const top20Candidates = allProjects
    .filter((p: any) => p.paScore >= 80 && p.contactCount > 0)
    .slice(0, 20);

  console.log('=== CORRECTED RYAN TOP 20 (PA≥80, has contacts, hot first) ===\n');
  console.log('RK | ID     | NAME                                          | PRI  | PA  | CONTACTS | VERIFIED | LANE');
  console.log('---|--------|-----------------------------------------------|------|-----|----------|----------|------');
  
  for (let i = 0; i < top20Candidates.length; i++) {
    const p = top20Candidates[i];
    const name = (p.name || '').padEnd(47).slice(0, 47);
    const pri = (p.priority || '').padEnd(4).slice(0, 4);
    const pa = String(p.paScore || 0).padStart(3);
    const contacts = String(p.contactCount || 0).padStart(8);
    const verified = String(p.verifiedCount || 0).padStart(8);
    const lane = (p.productLane || 'n/a').slice(0, 6);
    console.log(`${String(i + 1).padStart(2)} | ${String(p.id).padStart(6)} | ${name} | ${pri} | ${pa} | ${contacts} | ${verified} | ${lane}`);
  }

  console.log(`\n=== MUST ACT LIST (hot + contacts + PA≥80): ${mustAct.length} projects ===\n`);
  for (const p of mustAct.slice(0, 15)) {
    console.log(`  [${p.id}] ${p.name.slice(0, 55)} | PA:${p.paScore} | contacts:${p.contactCount} | verified:${p.verifiedCount}`);
  }

  console.log(`\n=== WAITING LIST (warm+contacts+PA≥80 OR hot+no-contacts): ${waiting.length} projects ===\n`);
  for (const p of waiting.slice(0, 15)) {
    console.log(`  [${p.id}] ${p.name.slice(0, 55)} | PA:${p.paScore} | contacts:${p.contactCount} | ${p.priority}`);
  }

  console.log(`\n=== BLOCKED LIST (PA≥80 but no contacts): ${blocked.length} projects ===\n`);
  for (const p of blocked.slice(0, 15)) {
    console.log(`  [${p.id}] ${p.name.slice(0, 55)} | PA:${p.paScore} | discovery:${p.discoveryStatus || 'null'}`);
  }

  // === BOTTLENECK DIAGNOSIS ===
  console.log('\n═══════════════════════════════════════════════');
  console.log('BOTTLENECK DIAGNOSIS');
  console.log('═══════════════════════════════════════════════\n');

  const highPA = allProjects.filter((p: any) => (p.paScore || 0) >= 80);
  const highPANoContacts = highPA.filter((p: any) => p.contactCount === 0);
  const highPAWithContacts = highPA.filter((p: any) => p.contactCount > 0);
  const highPAVerified = highPA.filter((p: any) => p.verifiedCount > 0);

  console.log(`High-PA projects (score≥80): ${highPA.length}`);
  console.log(`  → With contacts:    ${highPAWithContacts.length} (${Math.round(highPAWithContacts.length / highPA.length * 100)}%)`);
  console.log(`  → Without contacts: ${highPANoContacts.length} (${Math.round(highPANoContacts.length / highPA.length * 100)}%)`);
  console.log(`  → With verified:    ${highPAVerified.length} (${Math.round(highPAVerified.length / highPA.length * 100)}%)`);
  console.log('');

  // Discovery status for blocked projects
  const discoveryBreakdown: Record<string, number> = {};
  for (const p of highPANoContacts) {
    const status = p.discoveryStatus || 'null';
    discoveryBreakdown[status] = (discoveryBreakdown[status] || 0) + 1;
  }
  console.log('Discovery status of blocked (PA≥80, no contacts):');
  for (const [status, count] of Object.entries(discoveryBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }
  console.log('');

  // Source purpose breakdown for high-PA projects
  const sourceBreakdown: Record<string, number> = {};
  for (const p of highPA) {
    const src = p.sourcePurpose || 'unknown';
    sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
  }
  console.log('Source purpose of high-PA projects:');
  for (const [src, count] of Object.entries(sourceBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${count}`);
  }

  await conn.end();
}
main().catch(e => { console.error(e); process.exit(1); });
