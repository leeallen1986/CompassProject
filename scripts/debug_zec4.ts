import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';
import { resolveUserProfile, getPrimaryDimension, resolveBusinessLines } from '../server/canonicalMappings';
import { laneOpportunityGate } from '../server/laneScoring';

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  // Get Daniel Zec's profile
  const [profiles] = await db.execute(sql.raw(`
    SELECT up.userId, up.territories, up.assignedBusinessLines as businessLines, u.name as repName
    FROM userProfiles up
    JOIN users u ON u.id = up.userId
    WHERE u.name LIKE '%Zec%'
  `)) as any;

  const profile = profiles[0];
  if (!profile) { console.error("No Zec profile found"); process.exit(1); }
  
  console.log("Raw profile:", JSON.stringify(profile, null, 2));

  const rawBLs: string[] = Array.isArray(profile.businessLines)
    ? profile.businessLines
    : (typeof profile.businessLines === 'string' ? (() => { try { return JSON.parse(profile.businessLines); } catch { return [profile.businessLines]; } })() : []);
  const rawTerritories: string[] = Array.isArray(profile.territories)
    ? profile.territories
    : (typeof profile.territories === 'string' ? (() => { try { return JSON.parse(profile.territories); } catch { return [profile.territories]; } })() : []);
  
  console.log("\nRaw territories:", rawTerritories);
  console.log("Raw BLs:", rawBLs);
  
  const resolved = resolveUserProfile({
    territories: rawTerritories,
    assignedBusinessLines: rawBLs,
  });

  console.log("\nResolved territories:", resolved.territories);
  console.log("Resolved primaryDimension:", resolved.primaryDimension);
  
  const primaryDim = resolved.primaryDimension;
  const territories = resolved.territories;
  const territoryList = territories.map((t: string) => `'${t}'`).join(',');
  
  console.log("\nSQL territory filter:", territoryList);
  
  // Get projects exactly as the sniff test does
  const queryStr = `
    SELECT p.id, p.name, p.overview, p.sector, p.priority, p.projectState,
           p.opportunityRoute, p.projectType, p.value,
           pbs.score as laneScore, pbs.explanation as laneExplanation
    FROM projects p
    LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = '${primaryDim}'
    WHERE p.priority IN ('hot', 'warm')
    AND p.projectState IN (${territoryList})
    ORDER BY 
      CASE p.priority WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END,
      pbs.score DESC
    LIMIT 20
  `;
  console.log("\nQuery:", queryStr);
  
  const [projects] = await db.execute(sql.raw(queryStr)) as any;
  console.log(`\nProjects returned: ${projects.length}`);
  
  // Apply gate exactly as sniff test does
  const gated = projects.filter((p: any) => {
    const result = laneOpportunityGate(
      { name: p.name, overview: p.overview, sector: p.sector, opportunityRoute: p.opportunityRoute },
      primaryDim
    );
    return result.pass;
  });
  
  console.log(`Gate pass: ${gated.length}/${projects.length}`);
  
  // Show what's failing
  console.log("\n--- GATE RESULTS ---");
  for (const p of projects.slice(0, 20)) {
    const result = laneOpportunityGate(
      { name: p.name, overview: p.overview, sector: p.sector, opportunityRoute: p.opportunityRoute },
      primaryDim
    );
    const status = result.pass ? '✅' : `❌ ${result.reason}`;
    console.log(`  ${status} [${p.priority}] ${p.name} (${p.projectState}) PA=${p.laneScore}`);
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
