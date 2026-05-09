/**
 * Monday Readiness Assessment — Batch SQL approach
 * Determines SEND / PREVIEW ONLY / HOLD for each rep
 */
import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

const JUNK_PATTERNS = [
  { pattern: /\bschool\b/i, label: 'school' },
  { pattern: /\bcollege\b/i, label: 'college' },
  { pattern: /\buniversity\b/i, label: 'university' },
  { pattern: /\bhospital\b/i, label: 'hospital' },
  { pattern: /\bhealth\s*(centre|center|facility|precinct)\b/i, label: 'health facility' },
  { pattern: /\bprison\b/i, label: 'prison' },
  { pattern: /\bcorrection/i, label: 'corrections' },
  { pattern: /\bdetention\b/i, label: 'detention' },
  { pattern: /\bpolice\s*station/i, label: 'police station' },
  { pattern: /\bfire\s*station/i, label: 'fire station' },
  { pattern: /\bcommunity\s*(centre|center|hall|facility)\b/i, label: 'community facility' },
  { pattern: /\blibrary\b/i, label: 'library' },
  { pattern: /\bmuseum\b/i, label: 'museum' },
  { pattern: /\bparking\b/i, label: 'parking' },
  { pattern: /\bbike\s*(path|lane)\b/i, label: 'bike path' },
  { pattern: /\bplayground\b/i, label: 'playground' },
  { pattern: /\bconsulting\s*only\b/i, label: 'consulting only' },
  { pattern: /\bfeasibility\s*study\b/i, label: 'feasibility study' },
  { pattern: /\bmaster\s*plan\b/i, label: 'master plan' },
  { pattern: /\bdata\s*cent(re|er)\b/i, label: 'data centre' },
  { pattern: /\boffice\s*fit\s*out/i, label: 'office fit-out' },
];

function checkJunk(name: string, overview: string): { junk: boolean; reason: string } {
  const text = `${name} ${overview}`;
  for (const { pattern, label } of JUNK_PATTERNS) {
    if (pattern.test(text)) return { junk: true, reason: label };
  }
  return { junk: false, reason: '' };
}

// Gate logic
const PUMP_POSITIVE = /dewater|pump|slurr|tailings|groundwater|stormwater|flood|drainage|sump|borehole|bore field|water treatment|sewage|sewerage|wastewater|effluent|desalin|reverse osmosis|membrane|filtration|irrigation|aquifer|hydro test|hydrostatic|pipeline pig|pigging/i;
const BESS_POSITIVE = /bess|battery energy storage|battery storage|energy storage system|pumped hydro|pumped storage|grid.scale battery|utility.scale battery|vanadium redox|lithium.ion battery|flow battery|flywheel energy|compressed air energy|gravity energy|hydrogen storage|green hydrogen|electrolyser|electrolysis/i;
const PAL_POSITIVE = /generator|genset|lighting tower|light tower|power rental|temporary power|mobile power|portable power|standby power|emergency power|backup power|prime power|continuous power|load bank|power station rental|containerised power|modular power/i;

function gatePass(name: string, overview: string, lane: string, blScore: number): boolean {
  const text = `${name} ${overview}`;
  if (lane === 'portable_air') return blScore >= 50;
  if (lane === 'pump_dewatering') return PUMP_POSITIVE.test(text) || blScore >= 80;
  if (lane === 'pal_bess') return BESS_POSITIVE.test(text) || PAL_POSITIVE.test(text) || blScore >= 80;
  return blScore >= 50;
}

function resolveProfile(territories: any, assignedBL: any) {
  let terrs: string[] = [];
  if (territories) {
    const s = typeof territories === 'string' ? territories : Buffer.isBuffer(territories) ? territories.toString() : JSON.stringify(territories);
    try { terrs = JSON.parse(s); } catch { terrs = s.split(',').map((t: string) => t.trim()); }
  }
  let bls: string[] = [];
  if (assignedBL) {
    const s = typeof assignedBL === 'string' ? assignedBL : Buffer.isBuffer(assignedBL) ? assignedBL.toString() : JSON.stringify(assignedBL);
    try { bls = JSON.parse(s); } catch { bls = s.split(',').map((b: string) => b.trim()); }
  }
  let primaryDimension = 'Portable Air';
  let gateLane = 'portable_air';
  const blLower = bls.map(b => b.toLowerCase());
  if (blLower.some(b => b.includes('pump') || b.includes('dewater'))) {
    primaryDimension = 'Pump/Dewatering'; gateLane = 'pump_dewatering';
  } else if (blLower.some(b => b.includes('bess') || b.includes('battery'))) {
    primaryDimension = 'BESS'; gateLane = 'pal_bess';
  } else if (blLower.some(b => b.includes('pal') || b.includes('generator') || b.includes('lighting'))) {
    primaryDimension = 'PAL'; gateLane = 'pal_bess';
  }
  const isNational = terrs.length === 0 || terrs.length >= 6 || terrs.some(t => t.toUpperCase() === 'NATIONAL');
  return { territories: terrs, primaryDimension, gateLane, isNational };
}

async function main() {
  const db = drizzle(process.env.DATABASE_URL as string);

  // 1. Get all reps
  const repsResult = await db.execute(sql`
    SELECT u.id, u.name, up.territories, up.assignedBusinessLines
    FROM users u LEFT JOIN userProfiles up ON up.userId = u.id
    WHERE u.name IS NOT NULL AND u.name != '' ORDER BY u.name
  `);
  const reps = repsResult[0] as any[];

  // 2. Get ALL scored projects with BL scores (batch)
  const allProjectsResult = await db.execute(sql`
    SELECT p.id, p.name, p.overview, p.sector, p.projectState, p.priority, p.owner, p.suppressed,
           pbs.scoringDimension, pbs.score as blScore
    FROM projects p
    JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
    WHERE p.suppressed = 0 AND pbs.score >= 50
    ORDER BY pbs.score DESC
  `);
  const allProjects = allProjectsResult[0] as any[];

  // 3. Get ALL contacts with trust tier (batch)
  const allContactsResult = await db.execute(sql`
    SELECT c.project, c.name as contactName, c.contactTrustTier, c.title, c.roleRelevance
    FROM contacts c
    WHERE c.contactTrustTier IN ('send_ready', 'named_unverified')
      AND c.roleRelevance IN ('high', 'medium')
    ORDER BY 
      CASE c.contactTrustTier WHEN 'send_ready' THEN 1 ELSE 2 END,
      CASE c.roleRelevance WHEN 'high' THEN 1 ELSE 2 END
  `);
  const allContacts = allContactsResult[0] as any[];

  // Index contacts by project name
  const contactsByProject = new Map<string, any[]>();
  for (const c of allContacts) {
    const key = c.project;
    if (!contactsByProject.has(key)) contactsByProject.set(key, []);
    contactsByProject.get(key)!.push(c);
  }

  // Index projects by dimension
  const projectsByDimension = new Map<string, any[]>();
  for (const p of allProjects) {
    const dim = p.scoringDimension;
    if (!projectsByDimension.has(dim)) projectsByDimension.set(dim, []);
    projectsByDimension.get(dim)!.push(p);
  }

  console.log('# PART A — Monday Send Strategy by Rep\n');
  console.log('| Rep | Lane | Territory | Pool | Top 3 w/ SR | Junk in Top 5 | Bucket | Reason |');
  console.log('|-----|------|-----------|------|-------------|---------------|--------|--------|');

  const allRepResults: any[] = [];

  for (const rep of reps) {
    const profile = resolveProfile(rep.territories, rep.assignedBusinessLines);
    const terrLabel = profile.isNational ? 'National' : profile.territories.filter((t: string) => t !== 'OFFSHORE_AU').join('/');

    const dimProjects = projectsByDimension.get(profile.primaryDimension) || [];

    const candidates: any[] = [];
    for (const p of dimProjects) {
      if (candidates.length >= 30) break; // enough for assessment

      // Territory filter
      if (!profile.isNational && p.projectState) {
        if (!profile.territories.some((t: string) => t.toUpperCase() === (p.projectState || '').toUpperCase())) continue;
      }

      // Gate
      if (!gatePass(p.name || '', p.overview || '', profile.gateLane, p.blScore)) continue;

      // Contacts
      const contacts = contactsByProject.get(p.name) || [];
      const sendReadyCount = contacts.filter(c => c.contactTrustTier === 'send_ready').length;
      const namedUnverifiedCount = contacts.filter(c => c.contactTrustTier === 'named_unverified').length;
      const topContact = contacts[0] || null;

      const junkCheck = checkJunk(p.name || '', p.overview || '');

      candidates.push({
        id: p.id, name: p.name, overview: p.overview || '', sector: p.sector || '',
        projectState: p.projectState || '', priority: p.priority || '', blScore: p.blScore,
        owner: p.owner || '', sendReadyCount, namedUnverifiedCount,
        topContactName: topContact?.contactName || null,
        topContactTier: topContact?.contactTrustTier || null,
        topContactTitle: topContact?.title || null,
        isJunk: junkCheck.junk, junkReason: junkCheck.reason,
      });
    }

    const cleanCandidates = candidates.filter(c => !c.isJunk);
    const junkInTop5 = candidates.slice(0, 5).filter(c => c.isJunk);
    const top3WithSR = cleanCandidates.slice(0, 3).filter(c => c.sendReadyCount > 0);
    const top3WithAnyContact = cleanCandidates.slice(0, 3).filter(c => c.sendReadyCount > 0 || c.namedUnverifiedCount > 0);

    let bucket: string;
    let reason: string;
    if (top3WithSR.length >= 2 && cleanCandidates.length >= 5 && junkInTop5.length === 0) {
      bucket = 'SEND';
      reason = `${top3WithSR.length}/3 top have send_ready, clean pool=${cleanCandidates.length}`;
    } else if (top3WithAnyContact.length >= 1 && cleanCandidates.length >= 3) {
      bucket = 'PREVIEW ONLY';
      reason = `${top3WithSR.length}/3 SR; ${top3WithAnyContact.length}/3 any contact; pool=${cleanCandidates.length}`;
    } else {
      bucket = 'HOLD';
      reason = `${top3WithSR.length} SR in top 3, pool=${cleanCandidates.length}`;
    }

    console.log(`| ${rep.name.trim()} | ${profile.primaryDimension} | ${terrLabel} | ${cleanCandidates.length} | ${top3WithSR.length}/3 | ${junkInTop5.length} | **${bucket}** | ${reason} |`);

    allRepResults.push({
      name: rep.name.trim(), profile, terrLabel,
      candidates, cleanCandidates, junkInTop5, top3WithSR, top3WithAnyContact, bucket, reason,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // PART E — Priority Rep Review Packs
  // ═══════════════════════════════════════════════════════════════
  const priorityReps = ['Ryan Pemberton', 'Daniel Zec', 'Brett Hansen', 'Dan Day', 'Amit Bhargava'];
  console.log('\n\n# PART E — Priority Rep Review Packs\n');

  for (const repName of priorityReps) {
    const rep = allRepResults.find(r => r.name === repName);
    if (!rep) { console.log(`\n## ${repName} — NOT FOUND\n`); continue; }

    console.log(`\n## ${repName} — ${rep.profile.primaryDimension} (${rep.terrLabel})`);
    console.log(`**Monday Bucket: ${rep.bucket}**`);
    console.log(`**Reason:** ${rep.reason}\n`);

    console.log('### Must Act (Top 5)');
    console.log('| # | Project | BL | State | Contact | Tier | Commercial |');
    console.log('|---|---------|-----|-------|---------|------|------------|');
    const mustAct = rep.cleanCandidates.slice(0, 5);
    for (let i = 0; i < mustAct.length; i++) {
      const p = mustAct[i];
      const commercial = p.sendReadyCount > 0 ? '**strong**' : (p.namedUnverifiedCount > 0 ? 'acceptable' : 'weak');
      console.log(`| ${i+1} | ${p.name.substring(0,50)} | ${p.blScore} | ${p.projectState} | ${p.topContactName||'—'} | ${p.topContactTier||'—'} | ${commercial} |`);
    }

    console.log('\n### Backup (6-8)');
    console.log('| # | Project | BL | State | Contact | Tier |');
    console.log('|---|---------|-----|-------|---------|------|');
    for (let i = 5; i < Math.min(8, rep.cleanCandidates.length); i++) {
      const p = rep.cleanCandidates[i];
      console.log(`| ${i+1} | ${p.name.substring(0,50)} | ${p.blScore} | ${p.projectState} | ${p.topContactName||'—'} | ${p.topContactTier||'—'} |`);
    }

    console.log('\n### Find Contacts Candidates');
    const fc = rep.cleanCandidates.filter((c: any) => c.sendReadyCount === 0 && c.namedUnverifiedCount === 0).slice(0, 3);
    console.log('| # | Project | Owner | BL | State |');
    console.log('|---|---------|-------|-----|-------|');
    for (let i = 0; i < fc.length; i++) {
      console.log(`| ${i+1} | ${fc[i].name.substring(0,45)} | ${fc[i].owner.substring(0,25)} | ${fc[i].blScore} | ${fc[i].projectState} |`);
    }

    if (rep.junkInTop5.length > 0) {
      console.log('\n### Junk in Top 5');
      for (const j of rep.junkInTop5) console.log(`- **${j.name}** — ${j.junkReason}`);
    }

    const blockers: string[] = [];
    if (rep.top3WithSR.length < 2) blockers.push(`Only ${rep.top3WithSR.length}/3 top have send_ready`);
    if (rep.junkInTop5.length > 0) blockers.push(`${rep.junkInTop5.length} junk in top 5`);
    const noContact = rep.cleanCandidates.slice(0,3).filter((c:any) => c.sendReadyCount===0 && c.namedUnverifiedCount===0);
    if (noContact.length > 0) blockers.push(`${noContact.length}/3 top have zero contacts`);
    console.log('\n### Blockers');
    if (blockers.length === 0) console.log('None — ready for live send.');
    else blockers.forEach(b => console.log(`- ${b}`));
  }

  // ═══════════════════════════════════════════════════════════════
  // JUNK SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\n# Junk Projects Detected\n');
  const allJunk = new Map<string, { reason: string; reps: string[] }>();
  for (const rep of allRepResults) {
    for (const c of rep.candidates.filter((x: any) => x.isJunk)) {
      if (!allJunk.has(c.name)) allJunk.set(c.name, { reason: c.junkReason, reps: [rep.name] });
      else allJunk.get(c.name)!.reps.push(rep.name);
    }
  }
  if (allJunk.size > 0) {
    console.log('| Project | Reason | Affected Reps |');
    console.log('|---------|--------|---------------|');
    for (const [name, info] of allJunk) {
      console.log(`| ${name.substring(0,50)} | ${info.reason} | ${info.reps.join(', ')} |`);
    }
  } else {
    console.log('No junk detected in top candidate pools.');
  }

  // ═══════════════════════════════════════════════════════════════
  // ENRICHMENT TARGETS
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\n# Enrichment Targets\n');
  console.log('| Rep | Project | Owner | BL | State | Current |');
  console.log('|-----|---------|-------|-----|-------|---------|');
  for (const repName of priorityReps) {
    const rep = allRepResults.find(r => r.name === repName);
    if (!rep) continue;
    const targets = rep.cleanCandidates.filter((c: any) => c.sendReadyCount === 0).slice(0, 3);
    for (const t of targets) {
      const status = t.namedUnverifiedCount > 0 ? 'named_unverified' : 'no_contacts';
      console.log(`| ${repName} | ${t.name.substring(0,40)} | ${t.owner.substring(0,20)} | ${t.blScore} | ${t.projectState} | ${status} |`);
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
