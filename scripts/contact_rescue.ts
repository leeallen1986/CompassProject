import mysql from 'mysql2/promise';
import { enrichProjectContacts } from '../server/apolloEnrichment';
import { getDb } from '../server/db';

/**
 * PART 3 — Targeted Contact Rescue Pass
 * 
 * Rules:
 * - Only Monday-visible projects (top 3 + 2 backups per rep)
 * - No broad queue clearance
 * - No broad Lusha rollout
 * - Reserve credits for post-pipeline delta pass
 * - No llm_inferred promotion
 * 
 * Strategy:
 * 1. Identify projects where contacts are WEAK (no send_ready, or only 1 low-score contact)
 * 2. Run Apollo enrichment on those specific projects only
 * 3. Track credits used
 */

const TARGET_REPS = [
  { name: 'Ryan Pemberton', territories: ['WA'], dimensions: ['Portable Air', 'Generators', 'PAL', 'Pump/Dewatering', 'BESS'] },
  { name: 'Brett Hansen', territories: ['WA', 'NT'], dimensions: ['Portable Air', 'Pump/Dewatering'] },
  { name: 'Daniel Zec', territories: ['NSW', 'VIC', 'SA', 'TAS'], dimensions: ['Portable Air'] },
  { name: 'Dan Day', territories: ['SA', 'QLD', 'VIC', 'NSW', 'TAS'], dimensions: ['Pump/Dewatering'] },
  { name: 'Amit Bhargava', territories: ['WA', 'NSW', 'QLD', 'VIC', 'SA', 'TAS', 'NT', 'ACT'], dimensions: ['PAL', 'Generators', 'BESS'] },
];

// Budget: max 30 Apollo credits for this pass (reserve ~20 for post-pipeline delta)
const MAX_CREDITS = 30;
let creditsUsed = 0;

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL as string);

  // Get digestSafe projects
  const [digestSafeRows] = await conn.execute(
    `SELECT projectId FROM projectValidationGates WHERE digestSafe = 1`
  ) as any[];
  const digestSafeIds = new Set(digestSafeRows.map((r: any) => r.projectId));

  // Get all unsuppressed opportunity projects
  const [allProjects] = await conn.execute(
    `SELECT p.id, p.name as projectName, p.projectState, p.priority, p.sector, p.owner
     FROM projects p
     WHERE p.projectType = 'opportunity'
       AND (p.suppressed IS NULL OR p.suppressed = 0)
       AND (p.lifecycleStatus IS NULL OR p.lifecycleStatus NOT IN ('archived', 'duplicate'))
     ORDER BY p.priority DESC, p.id`
  ) as any[];

  // Get BL scores
  const [allScores] = await conn.execute(
    `SELECT projectId, scoringDimension, score FROM projectBusinessLineScores WHERE score >= 50`
  ) as any[];
  const scoreMap = new Map<number, Map<string, number>>();
  for (const s of allScores) {
    if (!scoreMap.has(s.projectId)) scoreMap.set(s.projectId, new Map());
    scoreMap.get(s.projectId)!.set(s.scoringDimension, s.score);
  }

  // Get contacts indexed by project name
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
  const contactsByProject = new Map<string, any[]>();
  for (const c of allContacts) {
    if (!contactsByProject.has(c.project)) contactsByProject.set(c.project, []);
    contactsByProject.get(c.project)!.push(c);
  }

  // For each rep, identify top 5 (3 must act + 2 backups)
  const rescueTargets: { projectId: number; projectName: string; owner: string; rep: string; reason: string; slot: string }[] = [];

  for (const rep of TARGET_REPS) {
    // Filter by territory
    const territoryFiltered = allProjects.filter((p: any) => {
      if (!p.projectState || p.projectState === '') return true;
      const state = p.projectState.toUpperCase();
      return rep.territories.some(t => state.includes(t));
    });

    // Filter by BL score
    const blFiltered = territoryFiltered.filter((p: any) => {
      const scores = scoreMap.get(p.id);
      if (!scores) return false;
      for (const dim of rep.dimensions) {
        if ((scores.get(dim) || 0) >= 50) return true;
      }
      return false;
    });

    // Rank by priority + digestSafe + contacts
    const ranked = blFiltered.map((p: any) => {
      const contacts = contactsByProject.get(p.projectName) || [];
      const sendReady = contacts.filter((c: any) => c.contactTrustTier === 'send_ready');
      const namedUnverified = contacts.filter((c: any) => c.contactTrustTier === 'named_unverified');
      const isDigestSafe = digestSafeIds.has(p.id);
      const priorityScore = p.priority === 'hot' ? 3 : p.priority === 'warm' ? 2 : 1;
      const contactScore = sendReady.length > 0 ? 2 : namedUnverified.length > 0 ? 1 : 0;
      return {
        ...p,
        sendReady,
        namedUnverified,
        isDigestSafe,
        rankScore: priorityScore * 10 + contactScore * 3 + (isDigestSafe ? 5 : 0),
      };
    }).sort((a: any, b: any) => b.rankScore - a.rankScore);

    // Top 5 (3 must act + 2 backups)
    const top5 = ranked.slice(0, 5);

    for (let i = 0; i < top5.length; i++) {
      const p = top5[i];
      const slot = i < 3 ? `Must Act #${i+1}` : `Backup #${i-2}`;
      
      // Determine if this project needs rescue
      let reason = '';
      if (p.sendReady.length === 0 && p.namedUnverified.length === 0) {
        reason = 'NO CONTACTS';
      } else if (p.sendReady.length === 0) {
        reason = 'only named_unverified (no email)';
      } else if (p.sendReady.length === 1 && p.sendReady[0].verificationScore < 80) {
        reason = 'single low-confidence contact';
      } else if (p.sendReady.length <= 2 && p.sendReady.every((c: any) => c.enrichmentSource === 'web_search')) {
        reason = 'only web_search contacts (no Apollo verification)';
      }

      if (reason) {
        // Check if not already in the list (dedup across reps)
        if (!rescueTargets.find(t => t.projectId === p.id)) {
          rescueTargets.push({
            projectId: p.id,
            projectName: p.projectName,
            owner: p.owner || 'Unknown',
            rep: rep.name,
            reason,
            slot,
          });
        }
      }
    }
  }

  console.log('# Contact Rescue Pass — Target Assessment');
  console.log(`**Timestamp:** ${new Date().toISOString()}`);
  console.log(`**Budget:** ${MAX_CREDITS} Apollo credits (reserving ~20 for post-pipeline delta)`);
  console.log('');
  console.log('## Projects Needing Rescue');
  console.log('| # | Project | Owner | Rep | Slot | Reason |');
  console.log('|---|---------|-------|-----|------|--------|');
  for (let i = 0; i < rescueTargets.length; i++) {
    const t = rescueTargets[i];
    console.log(`| ${i+1} | ${t.projectName.substring(0, 50)} | ${t.owner.substring(0, 25)} | ${t.rep.split(' ')[0]} | ${t.slot} | ${t.reason} |`);
  }
  console.log('');

  if (rescueTargets.length === 0) {
    console.log('## Result: No projects need rescue');
    console.log('All top 5 projects for all 5 reps already have strong send_ready contacts.');
    console.log('Credits used: 0');
    console.log('Credits reserved for post-pipeline delta: 50');
    await conn.end();
    process.exit(0);
  }

  // Now run enrichment on rescue targets (up to budget)
  console.log('## Enrichment Execution');
  console.log('');

  // Get the latest reportId for enrichment context
  const [reportRows] = await conn.execute(
    `SELECT id FROM reports ORDER BY id DESC LIMIT 1`
  ) as any[];
  const reportId = reportRows[0]?.id;

  for (const target of rescueTargets) {
    if (creditsUsed >= MAX_CREDITS) {
      console.log(`⚠️ Budget exhausted (${creditsUsed}/${MAX_CREDITS} credits used). Stopping.`);
      break;
    }

    console.log(`### ${target.projectName}`);
    console.log(`- Owner: ${target.owner}`);
    console.log(`- Reason: ${target.reason}`);
    console.log(`- Rep: ${target.rep} (${target.slot})`);

    try {
      const result = await enrichProjectContacts(target.projectId, reportId);
      const newContacts = result?.newContacts || 0;
      const creditsThisProject = result?.creditsUsed || 0;
      creditsUsed += creditsThisProject;
      console.log(`- Result: ${newContacts} new contacts, ${creditsThisProject} credits`);
      console.log(`- Running total: ${creditsUsed}/${MAX_CREDITS} credits`);
    } catch (err: any) {
      console.log(`- ERROR: ${err.message}`);
    }
    console.log('');
  }

  console.log('## Summary');
  console.log(`- Credits used: ${creditsUsed}`);
  console.log(`- Credits reserved for post-pipeline delta: ${MAX_CREDITS - creditsUsed + 20}`);
  console.log(`- Projects targeted: ${rescueTargets.length}`);

  await conn.end();
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
