/**
 * Before/After validation for broken reps:
 * Dan Day, Egor Ivanov, Kevin Arnandes, Alexandre Leite, Brett Hansen
 */
import { getDb } from "../server/db";
import { resolveTerritories, resolveBusinessLines } from "../server/canonicalMappings";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  // Get all user profiles
  const [profiles] = await db.execute(sql`
    SELECT up.userId, u.name, u.email, up.territories, up.assignedBusinessLines, up.sectorFocus
    FROM userProfiles up
    JOIN users u ON u.id = up.userId
    WHERE u.name IN ('Dan Day', 'Egor Ivanov', 'Kevin Arnandes', 'Alexandre Leite', 'Brett Hansen')
  `) as any;

  // Get all scoring dimensions
  const [dims] = await db.execute(sql`
    SELECT DISTINCT scoringDimension FROM projectBusinessLineScores
  `) as any;
  console.log("\n=== Available Scoring Dimensions ===");
  console.log((dims as any[]).map((d: any) => d.scoringDimension).join(", "));

  for (const profile of profiles as any[]) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`REP: ${profile.name} (${profile.email})`);
    console.log(`${"=".repeat(60)}`);

    // Parse JSON fields
    const rawTerritories = typeof profile.territories === "string" 
      ? JSON.parse(profile.territories) 
      : profile.territories || [];
    const rawBLs = typeof profile.assignedBusinessLines === "string"
      ? JSON.parse(profile.assignedBusinessLines)
      : profile.assignedBusinessLines || [];
    const sectorFocus = typeof profile.sectorFocus === "string"
      ? JSON.parse(profile.sectorFocus)
      : profile.sectorFocus || [];

    console.log(`\n--- BEFORE (raw profile values) ---`);
    console.log(`  Territories: ${JSON.stringify(rawTerritories)}`);
    console.log(`  Business Lines: ${JSON.stringify(rawBLs)}`);
    console.log(`  Sector Focus: ${JSON.stringify(sectorFocus)}`);

    // Resolve via canonical model
    const resolvedTerritories = resolveTerritories(rawTerritories, sectorFocus);
    const resolvedBLs = resolveBusinessLines(rawBLs);

    console.log(`\n--- AFTER (canonical resolution) ---`);
    console.log(`  Territories: ${JSON.stringify(resolvedTerritories)}`);
    console.log(`  Business Lines (scoring dimensions): ${JSON.stringify(resolvedBLs)}`);

    // Count projects that match the resolved BLs with score >= 60
    let projectCount = 0;
    let top5: any[] = [];

    if (resolvedBLs.length > 0) {
      // Build territory filter
      const isNational = resolvedTerritories.length >= 8;
      const terrFilter = !isNational && resolvedTerritories.length > 0
        ? sql` AND p.projectState IN (${sql.join(resolvedTerritories.map(t => sql`${t}`), sql`, `)})`
        : sql``;

      const blFilter = sql.join(resolvedBLs.map(bl => sql`${bl}`), sql`, `);

      const [countRows] = await db.execute(sql`
        SELECT COUNT(DISTINCT p.id) as cnt
        FROM projects p
        INNER JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
        WHERE pbs.scoringDimension IN (${blFilter})
          AND pbs.score >= 60
          AND p.lifecycleStatus = 'active'
          ${terrFilter}
      `) as any;
      projectCount = (countRows as any[])[0]?.cnt || 0;

      // Get top 5 projects
      const [topRows] = await db.execute(sql`
        SELECT p.id, p.name, p.projectState, p.location, pbs.scoringDimension, pbs.score
        FROM projects p
        INNER JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
        WHERE pbs.scoringDimension IN (${blFilter})
          AND pbs.score >= 60
          AND p.lifecycleStatus = 'active'
          ${terrFilter}
        ORDER BY pbs.score DESC
        LIMIT 5
      `) as any;
      top5 = topRows as any[];
    }

    console.log(`\n--- PROJECT UNIVERSE ---`);
    console.log(`  Total projects (PA≥60, active, territory-matched): ${projectCount}`);
    console.log(`\n  Top 5 Projects:`);
    for (const p of top5) {
      console.log(`    [Score:${p.score}] ${p.name} (${p.projectState || "?"}) — ${p.scoringDimension}`);
    }

    // Check if this rep maps to Pump/Dewatering
    if (profile.name === "Brett Hansen" || profile.name === "Dan Day") {
      const hasPumpDewatering = resolvedBLs.includes("Pump/Dewatering");
      console.log(`\n  ✓ Maps to Pump/Dewatering dimension: ${hasPumpDewatering ? "YES" : "NO"}`);
    }
  }

  // Final confirmation
  console.log(`\n${"=".repeat(60)}`);
  console.log("CANONICAL MAPPING CONFIRMATION");
  console.log(`${"=".repeat(60)}`);
  
  const flowReps = (profiles as any[]).filter(p => {
    const bls = typeof p.assignedBusinessLines === "string"
      ? JSON.parse(p.assignedBusinessLines)
      : p.assignedBusinessLines || [];
    return bls.some((bl: string) => 
      bl.toLowerCase().includes("pump") || 
      bl.toLowerCase().includes("flow") || 
      bl.toLowerCase().includes("dewatering")
    );
  });
  
  console.log(`\nFlow/Pump/Dewatering reps found: ${flowReps.map((p: any) => p.name).join(", ")}`);
  console.log(`All resolve to "Pump/Dewatering" dimension: ${
    flowReps.every((p: any) => {
      const bls = typeof p.assignedBusinessLines === "string"
        ? JSON.parse(p.assignedBusinessLines)
        : p.assignedBusinessLines || [];
      return resolveBusinessLines(bls).includes("Pump/Dewatering");
    }) ? "YES ✓" : "NO ✗"
  }`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
