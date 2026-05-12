import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ── Real computePumpActionMode (mirrors laneScoring.ts) ──
function computePumpActionMode(project, contacts, pumpBLScore, accountPriorMatch) {
  const projStage = (project.stage || '').toLowerCase();
  const hasPumpContact = contacts.some(c =>
    c.contactTrustTier === 'send_ready' &&
    (c.roleRelevance === 'high' || c.roleRelevance === 'medium')
  );
  const isAwarded = ['awarded', 'construction'].some(s => projStage.includes(s));
  const contractors = Array.isArray(project.contractors) ? project.contractors : [];
  const hasContractorInfo = contractors.length > 0;
  const overviewLower = (project.overview || '').toLowerCase();
  const isEarlyStage = ['feasibility', 'exploration', 'scoping', 'concept'].some(s => projStage.includes(s));
  const hasPumpWaterContext = /water|dewater|pump|excavat|tunnel|marine|dredg|flood|sewer|dam|bore|wellpoint|cofferdam|trench|slurry/.test(overviewLower);

  if (pumpBLScore >= 60 && hasPumpContact && !isEarlyStage) return 'direct_pursue';
  if (isAwarded && hasContractorInfo && hasPumpWaterContext) return 'map_package';
  if (pumpBLScore >= 40 && !hasPumpContact && !isEarlyStage) return 'find_site_contact';
  if (accountPriorMatch && !hasPumpContact && !isAwarded) return 'account_nurture';
  if (isEarlyStage || pumpBLScore < 30) return 'reference_only';
  return 'find_site_contact';
}

async function getTopProjects(territories, limit = 5) {
  const placeholders = territories.map(() => '?').join(',');
  const [rows] = await conn.execute(`
    SELECT DISTINCT
      p.id, p.name, p.location, p.stage, p.owner, p.overview, p.contractors,
      pbl.score as pumpScore, pbl.explanation as pumpExplanation
    FROM projects p
    JOIN projectBusinessLineScores pbl ON pbl.projectId = p.id
    WHERE pbl.scoringDimension = 'Pump/Dewatering'
    AND pbl.score >= 50
    AND (p.suppressed IS NULL OR p.suppressed = 0)
    AND (${territories.map(() => 'p.location LIKE ?').join(' OR ')})
    ORDER BY pbl.score DESC, p.id
    LIMIT ${limit * 3}
  `, territories.map(t => `%${t}%`));
  return rows;
}

async function getContactsForProject(projectId) {
  const [rows] = await conn.execute(`
    SELECT c.id, c.name, c.title, c.email, c.linkedin, c.company,
           c.contactTrustTier, c.roleRelevance, c.roleBucket, c.rejectionReason
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    WHERE cp.projectId = ?
    AND c.rejectionReason IS NULL
    ORDER BY 
      CASE c.contactTrustTier WHEN 'send_ready' THEN 1 WHEN 'named_unverified' THEN 2 ELSE 3 END,
      CASE c.roleRelevance WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      c.id
  `, [projectId]);
  return rows;
}

async function buildRepProof(name, territories, limit = 5) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`REP: ${name}`);
  console.log(`Territories: ${territories.join(', ')}`);
  console.log(`${'='.repeat(70)}`);

  const projects = await getTopProjects(territories, limit);

  let shown = 0;
  for (const p of projects) {
    if (shown >= limit) break;
    const contacts = await getContactsForProject(p.id);
    const contractors = (() => { try { return JSON.parse(p.contractors || '[]'); } catch { return []; } })();
    const actionMode = computePumpActionMode(
      { stage: p.stage, overview: p.overview, contractors },
      contacts,
      p.pumpScore,
      null
    );

    console.log(`\n--- Project ${shown + 1} ---`);
    console.log(`ID:          ${p.id}`);
    console.log(`Name:        ${p.name}`);
    console.log(`Location:    ${p.location}`);
    console.log(`Stage:       ${p.stage}`);
    console.log(`Pump Score:  ${p.pumpScore}`);
    console.log(`Action Mode: ${actionMode}`);
    console.log(`Contacts (${contacts.length} active):`);

    if (contacts.length === 0) {
      console.log('  ⚠️  ZERO active contacts — needs enrichment');
    } else {
      contacts.slice(0, 4).forEach((c, i) => {
        const marker = i === 0 ? '★ PRIMARY' : `  ${i + 1}.     `;
        console.log(`  ${marker} ${c.name} | ${c.title}`);
        console.log(`           Trust: ${c.contactTrustTier} | RoleRelevance: ${c.roleRelevance} | Email: ${c.email || 'none'}`);
      });
      if (contacts.length > 4) console.log(`  ... +${contacts.length - 4} more`);
    }

    // Usability verdict
    const sendReadyCount = contacts.filter(c => c.contactTrustTier === 'send_ready').length;
    const hasPumpContact = contacts.some(c => c.contactTrustTier === 'send_ready' && (c.roleRelevance === 'high' || c.roleRelevance === 'medium'));
    let verdict;
    if (actionMode === 'direct_pursue' && sendReadyCount >= 1) {
      verdict = '✅ COMMERCIALLY USABLE — direct pursue, send_ready contact exists';
    } else if (actionMode === 'direct_pursue' && sendReadyCount === 0) {
      verdict = '⚠️  direct_pursue mode but no send_ready contact — check roleRelevance';
    } else if (contacts.length === 0) {
      verdict = '❌ NOT USABLE — zero contacts, enrichment required';
    } else if (sendReadyCount === 0) {
      verdict = '⚠️  WEAK — contacts exist but none are send_ready';
    } else {
      verdict = `⚠️  ${actionMode} — ${sendReadyCount} send_ready contact(s), not yet direct_pursue`;
    }
    console.log(`Verdict:     ${verdict}`);
    shown++;
  }
}

// ── Brett Hansen: WA + NT ──
await buildRepProof('Brett Hansen', ['WA', 'NT'], 5);

// ── Dan Day: QLD + NSW + VIC + SA + TAS ──
await buildRepProof('Dan Day', ['QLD', 'NSW', 'VIC', 'SA', 'TAS'], 5);

await conn.end();
