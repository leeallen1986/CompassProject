import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const db = await createConnection(process.env.DATABASE_URL!);

  // Check scoring dimensions
  const [dimRows] = await db.query("SELECT DISTINCT scoringDimension FROM projectBusinessLineScores LIMIT 20") as any[];
  console.log("Scoring dimensions:", dimRows.map((r: any) => r.scoringDimension).join(", "));

  // Check digestSafe count
  const [safeRows] = await db.query("SELECT COUNT(*) as cnt FROM projectValidationGates WHERE digestSafe = 1") as any[];
  console.log("DigestSafe projects:", safeRows[0].cnt);

  // Check action_ready + digestSafe + WA
  const [waRows] = await db.query(`
    SELECT COUNT(*) as cnt FROM projects p
    JOIN projectValidationGates pvg ON pvg.projectId = p.id
    WHERE p.lifecycleStatus = 'action_ready'
      AND p.suppressed = 0
      AND pvg.digestSafe = 1
      AND (p.projectState = 'WA' OR p.projectState IS NULL)
  `) as any[];
  console.log("WA + digestSafe + action_ready:", waRows[0].cnt);

  // Check with portable_air score
  const [paRows] = await db.query(`
    SELECT COUNT(*) as cnt FROM projects p
    JOIN projectValidationGates pvg ON pvg.projectId = p.id
    JOIN projectBusinessLineScores pbl ON pbl.projectId = p.id AND pbl.scoringDimension = 'portable_air'
    WHERE p.lifecycleStatus = 'action_ready'
      AND p.suppressed = 0
      AND pvg.digestSafe = 1
      AND (p.projectState = 'WA' OR p.projectState IS NULL)
  `) as any[];
  console.log("WA + digestSafe + action_ready + has portable_air score:", paRows[0].cnt);

  // Sample 3 digestSafe projects
  const [sampleRows] = await db.query(`
    SELECT p.id, p.name, p.projectState, p.lifecycleStatus, pvg.digestSafe
    FROM projects p
    JOIN projectValidationGates pvg ON pvg.projectId = p.id
    WHERE pvg.digestSafe = 1
    LIMIT 5
  `) as any[];
  console.log("\nSample digestSafe projects:");
  for (const r of sampleRows as any[]) {
    console.log(`  [${r.id}] ${r.name} | state: ${r.projectState} | status: ${r.lifecycleStatus}`);
  }

  await db.end();
}
main().catch(console.error);
