import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  // ═══════════════════════════════════════════════
  // PART C: TENDER AUDIT
  // ═══════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════');
  console.log('PART C: TENDER / PROCUREMENT AUDIT');
  console.log('═══════════════════════════════════════════════\n');

  // Get all tender-sourced WA projects
  const [tenderProjects]: any = await conn.query(`
    SELECT id, name, tenderNumber, tenderCloseDate, priority, sector, stage, 
           equipmentSignals, overview, sourcePurpose
    FROM projects 
    WHERE projectState IN ('WA', 'OFFSHORE_AU')
      AND (suppressed IS NULL OR suppressed = 0 OR suppressed = '')
      AND lifecycleStatus != 'dead'
      AND sourcePurpose = 'live_tender'
    ORDER BY tenderCloseDate DESC
  `);
  console.log(`Total WA tender-sourced projects: ${tenderProjects.length}\n`);

  // Classify tender projects by PA relevance
  let tenderPA = 0, tenderGeneric = 0, tenderIrrelevant = 0;
  const tenderFamilies = { drilling: 0, blasting: 0, piling: 0, compressor: 0, shutdown: 0, commissioning: 0, nitrogen: 0, pipeline: 0, booster: 0, plant_equipment: 0, other: 0 };
  
  for (const t of tenderProjects) {
    const text = `${t.name} ${t.overview || ''}`.toLowerCase();
    let equip: string[] = [];
    try { equip = typeof t.equipmentSignals === 'string' ? JSON.parse(t.equipmentSignals) : (t.equipmentSignals || []); } catch { equip = []; }
    const combined = `${text} ${(equip as string[]).join(' ').toLowerCase()}`;

    let isPA = false;
    if (/drill|boring|auger/.test(combined)) { tenderFamilies.drilling++; isPA = true; }
    if (/blast|explo/.test(combined)) { tenderFamilies.blasting++; isPA = true; }
    if (/pil(e|ing)/.test(combined)) { tenderFamilies.piling++; isPA = true; }
    if (/compressor|compressed air|air supply/.test(combined)) { tenderFamilies.compressor++; isPA = true; }
    if (/shutdown|turnaround/.test(combined)) { tenderFamilies.shutdown++; isPA = true; }
    if (/commission|pre.?commission/.test(combined)) { tenderFamilies.commissioning++; isPA = true; }
    if (/nitrogen|n2|inert|purg/.test(combined)) { tenderFamilies.nitrogen++; isPA = true; }
    if (/pipeline|pressure test|leak test/.test(combined)) { tenderFamilies.pipeline++; isPA = true; }
    if (/booster|high.?pressure/.test(combined)) { tenderFamilies.booster++; isPA = true; }
    if (/plant|equipment|machinery|heavy/.test(combined) && !isPA) { tenderFamilies.plant_equipment++; isPA = true; }

    if (isPA) tenderPA++;
    else if (/mine|mining|construct|infrastructure|energy/.test(combined)) tenderGeneric++;
    else tenderIrrelevant++;
  }

  console.log('TENDER PROJECTS BY PA FAMILY:');
  console.log(`  Drilling:          ${tenderFamilies.drilling}`);
  console.log(`  Blasting:          ${tenderFamilies.blasting}`);
  console.log(`  Piling:            ${tenderFamilies.piling}`);
  console.log(`  Compressor:        ${tenderFamilies.compressor}`);
  console.log(`  Shutdown:          ${tenderFamilies.shutdown}`);
  console.log(`  Commissioning:     ${tenderFamilies.commissioning}`);
  console.log(`  Nitrogen/Purging:  ${tenderFamilies.nitrogen}`);
  console.log(`  Pipeline/Testing:  ${tenderFamilies.pipeline}`);
  console.log(`  Booster/HP:        ${tenderFamilies.booster}`);
  console.log(`  Plant/Equipment:   ${tenderFamilies.plant_equipment}`);
  console.log(`  ---`);
  console.log(`  PA-relevant:       ${tenderPA}`);
  console.log(`  Generic:           ${tenderGeneric}`);
  console.log(`  Irrelevant:        ${tenderIrrelevant}`);
  console.log('');

  // Show sample tender projects
  console.log('SAMPLE TENDER PROJECTS (first 15):');
  for (const t of tenderProjects.slice(0, 15)) {
    const close = t.tenderCloseDate ? new Date(t.tenderCloseDate).toISOString().slice(0, 10) : 'n/a';
    console.log(`  [${t.id}] ${t.name.slice(0, 65)} | ${t.priority} | close: ${close}`);
  }
  console.log('');

  // ═══════════════════════════════════════════════
  // PART D: CONTACT CONVERSION AUDIT
  // ═══════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════');
  console.log('PART D: CONTACT CONVERSION AUDIT');
  console.log('═══════════════════════════════════════════════\n');

  // Get Ryan's top 30 scored projects with contacts
  const [topProjects]: any = await conn.query(`
    SELECT 
      p.id, p.name, p.projectState, p.priority, p.sector, p.stage,
      p.equipmentSignals, p.overview, p.sourcePurpose, p.discoveryStatus,
      pbs.portableAir as paScore,
      (SELECT COUNT(*) FROM contacts c WHERE c.projectId = p.id) as contactCount,
      (SELECT COUNT(*) FROM contacts c WHERE c.projectId = p.id AND c.verificationStatus = 'verified') as verifiedCount,
      (SELECT COUNT(*) FROM projectValidationGates pvg WHERE pvg.projectId = p.id AND pvg.digestSafe = 1) as digestSafeCount
    FROM projects p
    LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
    WHERE p.projectState IN ('WA', 'OFFSHORE_AU')
      AND (p.suppressed IS NULL OR p.suppressed = 0 OR p.suppressed = '')
      AND p.lifecycleStatus != 'dead'
    ORDER BY pbs.portableAir DESC, p.priority DESC
    LIMIT 50
  `);

  console.log('TOP 30 WA PROJECTS (by PA score) WITH CONTACT STATUS:\n');
  console.log('RK | ID     | NAME                                          | PRI  | PA  | CONTACTS | VERIFIED | DIGEST | SOURCE');
  console.log('---|--------|-----------------------------------------------|------|-----|----------|----------|--------|-------');
  
  for (let i = 0; i < Math.min(30, topProjects.length); i++) {
    const p = topProjects[i];
    const name = (p.name || '').padEnd(47).slice(0, 47);
    const pri = (p.priority || '').padEnd(4).slice(0, 4);
    const pa = String(p.paScore || 0).padStart(3);
    const contacts = String(p.contactCount || 0).padStart(8);
    const verified = String(p.verifiedCount || 0).padStart(8);
    const digest = p.digestSafeCount > 0 ? 'YES' : 'NO ';
    const source = (p.sourcePurpose || 'unknown').padEnd(6).slice(0, 6);
    console.log(`${String(i + 1).padStart(2)} | ${String(p.id).padStart(6)} | ${name} | ${pri} | ${pa} | ${contacts} | ${verified} | ${digest}    | ${source}`);
  }
  console.log('');

  // Get contact details for top 10 projects
  console.log('TOP 10 PROJECTS — CONTACT DETAILS:\n');
  for (const p of topProjects.slice(0, 10)) {
    const [contacts]: any = await conn.query(`
      SELECT id, name, title, company, email, verificationStatus, linkedinUrl, roleRelevance
      FROM contacts 
      WHERE projectId = ?
      ORDER BY roleRelevance DESC
      LIMIT 3
    `, [p.id]);
    
    console.log(`[${p.id}] ${p.name} (PA: ${p.paScore || 0}, ${p.priority})`);
    if (contacts.length === 0) {
      console.log(`  → NO CONTACTS`);
    } else {
      for (const c of contacts) {
        const verified = c.verificationStatus === 'verified' ? '✓' : '?';
        console.log(`  → ${verified} ${c.name} | ${c.title || 'n/a'} | ${c.company || 'n/a'} | ${c.email ? 'has email' : 'no email'}`);
      }
    }
    console.log('');
  }

  // Summary stats
  const withContacts = topProjects.filter((p: any) => p.contactCount > 0).length;
  const withVerified = topProjects.filter((p: any) => p.verifiedCount > 0).length;
  const withDigestSafe = topProjects.filter((p: any) => p.digestSafeCount > 0).length;
  
  console.log('=== CONTACT CONVERSION SUMMARY (top 50 by PA score) ===');
  console.log(`  Projects with any contacts:    ${withContacts}/50`);
  console.log(`  Projects with verified contacts: ${withVerified}/50`);
  console.log(`  Projects with digestSafe gate:  ${withDigestSafe}/50`);
  console.log('');

  // Discovery status breakdown
  const [discoveryStats]: any = await conn.query(`
    SELECT discoveryStatus, COUNT(*) as cnt FROM projects 
    WHERE projectState IN ('WA', 'OFFSHORE_AU')
      AND (suppressed IS NULL OR suppressed = 0 OR suppressed = '')
      AND lifecycleStatus != 'dead'
    GROUP BY discoveryStatus
    ORDER BY cnt DESC
  `);
  console.log('=== DISCOVERY STATUS BREAKDOWN ===');
  for (const d of discoveryStats) {
    console.log(`  ${d.discoveryStatus || 'null'}: ${d.cnt}`);
  }

  await conn.end();
}
main().catch(e => { console.error(e); process.exit(1); });
