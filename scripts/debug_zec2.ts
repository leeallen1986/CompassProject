import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { portableAirOpportunityGate } from "../server/laneScoring";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }
  
  // Get the specific mining/oil_gas/defence projects we know have high PA scores
  const ids = [990050, 450027, 960006, 870018, 510018, 1020013, 450019, 690040, 840001, 480037, 480042, 1200060, 870015, 1020023, 480038, 660053, 450046, 510008, 480044, 450034, 690089];
  
  for (const id of ids) {
    const [rows] = await db.execute(sql`
      SELECT p.id, p.name, p.overview, p.sector, p.stage, p.opportunityRoute, p.owner, p.priority, p.projectState, p.equipmentSignals
      FROM projects p WHERE p.id = ${id}
    `);
    const p = (rows as any[])[0];
    if (!p) continue;
    
    const [blRows] = await db.execute(sql`
      SELECT scoringDimension as dimension, score
      FROM projectBusinessLineScores WHERE projectId = ${id}
    `);
    const paScore = (blRows as any[]).find((r: any) => r.dimension === 'Portable Air')?.score ?? 0;
    
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
    
    const status = gateResult.pass ? '✅ PASS' : `❌ FAIL: ${(gateResult as any).reason}`;
    console.log(`[${p.priority}] ${p.name} (${p.projectState}) | PA=${paScore} | ${status}`);
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
