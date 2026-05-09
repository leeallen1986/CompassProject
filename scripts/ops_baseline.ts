import mysql from 'mysql2/promise';

/**
 * PART 1 — Pre-Sunday Baseline Snapshot
 * Read-only. No mutations.
 * Captures current Monday digest state for 5 target reps.
 */

const TARGET_REPS = [
  'Ryan Pemberton',
  'Brett Hansen',
  'Daniel Zec',
  'Dan Day',
  'Amit Bhargava',
];

// BL → scoring dimension map (matches emailDigest.ts)
const BL_MAP: Record<string, string[]> = {
  'Portable Air': ['Portable Air'],
  'PT Capital Sales': ['Portable Air', 'Generators', 'PAL', 'Pump/Dewatering', 'BESS'],
  'Pump (Flow)': ['Pump/Dewatering'],
  'PAL': ['PAL', 'Generators', 'BESS'],
  'BESS': ['BESS'],
  'Generators': ['Generators'],
  'Service': ['Service Potential'],
};

function parseBLs(raw: any): string[] {
  if (!raw) return [];
  const str = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString() : String(raw);
  // Try JSON array first
  try {
    const arr = JSON.parse(str);
    if (Array.isArray(arr)) return arr.map((s: string) => s.trim());
  } catch {}
  // Comma-separated
  return str.split(',').map((s: string) => s.trim()).filter(Boolean);
}

function parseTerritories(raw: any): string[] {
  if (!raw) return [];
  const str = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString() : String(raw);
  try {
    const arr = JSON.parse(str);
    if (Array.isArray(arr)) return arr.map((s: string) => s.trim().toUpperCase());
  } catch {}
  return str.split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean);
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL as string);

  // Get rep profiles (name is on users table, not userProfiles)
  const [reps] = await conn.execute(
    `SELECT up.id, u.name, up.assignedBusinessLines, up.territories 
     FROM userProfiles up 
     JOIN users u ON u.id = up.userId 
     WHERE u.name IN (${TARGET_REPS.map(() => '?').join(',')})`,
    TARGET_REPS
  ) as any[];

  // Get all digestSafe project IDs
  const [digestSafeRows] = await conn.execute(
    `SELECT projectId FROM projectValidationGates WHERE digestSafe = 1`
  ) as any[];
  const digestSafeIds = new Set(digestSafeRows.map((r: any) => r.projectId));

  // Get all action_ready projects with their scores and contacts
  const [allProjects] = await conn.execute(
    `SELECT p.id, p.name as projectName, p.projectState, p.priority, p.sector,
            p.projectType, p.lifecycleStatus, p.suppressed, p.actionTier
     FROM projects p
     WHERE p.projectType = 'opportunity'
       AND (p.suppressed IS NULL OR p.suppressed = 0)
       AND (p.lifecycleStatus IS NULL OR p.lifecycleStatus NOT IN ('archived', 'duplicate'))
     ORDER BY p.priority DESC, p.id`
  ) as any[];

  // Get BL scores for all projects
  const [allScores] = await conn.execute(
    `SELECT projectId, scoringDimension, score FROM projectBusinessLineScores WHERE score >= 50`
  ) as any[];
  const scoreMap = new Map<number, Map<string, number>>();
  for (const s of allScores) {
    if (!scoreMap.has(s.projectId)) scoreMap.set(s.projectId, new Map());
    scoreMap.get(s.projectId)!.set(s.scoringDimension, s.score);
  }

  // Get contacts for all projects (send_ready + named_unverified, high/medium relevance)
  const [allContacts] = await conn.execute(
    `SELECT id, name, title, company, email, contactTrustTier, roleRelevance, 
            enrichmentSource, project, verificationScore
     FROM contacts 
     WHERE roleRelevance IN ('high', 'medium')
       AND contactTrustTier IN ('send_ready', 'named_unverified')
     ORDER BY 
       CASE WHEN contactTrustTier = 'send_ready' THEN 0 ELSE 1 END,
       verificationScore DESC`
  ) as any[];

  // Index contacts by project name
  const contactsByProject = new Map<string, any[]>();
  for (const c of allContacts) {
    if (!contactsByProject.has(c.project)) contactsByProject.set(c.project, []);
    contactsByProject.get(c.project)!.push(c);
  }

  console.log('# PART 1 — Pre-Sunday Baseline Snapshot');
  console.log(`**Timestamp:** ${new Date().toISOString()}`);
  console.log(`**Total projects:** ${allProjects.length}`);
  console.log(`**DigestSafe projects:** ${digestSafeIds.size}`);
  console.log(`**Send_ready contacts in pool:** ${allContacts.filter((c: any) => c.contactTrustTier === 'send_ready').length}`);
  console.log('');

  for (const rep of reps) {
    const bls = parseBLs(rep.assignedBusinessLines);
    const territories = parseTerritories(rep.territories);
    
    // Resolve which scoring dimensions this rep cares about
    const repDimensions = new Set<string>();
    for (const bl of bls) {
      const dims = BL_MAP[bl] || [bl];
      dims.forEach(d => repDimensions.add(d));
    }

    // Filter projects by territory
    const territoryFiltered = allProjects.filter((p: any) => {
      if (territories.includes('NATIONAL') || territories.length === 0) return true;
      if (!p.projectState || p.projectState === '') return true; // NULL state = national
      const state = p.projectState.toUpperCase();
      return territories.some(t => state.includes(t));
    });

    // Filter by BL score (at least one dimension >= 50)
    const blFiltered = territoryFiltered.filter((p: any) => {
      const scores = scoreMap.get(p.id);
      if (!scores) return false;
      for (const dim of repDimensions) {
        if ((scores.get(dim) || 0) >= 50) return true;
      }
      return false;
    });

    // Sort by priority + digestSafe + contact availability
    const ranked = blFiltered.map((p: any) => {
      const contacts = contactsByProject.get(p.projectName) || [];
      const sendReady = contacts.filter((c: any) => c.contactTrustTier === 'send_ready');
      const namedUnverified = contacts.filter((c: any) => c.contactTrustTier === 'named_unverified');
      const isDigestSafe = digestSafeIds.has(p.id);
      const priorityScore = p.priority === 'hot' ? 3 : p.priority === 'warm' ? 2 : 1;
      const contactScore = sendReady.length > 0 ? 2 : namedUnverified.length > 0 ? 1 : 0;
      return {
        ...p,
        contacts,
        sendReady,
        namedUnverified,
        isDigestSafe,
        rankScore: priorityScore * 10 + contactScore * 3 + (isDigestSafe ? 5 : 0),
      };
    }).sort((a: any, b: any) => b.rankScore - a.rankScore);

    // Determine bucket
    const top3 = ranked.slice(0, 3);
    const top3WithSR = top3.filter((p: any) => p.sendReady.length > 0);
    const top3DigestSafe = top3.filter((p: any) => p.isDigestSafe);
    
    let bucket = 'HOLD';
    if (top3WithSR.length >= 2 && top3DigestSafe.length >= 2) {
      bucket = 'SEND';
    } else if (top3WithSR.length >= 1) {
      bucket = 'PREVIEW';
    }

    console.log(`---`);
    console.log(`## ${rep.name}`);
    console.log(`**BLs:** ${bls.join(', ')} → Dimensions: ${[...repDimensions].join(', ')}`);
    console.log(`**Territories:** ${territories.join(', ')}`);
    console.log(`**Pool:** ${ranked.length} projects`);
    console.log(`**Bucket:** ${bucket}`);
    console.log('');

    // Top 5 Must Act
    console.log('### Top 5 Must Act');
    console.log('| # | Project | Priority | DigestSafe | SR Contacts | Named | None | State |');
    console.log('|---|---------|----------|------------|-------------|-------|------|-------|');
    for (let i = 0; i < Math.min(5, ranked.length); i++) {
      const p = ranked[i];
      const contactStatus = p.sendReady.length > 0 ? `${p.sendReady.length} SR` : p.namedUnverified.length > 0 ? `${p.namedUnverified.length} named` : 'NONE';
      console.log(`| ${i+1} | ${p.projectName.substring(0, 55)} | ${p.priority} | ${p.isDigestSafe ? '✓' : '✗'} | ${p.sendReady.length} | ${p.namedUnverified.length} | ${p.sendReady.length === 0 && p.namedUnverified.length === 0 ? 'YES' : '-'} | ${p.projectState || 'National'} |`);
    }
    console.log('');

    // Top 3 visible contacts
    console.log('### Top 3 Visible Contacts');
    console.log('| Project | Contact | Title | Company | Trust | Source | Score |');
    console.log('|---------|---------|-------|---------|-------|--------|-------|');
    let contactCount = 0;
    for (const p of top3) {
      if (contactCount >= 3) break;
      const bestContact = p.sendReady[0] || p.namedUnverified[0];
      if (bestContact) {
        console.log(`| ${p.projectName.substring(0, 40)} | ${bestContact.name} | ${(bestContact.title || '').substring(0, 35)} | ${bestContact.company} | ${bestContact.contactTrustTier} | ${bestContact.enrichmentSource} | ${bestContact.verificationScore || '-'} |`);
        contactCount++;
      } else {
        console.log(`| ${p.projectName.substring(0, 40)} | **NO CONTACT** | - | - | - | - | - |`);
        contactCount++;
      }
    }
    console.log('');

    // Weak items
    const weakItems: string[] = [];
    for (const p of top3) {
      if (p.sendReady.length === 0 && p.namedUnverified.length === 0) {
        weakItems.push(`${p.projectName}: NO CONTACTS AT ALL`);
      } else if (p.sendReady.length === 0) {
        weakItems.push(`${p.projectName}: only named_unverified (no email)`);
      }
      if (!p.isDigestSafe) {
        weakItems.push(`${p.projectName}: NOT digestSafe`);
      }
      // Check for generic/weak contacts
      const best = p.sendReady[0] || p.namedUnverified[0];
      if (best && best.enrichmentSource === 'llm_inferred') {
        weakItems.push(`${p.projectName}: primary contact is llm_inferred (${best.name})`);
      }
      if (best && best.company && /university|school|hospital/i.test(best.company)) {
        weakItems.push(`${p.projectName}: non-industrial contact (${best.company})`);
      }
    }
    if (weakItems.length > 0) {
      console.log('### Weak Items');
      for (const w of weakItems) {
        console.log(`- ⚠️ ${w}`);
      }
    } else {
      console.log('### Weak Items');
      console.log('- None identified');
    }
    console.log('');
  }

  await conn.end();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
