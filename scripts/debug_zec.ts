import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { portableAirOpportunityGate } from "../server/laneScoring";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }
  
  // Get hot/warm projects in Daniel Zec's territories: NSW, VIC, SA, TAS
  const projects = await db.execute(sql`
    SELECT p.id, p.name, p.overview, p.sector, p.stage, p.opportunityRoute, p.owner, p.priority, p.projectState,
           p.equipmentSignals, p.projectType
    FROM projects p
    WHERE p.projectState IN ('NSW', 'VIC', 'SA', 'TAS')
      AND p.priority IN ('hot', 'warm')
      AND p.lifecycleStatus = 'active'
      AND (p.suppressed IS NULL OR p.suppressed = 0)
    ORDER BY FIELD(p.priority, 'hot', 'warm'), p.name
    LIMIT 40
  `);
  
  const rows = (Array.isArray(projects) ? projects : (projects as any).rows ?? (projects as any)[0] ?? []) as any[];
  console.log(`\n=== Daniel Zec Territory Projects (NSW/VIC/SA/TAS, hot/warm) ===`);
  console.log(`Total found: ${rows.length}\n`);
  
  let passCount = 0;
  let failCount = 0;
  
  for (const p of rows) {
    const blScores = await db.execute(sql`
      SELECT scoringDimension as dimension, score
      FROM projectBusinessLineScores
      WHERE projectId = ${p.id}
    `);
    
    const blRows = (Array.isArray(blScores) ? blScores : (blScores as any).rows ?? (blScores as any)[0] ?? []) as any[];
    const scores = blRows.map((r: any) => ({ dimension: r.dimension, score: r.score }));
    const paScore = scores.find((s: any) => s.dimension === 'Portable Air')?.score ?? 0;
    
    const gateResult = portableAirOpportunityGate(
      {
        name: p.name,
        overview: p.overview,
        sector: p.sector || '',
        stage: p.stage,
        opportunityRoute: p.opportunityRoute || '',
        owner: p.owner || '',
        equipmentSignals: p.equipmentSignals ? (typeof p.equipmentSignals === 'string' ? JSON.parse(p.equipmentSignals) : p.equipmentSignals) : null,
      },
      paScore,
    );
    
    if (gateResult.pass) {
      passCount++;
      if (passCount <= 10) {
        console.log(`✅ PASS: [${p.priority}] ${p.name} (${p.projectState}) | PA score: ${paScore} | sector: ${p.sector}`);
      }
    } else {
      failCount++;
      if (failCount <= 25) {
        console.log(`❌ FAIL: [${p.priority}] ${p.name} (${p.projectState}) | PA score: ${paScore} | sector: ${p.sector} | Reason: ${gateResult.reason}`);
      }
    }
  }
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Pass: ${passCount} / ${rows.length}`);
  console.log(`Fail: ${failCount} / ${rows.length}`);
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
