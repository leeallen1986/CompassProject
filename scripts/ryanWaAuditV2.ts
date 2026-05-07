/**
 * Ryan WA Dry-Run Audit v2
 * Scores all active WA + OFFSHORE_AU projects for Ryan's Portable Air lane
 * and shows top 20 with family classification, bestProductAngle, section eligibility.
 */
import * as dotenv from "dotenv";
dotenv.config();

import mysql from "mysql2/promise";
import { computePerUserFinalScore, classifyAirOpportunity } from "../server/laneScoring";
import { getProjectScoresBatch } from "../server/businessLineScoring";

const RYAN_PROFILE = {
  id: 999,
  name: "Ryan",
  territories: ["WA", "OFFSHORE_AU"],
  businessLines: ["portable_air"],
  primaryBusinessLine: "portable_air" as const,
  sectorFocus: [] as string[],
};

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  // Get all active WA + OFFSHORE_AU projects
  const [rows] = await conn.execute(`
    SELECT p.id, p.name, p.location, p.projectState, p.priority, p.sector,
           p.lifecycleStatus, p.suppressed, p.capexGrade,
           p.opportunityRoute, p.tenderCloseDate, p.overview,
           p.equipmentSignals, p.matchedBusinessLines, p.stage,
           p.lastActivityAt, p.contractors
    FROM projects p
    WHERE p.lifecycleStatus = 'active'
    AND p.suppressed != 1
    AND (p.projectState IN ('WA', 'OFFSHORE_AU') OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%' OR p.location LIKE '%Pilbara%' OR p.location LIKE '%Karratha%' OR p.location LIKE '%North West%' OR p.location LIKE '%Browse Basin%' OR p.location LIKE '%Offshore WA%')
    ORDER BY p.priority DESC, p.name
    LIMIT 300
  `) as any[];

  console.log(`\n=== RYAN WA DRY-RUN AUDIT v2 ===`);
  console.log(`Active WA + OFFSHORE_AU projects: ${rows.length}\n`);

  // Get BL scores for all projects
  const projectIds = rows.map((r: any) => r.id);
  const blScoresMap = await getProjectScoresBatch(projectIds);

  // Score each project
  const scored = rows.map((project: any) => {
    const blScores = blScoresMap.get(project.id) || [];
    const contacts: any[] = [];
    const result = computePerUserFinalScore(project, RYAN_PROFILE, blScores, contacts);
    const airClass = classifyAirOpportunity(project);
    return { ...result, airClass, project };
  });

  // Sort by final score descending
  scored.sort((a: any, b: any) => b.finalScore - a.finalScore);

  // Section 1: Top 20
  console.log("=== TOP 20 CANDIDATES ===\n");
  scored.slice(0, 20).forEach((s: any, i: number) => {
    const p = s.project;
    const gate = s.gateResult || "unknown";
    const section = s.visibilityTier || "unknown";
    const angle = s.bestProductAngle || s.airClass?.bestProductAngle || "Compressor";
    const family = s.airClass?.opportunityType || "core_portable_air";
    
    console.log(`${i + 1}. [ID:${p.id}] ${p.name}`);
    console.log(`   Score: ${s.finalScore} | Priority: ${p.priority} | State: ${p.projectState}`);
    console.log(`   Family: ${family} | Angle: ${angle}`);
    console.log(`   Gate: ${gate} | Section: ${section}`);
    if (s.whyNow) console.log(`   WhyNow: ${s.whyNow}`);
    if (s.routeToBuy) console.log(`   Route: ${s.routeToBuy}`);
    console.log('');
  });

  // Section 2: Specialty-air candidates only
  const specialtyAir = scored.filter((s: any) => {
    const angle = s.bestProductAngle || s.airClass?.bestProductAngle || "Compressor";
    return angle !== "Compressor";
  });

  console.log(`\n=== SPECIALTY-AIR CANDIDATES (Dryer / N2 Membrane / Booster / Package) ===`);
  console.log(`Count: ${specialtyAir.length}\n`);
  
  if (specialtyAir.length === 0) {
    console.log("  ⚠️  ZERO specialty-air candidates found in the active WA pool.");
    console.log("  All projects classify as Compressor (Core Portable Air).");
    console.log("  Root cause: No LNG/pipeline/pre-commissioning projects in active WA pool.\n");
  } else {
    specialtyAir.forEach((s: any, i: number) => {
      const p = s.project;
      const angle = s.bestProductAngle || s.airClass?.bestProductAngle;
      const rank = scored.indexOf(s) + 1;
      const section = s.visibilityTier || "unknown";
      console.log(`${i + 1}. [Rank #${rank}] [ID:${p.id}] ${p.name}`);
      console.log(`   Score: ${s.finalScore} | Angle: ${angle} | Section: ${section}`);
      console.log(`   State: ${p.projectState} | Priority: ${p.priority}`);
      if (p.overview) console.log(`   Overview: ${p.overview?.slice(0, 120)}`);
      console.log('');
    });
  }

  // Section 3: Upstream capture audit
  const specialtyKeywords = [
    'nitrogen', 'purging', 'inerting', 'dry-out', 'commissioning air',
    'pipeline testing', 'instrument air', 'booster', 'high-pressure testing',
    'pre-commission', 'lng', 'flng', 'fpso', 'barossa', 'scarborough',
    'pluto', 'prelude', 'ichthys', 'wheatstone', 'gorgon', 'north west shelf',
  ];

  console.log(`\n=== UPSTREAM CAPTURE AUDIT ===`);
  console.log(`Checking ${specialtyKeywords.length} specialty-air signals in active WA pool:\n`);

  let totalMatches = 0;
  for (const kw of specialtyKeywords) {
    const matches = rows.filter((r: any) => {
      const text = `${r.name} ${r.overview || ''} ${r.opportunityRoute || ''} ${JSON.stringify(r.equipmentSignals || '')}`.toLowerCase();
      return text.includes(kw.toLowerCase());
    });
    if (matches.length > 0) {
      totalMatches++;
      console.log(`  ✅ "${kw}": ${matches.length} project(s) — ${matches.map((m: any) => m.name.slice(0, 40)).join(', ')}`);
    } else {
      console.log(`  ❌ "${kw}": 0 projects`);
    }
  }
  console.log(`\nSignals with coverage: ${totalMatches}/${specialtyKeywords.length}`);

  // Section 4: GE Frame 9 check
  const geFrame9 = scored.find((s: any) => s.project.id === 1110006);
  console.log(`\n=== GE FRAME 9 STATUS ===`);
  if (geFrame9) {
    console.log(`  Still in pool: YES — suppression may not have applied yet`);
    console.log(`  Score: ${geFrame9.finalScore} | Gate: ${geFrame9.gateResult} | Section: ${geFrame9.visibilityTier}`);
  } else {
    console.log(`  ✅ Correctly suppressed — not in Ryan's active pool`);
  }

  await conn.end();
  console.log(`\n=== AUDIT COMPLETE ===\n`);
  process.exit(0);
}

main().catch(e => {
  console.error("Audit failed:", e.message, e.stack);
  process.exit(1);
});
