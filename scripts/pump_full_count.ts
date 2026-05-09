import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';
import { pumpOpportunityGate } from '../server/laneScoring';

async function main() {
  const db = await getDb();
  
  const allPump = await db.execute(sql`
    SELECT p.id, p.name, p.overview, p.sector, p.stage, p.opportunityRoute, p.owner, p.equipmentSignals, p.projectState,
           pbs.score as pumpScore
    FROM projects p
    JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Pump/Dewatering'
    WHERE p.lifecycleStatus IN ('active', 'hot', 'warm') AND pbs.score >= 40
  `);
  
  let passCount = 0;
  let total = (allPump[0] as any[]).length;
  let danPass = 0;
  let danTotal = 0;
  const danTerritories = ['SA', 'QLD', 'VIC', 'NSW', 'TAS'];
  
  for (const p of allPump[0] as any[]) {
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
    if (gate.pass) passCount++;
    
    if (danTerritories.includes(p.projectState)) {
      danTotal++;
      if (gate.pass) danPass++;
    }
  }
  
  console.log(`National: ${passCount}/${total} pass (${Math.round(passCount/total*100)}%)`);
  console.log(`Dan Day (SA/QLD/VIC/NSW/TAS): ${danPass}/${danTotal} pass (${Math.round(danPass/danTotal*100)}%)`);
  console.log(`Ray Clinch (national): ${passCount} actionable projects`);
  
  process.exit(0);
}
main();
