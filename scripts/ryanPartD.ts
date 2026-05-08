import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  // Check contactProjects table
  const [cpCols]: any = await conn.query('SHOW COLUMNS FROM contactProjects');
  console.log('=== contactProjects COLUMNS ===');
  for (const c of cpCols) console.log(c.Field);
  console.log('');

  // Get top 30 WA projects by PA score
  const [topProjects]: any = await conn.query(`
    SELECT 
      p.id, p.name, p.projectState, p.priority, p.sector, p.stage,
      p.equipmentSignals, p.overview, p.sourcePurpose, p.discoveryStatus,
      pbs.score as paScore
    FROM projects p
    LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Portable Air'
    WHERE p.projectState IN ('WA', 'OFFSHORE_AU')
      AND (p.suppressed IS NULL OR p.suppressed = 0 OR p.suppressed = '')
      AND p.lifecycleStatus != 'dead'
    ORDER BY pbs.score DESC, p.priority DESC
    LIMIT 30
  `);

  console.log('TOP 30 WA PROJECTS (by PA score):\n');
  console.log('RK | ID     | NAME                                          | PRI  | PA  | SOURCE      | DISCOVERY');
  console.log('---|--------|-----------------------------------------------|------|-----|-------------|----------');
  
  for (let i = 0; i < topProjects.length; i++) {
    const p = topProjects[i];
    const name = (p.name || '').padEnd(47).slice(0, 47);
    const pri = (p.priority || '').padEnd(4).slice(0, 4);
    const pa = String(p.paScore || 0).padStart(3);
    const source = (p.sourcePurpose || 'unknown').padEnd(11).slice(0, 11);
    const disc = (p.discoveryStatus || 'null').padEnd(10).slice(0, 10);
    console.log(`${String(i + 1).padStart(2)} | ${String(p.id).padStart(6)} | ${name} | ${pri} | ${pa} | ${source} | ${disc}`);
  }
  console.log('');

  // Get contact counts for top 30 projects
  const projectIds = topProjects.map((p: any) => p.id);
  if (projectIds.length > 0) {
    const [contactCounts]: any = await conn.query(`
      SELECT cp.projectId, COUNT(DISTINCT cp.contactId) as cnt,
        SUM(CASE WHEN c.verificationStatus = 'verified' THEN 1 ELSE 0 END) as verified,
        SUM(CASE WHEN c.email IS NOT NULL AND c.email != '' THEN 1 ELSE 0 END) as hasEmail
      FROM contactProjects cp
      JOIN contacts c ON c.id = cp.contactId
      WHERE cp.projectId IN (${projectIds.join(',')})
      GROUP BY cp.projectId
    `);
    
    console.log('CONTACT COUNTS FOR TOP 30:\n');
    console.log('ID     | NAME                                          | CONTACTS | VERIFIED | HAS EMAIL');
    console.log('-------|-----------------------------------------------|----------|----------|----------');
    
    const contactMap = new Map();
    for (const cc of contactCounts) contactMap.set(cc.projectId, cc);
    
    let noContacts = 0, withContacts = 0, withVerified = 0;
    for (const p of topProjects) {
      const cc = contactMap.get(p.id) || { cnt: 0, verified: 0, hasEmail: 0 };
      const name = (p.name || '').padEnd(47).slice(0, 47);
      console.log(`${String(p.id).padStart(6)} | ${name} | ${String(cc.cnt).padStart(8)} | ${String(cc.verified).padStart(8)} | ${String(cc.hasEmail).padStart(9)}`);
      if (cc.cnt === 0) noContacts++;
      else withContacts++;
      if (cc.verified > 0) withVerified++;
    }
    
    console.log('');
    console.log(`SUMMARY: ${withContacts}/30 have contacts, ${withVerified}/30 have verified contacts, ${noContacts}/30 have NO contacts`);
    console.log('');

    // Show top contacts for first 10 projects
    console.log('TOP 10 PROJECTS — BEST CONTACTS:\n');
    for (const p of topProjects.slice(0, 10)) {
      const [contacts]: any = await conn.query(`
        SELECT c.name, c.title, c.company, c.email, c.verificationStatus, c.roleRelevance, c.regionClassification
        FROM contactProjects cp
        JOIN contacts c ON c.id = cp.contactId
        WHERE cp.projectId = ?
        ORDER BY c.roleRelevance DESC, c.verificationStatus DESC
        LIMIT 2
      `, [p.id]);
      
      console.log(`[${p.id}] ${p.name} (PA: ${p.paScore || 0}, ${p.priority}, ${p.sourcePurpose || 'unknown'})`);
      if (contacts.length === 0) {
        console.log(`  → NO CONTACTS — needs discovery`);
      } else {
        for (const c of contacts) {
          const v = c.verificationStatus === 'verified' ? '✓' : '?';
          const region = c.regionClassification || 'unknown';
          console.log(`  → ${v} ${c.name} | ${c.title || 'n/a'} @ ${c.company || 'n/a'} | ${c.email ? 'email' : 'no-email'} | region: ${region}`);
        }
      }
      console.log('');
    }
  }

  // Validation gates
  const [gates]: any = await conn.query(`
    SELECT pvg.projectId, pvg.digestSafe, p.name
    FROM projectValidationGates pvg
    JOIN projects p ON p.id = pvg.projectId
    WHERE p.projectState IN ('WA', 'OFFSHORE_AU')
    ORDER BY pvg.digestSafe DESC
  `);
  console.log(`\n=== DIGEST SAFE GATES (WA) ===`);
  console.log(`Total gated: ${gates.length}, digestSafe=true: ${gates.filter((g: any) => g.digestSafe).length}`);
  for (const g of gates) {
    console.log(`  [${g.projectId}] ${g.name.slice(0, 50)} | digestSafe=${g.digestSafe}`);
  }

  await conn.end();
}
main().catch(e => { console.error(e); process.exit(1); });
