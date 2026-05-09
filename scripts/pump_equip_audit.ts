import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  
  // Check how many projects have dewatering/pump in equipment signals
  const result = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN equipmentSignals LIKE '%Dewatering%' OR equipmentSignals LIKE '%dewater%' THEN 1 ELSE 0 END) as hasDewatering,
      SUM(CASE WHEN equipmentSignals LIKE '%Pump%' OR equipmentSignals LIKE '%pump%' THEN 1 ELSE 0 END) as hasPump,
      SUM(CASE WHEN equipmentSignals IS NULL OR equipmentSignals = '' OR equipmentSignals = '[]' THEN 1 ELSE 0 END) as noSignals
    FROM projects
    WHERE lifecycleStatus IN ('active', 'hot', 'warm')
  `);
  console.log('Equipment signal distribution:', JSON.stringify(result[0], null, 2));
  
  // Check how many of the top 200 pump-scored projects have dewatering in equipment signals
  const pumpProjects = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN p.equipmentSignals LIKE '%Dewatering%' OR p.equipmentSignals LIKE '%dewater%' THEN 1 ELSE 0 END) as hasDewatering,
      SUM(CASE WHEN p.equipmentSignals LIKE '%Pump%' OR p.equipmentSignals LIKE '%pump%' THEN 1 ELSE 0 END) as hasPump
    FROM projects p
    JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Pump/Dewatering'
    WHERE p.lifecycleStatus IN ('active', 'hot', 'warm') AND pbs.score >= 40
  `);
  console.log('\nPump-scored projects (>=40) equipment signals:', JSON.stringify(pumpProjects[0], null, 2));
  
  // Check a sample of projects that SHOULD NOT pass pump gate but have dewatering in equip signals
  const falsePositives = await db.execute(sql`
    SELECT p.name, p.sector, p.equipmentSignals, LEFT(p.overview, 150) as ov
    FROM projects p
    JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Pump/Dewatering'
    WHERE p.lifecycleStatus IN ('active', 'hot', 'warm') 
      AND pbs.score >= 40
      AND p.equipmentSignals LIKE '%Dewatering%'
      AND p.sector = 'infrastructure'
      AND (p.overview NOT LIKE '%water%' AND p.overview NOT LIKE '%pump%' AND p.overview NOT LIKE '%drain%' AND p.overview NOT LIKE '%sewer%')
    LIMIT 10
  `);
  console.log('\nFalse positive candidates (infrastructure + dewatering signal but no water in overview):');
  for (const fp of falsePositives[0] as any[]) {
    console.log(`  - ${fp.name} [${fp.sector}]`);
    console.log(`    Overview: ${fp.ov}`);
  }
  
  process.exit(0);
}
main();
