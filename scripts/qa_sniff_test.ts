import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';
import { resolveUserProfile, getPrimaryDimension, resolveBusinessLines } from '../server/canonicalMappings';
import { laneOpportunityGate } from '../server/laneScoring';
import { selectProjectContact } from '../server/contactSelector';

/**
 * PART E: Whole-team commercial sniff test
 * For each rep: show their actual top 3 projects with honest verdicts
 */
async function main() {
  const db = await getDb();

  // Get all active reps with their profiles
  const [profiles] = await db.execute(sql.raw(`
    SELECT up.userId, up.territories, up.assignedBusinessLines as businessLines, u.name as repName
    FROM userProfiles up
    JOIN users u ON u.id = up.userId
    WHERE up.onboardingCompleted = 1
    ORDER BY u.name
  `)) as any;

  console.log('=== PART E: WHOLE-TEAM COMMERCIAL SNIFF TEST ===');
  console.log(`Testing ${profiles.length} active reps\n`);

  for (const profile of profiles) {
    // DB driver auto-parses JSON columns — handle both string and array
    const rawBLs: string[] = Array.isArray(profile.businessLines)
      ? profile.businessLines
      : (typeof profile.businessLines === 'string' ? (() => { try { return JSON.parse(profile.businessLines); } catch { return [profile.businessLines]; } })() : []);
    const rawTerritories: string[] = Array.isArray(profile.territories)
      ? profile.territories
      : (typeof profile.territories === 'string' ? (() => { try { return JSON.parse(profile.territories); } catch { return [profile.territories]; } })() : []);
    const resolved = resolveUserProfile({
      territories: rawTerritories,
      assignedBusinessLines: rawBLs,
    });

    const primaryDim = resolved.primaryDimension;
    const territories = resolved.territories;

    // Get top projects for this rep (territory-filtered, scored)
    const territoryList = territories.map((t: string) => `'${t}'`).join(',');
    const [projects] = await db.execute(sql.raw(`
      SELECT p.id, p.name, p.overview, p.sector, p.priority, p.projectState,
             p.opportunityRoute, p.projectType, p.value, p.owner, p.stage, p.equipmentSignals,
             pbs.score as laneScore, pbs.explanation as laneExplanation
      FROM projects p
      LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = '${primaryDim}'
      WHERE p.priority IN ('hot', 'warm')
      AND p.projectState IN (${territoryList})
      ORDER BY 
        CASE p.priority WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END,
        pbs.score DESC
      LIMIT 20
    `)) as any;

    // Apply lane gate
    const gated = projects.filter((p: any) => {
      const result = laneOpportunityGate(
        { name: p.name, overview: p.overview, sector: p.sector || '', opportunityRoute: p.opportunityRoute || '', owner: p.owner || '', stage: p.stage || null, equipmentSignals: p.equipmentSignals ?? null, priority: p.priority },
        primaryDim,
        p.laneScore ?? 0,
      );
      return result.pass;
    });

    // Get contacts for top 3
    const top3 = gated.slice(0, 3);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`REP: ${profile.repName}`);
    console.log(`Primary: ${primaryDim} | Territories: ${territories.join(', ')}`);
    console.log(`Gate: ${gated.length}/${projects.length} pass | Top 3:`);

    for (let i = 0; i < top3.length; i++) {
      const p = top3[i];
      
      // Get linked contacts for this project
      const [contacts] = await db.execute(sql.raw(`
        SELECT c.id, c.name, c.title, c.company, c.email, c.linkedin,
               c.contactTrustTier, c.roleRelevance, c.linkedinProfileUrl
        FROM contacts c
        JOIN contactProjects cp ON cp.contactId = c.id
        WHERE cp.projectId = ${p.id}
        ORDER BY 
          CASE c.contactTrustTier WHEN 'send_ready' THEN 1 WHEN 'named_unverified' THEN 2 ELSE 3 END,
          CASE c.roleRelevance WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
        LIMIT 5
      `)) as any;

      const contactResult = selectProjectContact(contacts, {
        projectName: p.name || '',
        projectState: p.projectState || null,
      });

      // Commercial verdict
      const verdict = getCommercialVerdict(p, contactResult, primaryDim);

      console.log(`\n  ${i+1}. [${p.priority}] ${p.name}`);
      console.log(`     State: ${p.projectState} | Value: ${p.estimatedValue || 'unknown'} | Lane: ${p.laneScore || 0}/100`);
      console.log(`     Sector: ${p.sector || 'unknown'} | Route: ${p.opportunityRoute || 'unknown'}`);
      console.log(`     Contact: ${contactResult.selectedContact ? `${contactResult.selectedContact.name} (${contactResult.selectedContact.title}, ${contactResult.selectedContact.company}) [${contactResult.selectedContact.trustTier}]` : 'NONE'}`);
      console.log(`     Email: ${contactResult.selectedContact?.email ? 'YES' : 'NO'} | LI: ${contactResult.selectedContact?.linkedin ? 'YES' : 'NO'}`);
      console.log(`     VERDICT: ${verdict}`);
    }

    if (top3.length === 0) {
      console.log('  ⚠️  NO PROJECTS PASS GATE — rep will see empty dashboard');
    }
  }

  process.exit(0);
}

function getCommercialVerdict(
  project: any,
  contactResult: any,
  primaryDim: string
): string {
  const issues: string[] = [];
  const strengths: string[] = [];

  // Check if project is real opportunity
  if (project.priority === 'hot') strengths.push('HOT priority');
  if (project.laneScore >= 80) strengths.push(`strong lane fit (${project.laneScore})`);
  if (project.value && parseFloat(project.value) > 100) strengths.push('high value');

  // Check contact quality
  if (!contactResult.selectedContact) {
    issues.push('NO CONTACT — rep cannot act');
  } else {
    if (contactResult.selectedContact.trustTier === 'send_ready' && contactResult.selectedContact.email) {
      strengths.push('send_ready contact with email');
    } else if (contactResult.selectedContact.trustTier === 'named_unverified') {
      issues.push('contact unverified (named_unverified)');
    }
    if (!contactResult.selectedContact.email) {
      issues.push('no email on contact');
    }
  }

  // Check route to buy
  if (project.opportunityRoute && project.opportunityRoute.includes('direct')) {
    strengths.push('direct route');
  }

  // Verdict
  if (issues.length === 0 && strengths.length >= 2) return '✅ ACTIONABLE — ' + strengths.join(', ');
  if (issues.length === 0) return '🟡 PLAUSIBLE — ' + strengths.join(', ');
  if (issues.length > 0 && strengths.length >= 2) return '🟡 PARTIAL — ' + strengths.join(', ') + ' | BUT: ' + issues.join(', ');
  return '❌ NOT ACTIONABLE — ' + issues.join(', ');
}

main();
