import "dotenv/config";
import { getDb } from "./server/db";
import { getProjectScoresBatch } from "./server/businessLineScoring";

async function main() {
  const db = await getDb();

  // Get a sample of WA project IDs
  const rows = await db.execute(
    `SELECT id, name FROM projects WHERE (location LIKE '%WA%' OR location LIKE '%Western Australia%' OR projectState = 'WA') AND lifecycleStatus = 'active' LIMIT 10`
  ) as any;
  const projects = Array.isArray(rows[0]) ? rows[0] : rows;
  const ids = projects.map((p: any) => p.id);
  console.log("Sample WA project IDs:", ids);
  console.log("Sample WA projects:", projects.map((p: any) => `${p.id}: ${p.name}`).join("\n"));

  // Get BL scores for these projects
  const scoresMap = await getProjectScoresBatch(ids);
  console.log("\n=== BL SCORES FOR SAMPLE WA PROJECTS ===");
  for (const [id, scores] of scoresMap.entries()) {
    const proj = projects.find((p: any) => p.id === id);
    console.log(`\nProject ${id}: ${proj?.name}`);
    if (scores.length === 0) {
      console.log("  (no BL scores)");
    } else {
      scores.forEach(s => console.log(`  ${s.dimension}: ${s.score}`));
    }
  }

  // Also check what dimension names exist in the DB
  const dimRows = await db.execute(
    `SELECT DISTINCT dimension, COUNT(*) as cnt FROM project_bl_scores GROUP BY dimension ORDER BY cnt DESC LIMIT 30`
  ) as any;
  const dims = Array.isArray(dimRows[0]) ? dimRows[0] : dimRows;
  console.log("\n=== ALL DIMENSION NAMES IN DB ===");
  dims.forEach((d: any) => console.log(`  "${d.dimension}": ${d.cnt} projects`));

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
