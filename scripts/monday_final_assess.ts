/**
 * Monday Final Assessment — visible digest state for 5 priority reps
 * Uses raw mysql2 to avoid drizzle-orm query issues
 */
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL as string);

  // 1. Get rep profiles
  const [reps] = await conn.execute(`
    SELECT u.id, u.name, up.territories, up.assignedBusinessLines
    FROM users u
    JOIN userProfiles up ON up.userId = u.id
    WHERE u.name IN ('Ryan Pemberton', 'Brett Hansen', 'Amit Bhargava', 'Daniel Zec', 'Dan Day')
  `) as any[];

  // 2. Get digestSafe project IDs
  const [safeGates] = await conn.execute(`
    SELECT projectId FROM projectValidationGates WHERE digestSafe = 1
  `) as any[];
  const digestSafeIds = new Set(safeGates.map((g: any) => g.projectId));

  // 3. Get all non-suppressed projects with BL scores and contacts
  const [allProjects] = await conn.execute(`
    SELECT p.id, p.name, p.projectState, p.priority, p.suppressed, p.owner,
           p.actionTier
    FROM projects p
    WHERE p.suppressed = 0
  `) as any[];

  // 4. Get BL scores
  const [blScores] = await conn.execute(`
    SELECT projectId, scoringDimension as dimension, score FROM projectBusinessLineScores
  `) as any[];
  const scoreMap = new Map<number, Map<string, number>>();
  for (const s of blScores) {
    if (!scoreMap.has(s.projectId)) scoreMap.set(s.projectId, new Map());
    scoreMap.get(s.projectId)!.set(s.dimension, s.score);
  }

  // 5. Get send_ready contacts per project
  const [contacts] = await conn.execute(`
    SELECT c.project, c.name as contactName, c.title, c.company, c.email, c.linkedin,
           c.contactTrustTier, c.roleRelevance, c.enrichmentSource
    FROM contacts c
    WHERE c.contactTrustTier = 'send_ready'
      AND c.roleRelevance IN ('high', 'medium')
    ORDER BY c.project, c.roleRelevance
  `) as any[];
  const contactsByProject = new Map<string, any[]>();
  for (const c of contacts) {
    if (!contactsByProject.has(c.project)) contactsByProject.set(c.project, []);
    contactsByProject.get(c.project)!.push(c);
  }

  // BL dimension mapping (mirrors emailDigest.ts BL_TO_DIMENSION_MAP)
  const BL_MAP: Record<string, string[]> = {
    "Portable Air": ["Portable Air"],
    "PAL": ["PAL", "Generators"],
    "BESS": ["BESS"],
    "Pump (Flow)": ["Pump/Dewatering"],
    "Pump/Flow": ["Pump/Dewatering"],
    "Pump": ["Pump/Dewatering"],
    "Dewatering Pumps": ["Pump/Dewatering"],
    "Pump/Dewatering": ["Pump/Dewatering"],
    "Nitrogen": ["Nitrogen"],
    "Booster": ["Booster"],
    "Generators": ["Generators"],
    "PT Capital Sales": ["Portable Air", "PAL", "BESS", "Pump/Dewatering", "Generators", "Nitrogen", "Booster"],
    "PT All Capital Sales": ["Portable Air", "PAL", "BESS", "Pump/Dewatering", "Generators", "Nitrogen", "Booster"],
    "Capital Sales": ["Portable Air", "PAL", "BESS", "Pump/Dewatering", "Generators", "Nitrogen", "Booster"],
    "All Capital Sales": ["Portable Air", "PAL", "BESS", "Pump/Dewatering", "Generators", "Nitrogen", "Booster"],
  };

  console.log('# PART A — Monday Visible Digest Assessment\n');

  for (const rep of reps) {
    let terr: string[];
    const rawTerr = Buffer.isBuffer(rep.territories) ? rep.territories.toString() : rep.territories;
    try { terr = JSON.parse(rawTerr); } catch { terr = [String(rawTerr)]; }
    terr = terr.map(t => String(t));
    let bls: string[];
    const rawBls = Buffer.isBuffer(rep.assignedBusinessLines) ? rep.assignedBusinessLines.toString() : String(rep.assignedBusinessLines);
    try {
      const parsed = JSON.parse(rawBls);
      bls = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
    } catch {
      // Not valid JSON — treat as comma-separated string
      bls = rawBls.split(',').map((b: string) => b.trim()).filter(Boolean);
    }

    // Resolve dimensions
    const dimensions = new Set<string>();
    for (const bl of bls) {
      const mapped = BL_MAP[bl] || [bl];
      mapped.forEach(d => dimensions.add(d));
    }

    // Filter projects: territory match + BL score > 0 + not suppressed
    const isNational = terr.some(t => t.toUpperCase() === 'NATIONAL') || terr.length >= 6;
    if (rep.name === 'Ryan Pemberton') {
    }
    const matchedProjects = allProjects.filter((p: any) => {
      // Territory check
      if (!isNational) {
        const pState = (p.projectState || '').toUpperCase();
        if (pState && !terr.map(t => t.toUpperCase()).includes(pState)) return false;
      }
      // BL check
      const projScores = scoreMap.get(p.id);
      if (!projScores) return false;
      let hasLane = false;
      for (const dim of dimensions) {
        if ((projScores.get(dim) || 0) >= 50) { hasLane = true; break; }
      }
      if (!hasLane) return false;
      // Visibility check
      // no visibilityTier column; suppressed flag handles this
      return true;
    });

    // Classify: action_ready (has send_ready contact) vs discovery_needed
    const actionReady: any[] = [];
    const discoveryNeeded: any[] = [];
    for (const p of matchedProjects) {
      const pContacts = contactsByProject.get(p.name) || [];
      if (pContacts.length > 0) {
        actionReady.push({ ...p, bestContact: pContacts[0], contactCount: pContacts.length });
      } else {
        discoveryNeeded.push(p);
      }
    }

    // Sort action_ready by priority (hot > warm > cold) then by digestSafe
    const prioOrder: Record<string, number> = { hot: 0, warm: 1, cold: 2 };
    actionReady.sort((a, b) => {
      const pa = prioOrder[a.priority] ?? 2;
      const pb = prioOrder[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      const aDS = digestSafeIds.has(a.id) ? 0 : 1;
      const bDS = digestSafeIds.has(b.id) ? 0 : 1;
      return aDS - bDS;
    });

    // Visible top 3 (Must Act) = action_ready.slice(0, 3)
    const topActions = actionReady.slice(0, 3);
    const topDiscovery = discoveryNeeded.slice(0, 2);

    // Count digestSafe in territory
    const digestSafeInTerritory = topActions.filter(p => digestSafeIds.has(p.id)).length;

    // Determine bucket
    const srInTop3 = topActions.length;
    let bucket: string;
    let reason: string;
    if (srInTop3 >= 2 && digestSafeInTerritory >= 2) {
      bucket = 'SEND';
      reason = `${srInTop3}/3 Must Act have send_ready contacts, ${digestSafeInTerritory} digestSafe`;
    } else if (srInTop3 >= 1) {
      bucket = 'PREVIEW ONLY';
      reason = `Only ${srInTop3}/3 Must Act with send_ready (need 2+), ${digestSafeInTerritory} digestSafe`;
    } else {
      bucket = 'HOLD';
      reason = `0/3 Must Act have send_ready contacts`;
    }

    console.log(`## ${rep.name} — ${bls.join(', ')} (${isNational ? 'National' : terr.join('/')})`);
    console.log(`**Bucket: ${bucket}** | Reason: ${reason}`);
    console.log(`Pool: ${matchedProjects.length} total | ${actionReady.length} action_ready | ${discoveryNeeded.length} discovery_needed\n`);

    console.log('### Must Act (Top 3 action_ready)');
    console.log('| # | Project | State | Contact | Email | DigestSafe | Commercial |');
    console.log('|---|---------|-------|---------|-------|------------|------------|');
    for (let i = 0; i < 3; i++) {
      const p = topActions[i];
      if (!p) {
        console.log(`| ${i+1} | — | — | — | — | — | — |`);
      } else {
        const ds = digestSafeIds.has(p.id) ? '✅' : '❌';
        const commercial = p.bestContact?.email ? '**strong**' : 'weak';
        console.log(`| ${i+1} | ${p.name.substring(0,50)} | ${p.projectState || '?'} | ${p.bestContact?.contactName || '—'} | ${p.bestContact?.email ? '✅' : '❌'} | ${ds} | ${commercial} |`);
      }
    }

    console.log('\n### Discovery Needed (Top 2)');
    console.log('| # | Project | State | Owner |');
    console.log('|---|---------|-------|-------|');
    for (let i = 0; i < 2; i++) {
      const p = topDiscovery[i];
      if (!p) break;
      console.log(`| ${i+1} | ${p.name.substring(0,50)} | ${p.projectState || '?'} | ${(p.owner || '?').substring(0,30)} |`);
    }

    console.log('\n### Backup action_ready (4-8)');
    for (let i = 3; i < Math.min(8, actionReady.length); i++) {
      const p = actionReady[i];
      console.log(`  ${i+1}. ${p.name.substring(0,50)} | ${p.bestContact?.contactName} | ${p.bestContact?.email ? 'email' : 'no-email'}`);
    }
    console.log('\n---\n');
  }

  // Summary table
  console.log('\n# SUMMARY TABLE\n');
  console.log('| Rep | Lane | Territory | Bucket | Must Act SR | DigestSafe | Reason |');
  console.log('|-----|------|-----------|--------|-------------|------------|--------|');
  for (const rep of reps) {
    let terr: string[];
    const rawTerr = Buffer.isBuffer(rep.territories) ? rep.territories.toString() : rep.territories;
    try { terr = JSON.parse(rawTerr); } catch { terr = [String(rawTerr)]; }
    terr = terr.map(t => String(t));
    let bls: string[];
    const rawBls = Buffer.isBuffer(rep.assignedBusinessLines) ? rep.assignedBusinessLines.toString() : String(rep.assignedBusinessLines);
    try {
      const parsed = JSON.parse(rawBls);
      bls = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
    } catch {
      // Not valid JSON — treat as comma-separated string
      bls = rawBls.split(',').map((b: string) => b.trim()).filter(Boolean);
    }
    const dimensions = new Set<string>();
    for (const bl of bls) {
      const mapped = BL_MAP[bl] || [bl];
      mapped.forEach(d => dimensions.add(d));
    }
    const isNational = terr.some(t => t.toUpperCase() === 'NATIONAL') || terr.length >= 6;
    const matchedProjects = allProjects.filter((p: any) => {
      if (!isNational) {
        const pState = (p.projectState || '').toUpperCase();
        if (pState && !terr.map(t => t.toUpperCase()).includes(pState)) return false;
      }
      const projScores = scoreMap.get(p.id);
      if (!projScores) return false;
      let hasLane = false;
      for (const dim of dimensions) {
        if ((projScores.get(dim) || 0) >= 50) { hasLane = true; break; }
      }
      if (!hasLane) return false;
      // no visibilityTier column; suppressed flag handles this
      return true;
    });
    const actionReady = matchedProjects.filter((p: any) => (contactsByProject.get(p.name) || []).length > 0);
    actionReady.sort((a: any, b: any) => {
      const pa = (a.priority === 'hot' ? 0 : a.priority === 'warm' ? 1 : 2);
      const pb = (b.priority === 'hot' ? 0 : b.priority === 'warm' ? 1 : 2);
      if (pa !== pb) return pa - pb;
      return (digestSafeIds.has(a.id) ? 0 : 1) - (digestSafeIds.has(b.id) ? 0 : 1);
    });
    const topActions = actionReady.slice(0, 3);
    const srInTop3 = topActions.length;
    const dsInTop3 = topActions.filter((p: any) => digestSafeIds.has(p.id)).length;
    let bucket = srInTop3 >= 2 && dsInTop3 >= 2 ? 'SEND' : srInTop3 >= 1 ? 'PREVIEW ONLY' : 'HOLD';
    console.log(`| ${rep.name} | ${bls[0]} | ${isNational ? 'National' : terr.join('/')} | **${bucket}** | ${srInTop3}/3 | ${dsInTop3}/3 | ${srInTop3 >= 2 ? 'Threshold met' : srInTop3 >= 1 ? 'Need more SR contacts' : 'No SR contacts in top'} |`);
  }

  await conn.end();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
