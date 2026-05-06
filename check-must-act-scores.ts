import "dotenv/config";
import { getDb } from "./server/db";
import { projects, userProfiles, users } from "./drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";

// The 3 shared Must Act projects
const PROJECT_IDS = [1020027, 450042, 330015];
// Ryan = 2340043, Brett = 2550006
const USER_IDS = [2340043, 2550006];

const BL_TO_DIMENSION_MAP: Record<string, string[]> = {
  "Portable Air": ["Portable Air"],
  "Pump (Flow)": ["Pump/Dewatering"],
  "Pump/Dewatering": ["Pump/Dewatering"],
  "PAL": ["PAL"],
  "BESS": ["BESS"],
  "Generators": ["Generators"],
  "Nitrogen": ["Nitrogen"],
  "Booster": ["Booster"],
  "Service Potential": ["Service Potential"],
  "Rental Influence": ["Rental Influence"],
};

async function main() {
  const db = await getDb();

  const userRows = await db.select().from(users).where(inArray(users.id, USER_IDS));
  const profileRows = await db.select().from(userProfiles).where(inArray(userProfiles.userId, USER_IDS));

  for (const userId of USER_IDS) {
    const user = userRows.find(u => u.id === userId);
    const profile = profileRows.find(p => p.userId === userId);
    if (!user || !profile) { console.log(`User ${userId} not found`); continue; }

    const blRaw = profile.assignedBusinessLines;
    let bls: string[] = [];
    if (Array.isArray(blRaw)) bls = blRaw;
    else if (typeof blRaw === 'string') bls = blRaw.startsWith('[') ? JSON.parse(blRaw) : blRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
    const ptLane = profile.ptLaneFocus || 'none';
    const terrRaw = profile.assignedTerritories;
    let territories: string[] = [];
    if (Array.isArray(terrRaw)) territories = terrRaw;
    else if (typeof terrRaw === 'string') territories = terrRaw.startsWith('[') ? JSON.parse(terrRaw) : terrRaw.split(',').map((s: string) => s.trim()).filter(Boolean);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`USER: ${user.name} (ID: ${userId})`);
    console.log(`  BLs: ${bls.join(", ")} | PT Lane: ${ptLane} | Territories: ${territories.join(", ")}`);
    console.log("=".repeat(60));

    for (const projectId of PROJECT_IDS) {
      const blScoreRows = await db.execute(
        sql`SELECT scoringDimension as dimension, score FROM projectBusinessLineScores WHERE projectId = ${projectId}`
      ) as any;
      const blScores: Record<string, number> = {};
      const rows = Array.isArray(blScoreRows) ? blScoreRows[0] : blScoreRows;
      if (Array.isArray(rows)) {
        for (const row of rows as any[]) {
          blScores[row.dimension] = row.score;
        }
      }

      const projRows = await db.select().from(projects).where(eq(projects.id, projectId));
      const proj = projRows[0];
      if (!proj) continue;

      let laneTier: "primary" | "secondary" | "crosssell" | "poor" = "poor";
      let laneScore = -8;
      let matchedDimension = "none";

      for (const bl of bls) {
        const dims = BL_TO_DIMENSION_MAP[bl] || [];
        for (const dim of dims) {
          const score = blScores[dim] || 0;
          if (score >= 60) {
            if (laneTier !== "primary") { laneTier = "primary"; laneScore = 32; matchedDimension = `${dim}=${score}`; }
          } else if (score >= 40) {
            if (laneTier !== "primary" && laneTier !== "secondary") { laneTier = "secondary"; laneScore = 22; matchedDimension = `${dim}=${score}`; }
          } else if (score >= 20) {
            if (laneTier === "poor") { laneTier = "crosssell"; laneScore = 8; matchedDimension = `${dim}=${score}`; }
          }
        }
      }

      const contactCount = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM contactProjects cp 
            JOIN contacts c ON c.id = cp.contactId 
            WHERE cp.projectId = ${projectId} AND c.enrichmentStatus = 'send_ready'`
      ) as any;
      const sendReady = Array.isArray(contactCount) ? (contactCount[0] as any[])?.[0]?.cnt : 0;

      console.log(`\nProject: ${proj.name} (ID: ${projectId})`);
      console.log(`  Priority: ${proj.priority} | Stage: ${(proj as any).projectStage}`);
      console.log(`  Lane tier for ${user.name}: ${laneTier} (${laneScore} pts) via ${matchedDimension}`);
      console.log(`  All BL scores for this project: ${JSON.stringify(blScores)}`);
      console.log(`  Send-ready contacts: ${sendReady}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
