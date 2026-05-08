import { getDb } from "../server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("No DB");

  // 1. All user profile territories
  console.log("=== USER PROFILE TERRITORIES ===");
  const [profiles] = await (db as any).execute(
    `SELECT u.id, u.name, u.email, up.territories, up.assignedBusinessLines, up.sectorFocus, up.industries
     FROM users u
     LEFT JOIN userProfiles up ON up.userId = u.id
     WHERE u.role IN ('admin', 'user')
     ORDER BY u.name`
  );
  for (const p of profiles as any[]) {
    console.log(`  ${p.name} (${p.email})`);
    console.log(`    territories: ${p.territories}`);
    console.log(`    assignedBusinessLines: ${p.assignedBusinessLines}`);
    console.log(`    sectorFocus: ${p.sectorFocus}`);
    console.log(`    industries: ${p.industries}`);
    console.log();
  }

  // 2. All distinct projectState values in projects
  console.log("\n=== DISTINCT PROJECT STATES ===");
  const [states] = await (db as any).execute(
    `SELECT projectState, COUNT(*) as cnt FROM projects WHERE lifecycleStatus = 'active' AND suppressed = 0 GROUP BY projectState ORDER BY cnt DESC`
  );
  for (const s of states as any[]) {
    console.log(`  ${s.projectState}: ${s.cnt} projects`);
  }

  // 3. All distinct scoring dimensions in projectBusinessLineScores
  console.log("\n=== DISTINCT SCORING DIMENSIONS ===");
  const [dims] = await (db as any).execute(
    `SELECT scoringDimension, COUNT(*) as cnt FROM projectBusinessLineScores GROUP BY scoringDimension ORDER BY cnt DESC`
  );
  for (const d of dims as any[]) {
    console.log(`  "${d.scoringDimension}": ${d.cnt} scores`);
  }

  // 4. Brett Hansen specifically
  console.log("\n=== BRETT HANSEN PROFILE ===");
  const [brett] = await (db as any).execute(
    `SELECT u.id, u.name, u.email, up.territories, up.assignedBusinessLines, up.sectorFocus
     FROM users u
     LEFT JOIN userProfiles up ON up.userId = u.id
     WHERE u.name LIKE '%Brett%' OR u.name LIKE '%Hansen%'`
  );
  for (const b of brett as any[]) {
    console.log(`  ${b.name} (id: ${b.id})`);
    console.log(`    territories: ${b.territories}`);
    console.log(`    assignedBusinessLines: ${b.assignedBusinessLines}`);
    console.log(`    sectorFocus: ${b.sectorFocus}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
