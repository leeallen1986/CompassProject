import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { portableAirOpportunityGate } from "../server/laneScoring";

/**
 * The sniff test script uses a different code path - it calls the thisWeekService.
 * Let's replicate exactly what the sniff test does for Daniel Zec.
 * The issue is: the sniff test says 0/20 pass, but when we test the gate directly,
 * projects pass. So the issue must be UPSTREAM of the gate - either:
 * 1. The actionableProjects filter (tier classification) is filtering out all eastern-state projects
 * 2. The territory filter is not matching
 * 3. The "top 20" selection is happening before the gate
 */
async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }
  
  // Check: how many projects in NSW/VIC/SA/TAS are tier1 or tier2+hot/warm?
  const [tier1] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM projects p
    WHERE p.projectState IN ('NSW', 'VIC', 'SA', 'TAS')
      AND p.lifecycleStatus = 'active'
      AND (p.suppressed IS NULL OR p.suppressed = 0)
      AND p.actionTier = 'tier1_actionable'
  `);
  console.log("Tier1 actionable in NSW/VIC/SA/TAS:", (tier1 as any[])[0]?.cnt);
  
  const [tier2hot] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM projects p
    WHERE p.projectState IN ('NSW', 'VIC', 'SA', 'TAS')
      AND p.lifecycleStatus = 'active'
      AND (p.suppressed IS NULL OR p.suppressed = 0)
      AND p.actionTier = 'tier2_warm'
      AND p.priority IN ('hot', 'warm')
  `);
  console.log("Tier2+hot/warm in NSW/VIC/SA/TAS:", (tier2hot as any[])[0]?.cnt);
  
  // Now let's see what the sniff test script actually does
  // Looking at scripts/qa_sniff_test.ts to understand the flow
  console.log("\nChecking the sniff test script logic...");
  
  // The sniff test calls the thisWeekService which:
  // 1. Gets all active projects
  // 2. Filters by actionTier (tier1 + tier2 hot/warm)
  // 3. Scores with laneScoring
  // 4. Applies laneOpportunityGate
  // 5. Filters by territory
  // The "20" in the sniff test is probably the TOP 20 projects BEFORE gate
  // Let's check what the sniff test script actually does
  
  // Let's test: get top 20 mining/oil_gas projects in NSW/VIC/SA/TAS with PA scores
  const [topPA] = await db.execute(sql`
    SELECT p.id, p.name, p.sector, p.priority, p.projectState, p.actionTier,
           COALESCE(bl.score, 0) as pa_score
    FROM projects p
    LEFT JOIN projectBusinessLineScores bl ON bl.projectId = p.id AND bl.scoringDimension = 'Portable Air'
    WHERE p.projectState IN ('NSW', 'VIC', 'SA', 'TAS')
      AND p.lifecycleStatus = 'active'
      AND (p.suppressed IS NULL OR p.suppressed = 0)
      AND (p.actionTier = 'tier1_actionable' OR (p.actionTier = 'tier2_warm' AND p.priority IN ('hot', 'warm')))
    ORDER BY COALESCE(bl.score, 0) DESC
    LIMIT 20
  `);
  
  console.log("\nTop 20 actionable projects in NSW/VIC/SA/TAS by PA score:");
  let passCount = 0;
  for (const p of topPA as any[]) {
    const [pFull] = await db.execute(sql`
      SELECT p.name, p.overview, p.sector, p.stage, p.opportunityRoute, p.owner, p.equipmentSignals
      FROM projects p WHERE p.id = ${p.id}
    `);
    const proj = (pFull as any[])[0];
    if (!proj) continue;
    
    const gateResult = portableAirOpportunityGate(
      {
        name: proj.name,
        overview: proj.overview,
        sector: proj.sector || '',
        stage: proj.stage,
        opportunityRoute: proj.opportunityRoute || '',
        owner: proj.owner || '',
        equipmentSignals: proj.equipmentSignals ? (typeof proj.equipmentSignals === 'string' ? JSON.parse(proj.equipmentSignals) : proj.equipmentSignals) : null,
      },
      p.pa_score,
    );
    
    const status = gateResult.pass ? '✅' : `❌ ${(gateResult as any).reason}`;
    if (gateResult.pass) passCount++;
    console.log(`  ${status} [${p.priority}/${p.actionTier}] ${p.name} (${p.projectState}) PA=${p.pa_score} sector=${p.sector}`);
  }
  console.log(`\nGate pass: ${passCount}/20`);
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
