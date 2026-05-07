/**
 * Ryan scoring audit — verifies sales-motion penalty is applied correctly.
 * Shows top-10 projects with channel, sellingMotion, salesMotionAdjustment, and finalScore.
 */
import mysql from "mysql2/promise";
import { createRequire } from "module";
import { config } from "dotenv";
config();

const require = createRequire(import.meta.url);

// Inline the scoring logic by importing the compiled TS via tsx
const { computePerUserFinalScore } = await import("../server/laneScoring.ts");
const { getProjectScoresBatch } = await import("../server/businessLineScoring.ts");

const db = await mysql.createConnection(process.env.DATABASE_URL);

// Get Ryan's profile
const [profiles] = await db.execute(
  `SELECT up.*, u.name FROM userProfiles up JOIN users u ON u.id = up.userId WHERE u.name LIKE '%Ryan%' LIMIT 1`
);
const profile = profiles[0];
console.log(`\nRyan salesMotion: ${profile.salesMotion}`);
console.log(`Ryan territories: ${JSON.stringify(profile.territories)}`);
console.log(`Ryan assignedBusinessLines: ${JSON.stringify(profile.assignedBusinessLines)}`);

// Get WA active projects
const [projects] = await db.execute(
  `SELECT * FROM projects WHERE projectState = 'WA' AND (suppressed IS NULL OR suppressed = 0) AND lifecycleStatus NOT IN ('archived','merged') LIMIT 60`
);

console.log(`\nScoring ${projects.length} WA projects for Ryan...\n`);

// Get BL scores for all projects
const projectIds = projects.map(p => p.id);
const blScoresMap = await getProjectScoresBatch(projectIds);

const scored = projects.map(p => {
  const blScores = blScoresMap.get(p.id) || [];
  const result = computePerUserFinalScore(
    {
      id: p.id,
      name: p.name,
      location: p.location,
      value: p.value,
      owner: p.owner,
      priority: p.priority,
      sector: p.sector,
      opportunityRoute: p.opportunityRoute,
      isNew: false,
      stage: p.stage,
      overview: p.overview,
      equipmentSignals: p.equipmentSignals ? (typeof p.equipmentSignals === 'string' ? (p.equipmentSignals.startsWith('[') ? JSON.parse(p.equipmentSignals) : p.equipmentSignals.split(',').map(s => s.trim())) : p.equipmentSignals) : null,
        contractors: p.contractors ? (typeof p.contractors === 'string' ? (p.contractors.startsWith('[') || p.contractors.startsWith('{') ? JSON.parse(p.contractors) : null) : p.contractors) : null,
    },
    {
      territories: profile.territories ? (Array.isArray(profile.territories) ? profile.territories : JSON.parse(profile.territories)) : null,
      assignedBusinessLines: profile.assignedBusinessLines ? (Array.isArray(profile.assignedBusinessLines) ? profile.assignedBusinessLines : JSON.parse(profile.assignedBusinessLines)) : null,
      sectorFocus: profile.sectorFocus ? (Array.isArray(profile.sectorFocus) ? profile.sectorFocus : JSON.parse(profile.sectorFocus)) : null,
      stageTiming: profile.stageTiming ? (Array.isArray(profile.stageTiming) ? profile.stageTiming : JSON.parse(profile.stageTiming)) : null,
      keyAccounts: profile.keyAccounts ? (Array.isArray(profile.keyAccounts) ? profile.keyAccounts : JSON.parse(profile.keyAccounts)) : null,
      buyerRoles: profile.buyerRoles ? (Array.isArray(profile.buyerRoles) ? profile.buyerRoles : JSON.parse(profile.buyerRoles)) : null,
      salesMotion: profile.salesMotion,
    },
    blScores,
    [],
  );
  return {
    name: p.name,
    priority: p.priority,
    sector: p.sector,
    sellingMotion: result.sellingMotion,
    channel: result.channel,
    finalScore: result.finalScore,
    laneFitLabel: result.laneFitLabel,
    reasonCodes: result.reasonCodes.filter(r => r.includes("sales_motion") || r.includes("rental") || r.includes("direct_capex")),
  };
}).sort((a, b) => b.finalScore - a.finalScore);

console.log("=== TOP 15 PROJECTS FOR RYAN (after sales-motion penalty) ===\n");
scored.slice(0, 15).forEach((p, i) => {
  const motionTag = p.reasonCodes.length > 0 ? ` [${p.reasonCodes.join(", ")}]` : "";
  console.log(`${i + 1}. ${p.name}`);
  console.log(`   Score: ${p.finalScore} | Priority: ${p.priority} | Sector: ${p.sector} | Channel: ${p.channel} | Lane: ${p.laneFitLabel}${motionTag}`);
});

console.log("\n=== RENTAL PROJECTS (penalised -15 for direct_only Ryan) ===\n");
const rentalProjects = scored.filter(p => p.sellingMotion === "rental");
rentalProjects.slice(0, 10).forEach((p, i) => {
  console.log(`${i + 1}. ${p.name} — Score: ${p.finalScore} | ${p.reasonCodes.join(", ")}`);
});

console.log(`\nTotal rental projects in WA pool: ${rentalProjects.length}`);
console.log(`Rental projects in top 10: ${scored.slice(0, 10).filter(p => p.sellingMotion === "rental").length}`);
console.log(`Rental projects in top 15: ${scored.slice(0, 15).filter(p => p.sellingMotion === "rental").length}`);

await db.end();
