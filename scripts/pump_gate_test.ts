import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';
import { pumpOpportunityGate } from '../server/laneScoring';

async function main() {
  const db = await getDb();
  
  const top20 = await db.execute(sql`
    SELECT p.id, p.name, p.owner, p.projectState, p.overview, p.sector, p.stage, p.opportunityRoute, p.equipmentSignals, p.priority,
           pbs.score as pumpScore,
           (SELECT COUNT(*) FROM contacts c WHERE c.project = p.name AND c.contactTrustTier = 'send_ready') as sendReadyCount,
           (SELECT COUNT(*) FROM contacts c WHERE c.project = p.name AND c.contactTrustTier = 'named_unverified') as namedCount
    FROM projects p
    JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Pump/Dewatering'
    WHERE p.lifecycleStatus IN ('active', 'hot', 'warm')
    ORDER BY pbs.score DESC
    LIMIT 20
  `);
  
  console.log('=== TOP 20 PUMP/DEWATERING PROJECTS ===\n');
  let passCount = 0;
  let passWithContact = 0;
  
  for (const p of top20[0] as any[]) {
    let eqSigs: string[] = [];
    if (p.equipmentSignals) {
      if (Array.isArray(p.equipmentSignals)) eqSigs = p.equipmentSignals;
      else if (typeof p.equipmentSignals === 'string') {
        try { eqSigs = JSON.parse(p.equipmentSignals); } catch { }
      }
    }
    const gate = pumpOpportunityGate({
      name: p.name, overview: p.overview || '', sector: p.sector || '',
      stage: p.stage || '', opportunityRoute: p.opportunityRoute || '',
      owner: p.owner || '', equipmentSignals: eqSigs,
    }, p.pumpScore);
    
    const gateIcon = gate.pass ? '✅' : '❌';
    if (gate.pass) {
      passCount++;
      if (p.sendReadyCount > 0 || p.namedCount > 0) passWithContact++;
    }
    console.log(`${gateIcon} [Pump=${p.pumpScore}] ${p.name}`);
    console.log(`   Owner: ${p.owner} | State: ${p.projectState} | Contacts: ${p.sendReadyCount}sr/${p.namedCount}nv`);
    if (!gate.pass) console.log(`   Reason: ${(gate as any).reason || 'no pump signals'}`);
  }
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Gate pass: ${passCount}/20`);
  console.log(`Gate pass + has contacts: ${passWithContact}/${passCount}`);
  
  process.exit(0);
}
main();
