/**
 * diag-live-ranking.mjs
 * Pulls the live ranked top-10 projects for 5 reps from the production DB,
 * using the same laneScoring logic as thisWeekService and emailDigest.
 *
 * Reps:
 *   2340043 → Ryan Pemberton   (WA | Portable Air, PT Capital Sales)
 *   2820073 → Daniel Zec       (NSW/VIC/SA/TAS | Portable Air)
 *   3630009 → Dan Day          (SA/QLD/VIC/NSW/TAS | Pump/Flow, Dewatering Pumps)
 *   840008  → Leo Williams     (National | Portable Air)
 *   3870014 → Amit Bhargava    (National | PAL, BESS)
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ── Load profiles ─────────────────────────────────────────────────────────────

const REP_IDS = [2340043, 2820073, 3630009, 840008, 3870014];

const [profileRows] = await conn.query(
  `SELECT p.userId, u.name,
          p.territories, p.assignedBusinessLines, p.sectorFocus,
          p.keyAccounts, p.industries
   FROM userProfiles p
   JOIN users u ON u.id = p.userId
   WHERE p.userId IN (${REP_IDS.join(",")})`,
  []
);

function parseJson(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  const s = Buffer.isBuffer(val) ? val.toString() : String(val);
  try { return JSON.parse(s); } catch { return [s]; }
}

const profiles = {};
for (const r of profileRows) {
  profiles[r.userId] = {
    userId: r.userId,
    name: r.name.trim(),
    territories: parseJson(r.territories),
    assignedBusinessLines: parseJson(r.assignedBusinessLines),
    sectorFocus: parseJson(r.sectorFocus),
    keyAccounts: parseJson(r.keyAccounts),
    industries: parseJson(r.industries),
  };
}

// ── Load projects (hot/warm, last 90 days) ────────────────────────────────────

const [projectRows] = await conn.query(
  `SELECT p.id, p.name AS title, p.projectState AS state, p.sector, p.priority, p.stage,
          p.value AS estimatedValue, p.location, p.owner AS ownerName,
          p.overview AS description, p.updatedAt, p.stageCode,
          GROUP_CONCAT(DISTINCT pbs.scoringDimension ORDER BY pbs.score DESC SEPARATOR '|') AS blNames,
          GROUP_CONCAT(DISTINCT pbs.score ORDER BY pbs.score DESC SEPARATOR '|') AS blScores
   FROM projects p
   LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
   WHERE p.priority IN ('hot','warm')
     AND p.suppressed != 1
     AND p.updatedAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
   GROUP BY p.id
   ORDER BY p.priority DESC, p.updatedAt DESC
   LIMIT 300`
);

// ── Build BL score map per project ────────────────────────────────────────────

function buildBlScores(blNames, blScoresStr) {
  const names = (blNames || "").split("|").filter(Boolean);
  const scores = (blScoresStr || "").split("|").filter(Boolean).map(Number);
  const map = {};
  for (let i = 0; i < names.length; i++) {
    map[names[i]] = scores[i] ?? 0;
  }
  return map;
}

// ── Lane scoring (inline — mirrors laneScoring.ts logic) ─────────────────────

const BL_TO_LANE = {
  "Portable Air": "portableAir",
  "PT Capital Sales": "portableAir",
  "Pump (Flow)": "pump",
  "Dewatering Pumps": "pump",
  "Pump/Dewatering": "pump",
  "PAL": "pal",
  "BESS": "bess",
  "Nitrogen": "portableAir",
  "Booster": "portableAir",
  "Generators": "portableAir",
  "Service": "portableAir",
  "Rental": "portableAir",
};

const SECTOR_WEIGHTS = {
  mining: { portableAir: 1.0, pump: 0.9, pal: 0.7, bess: 0.5 },
  oil_gas: { portableAir: 1.0, pump: 0.8, pal: 0.6, bess: 0.4 },
  infrastructure: { portableAir: 0.8, pump: 0.7, pal: 0.9, bess: 0.8 },
  energy: { portableAir: 0.6, pump: 0.5, pal: 0.8, bess: 1.0 },
  water: { portableAir: 0.4, pump: 1.0, pal: 0.5, bess: 0.3 },
  civils: { portableAir: 0.7, pump: 0.8, pal: 0.8, bess: 0.5 },
  defence: { portableAir: 0.7, pump: 0.5, pal: 0.6, bess: 0.5 },
  industrial: { portableAir: 0.8, pump: 0.6, pal: 0.9, bess: 0.7 },
};

function getLaneScore(blScoreMap, laneName) {
  const BL_NAMES = {
    portableAir: ["Portable Air", "PT Capital Sales", "Nitrogen", "Booster", "Generators"],
    pump: ["Pump (Flow)", "Dewatering Pumps", "Pump/Dewatering"],
    pal: ["PAL"],
    bess: ["BESS"],
  };
  const names = BL_NAMES[laneName] || [];
  return Math.max(0, ...names.map(n => blScoreMap[n] ?? 0));
}

function scoreProject(project, profile, blScoreMap) {
  const primaryLaneKeys = [...new Set(
    profile.assignedBusinessLines.map(bl => BL_TO_LANE[bl]).filter(Boolean)
  )];

  // Lane scores
  const laneScores = {
    portableAir: getLaneScore(blScoreMap, "portableAir"),
    pump: getLaneScore(blScoreMap, "pump"),
    pal: getLaneScore(blScoreMap, "pal"),
    bess: getLaneScore(blScoreMap, "bess"),
  };

  // Primary lane score = max across user's assigned lanes
  const primaryLaneScore = Math.max(0, ...primaryLaneKeys.map(k => laneScores[k] ?? 0));

  // Sector weight
  const sector = (project.sector || "").toLowerCase().replace(/[^a-z_]/g, "_");
  const sectorWeights = SECTOR_WEIGHTS[sector] || {};
  const sectorBoost = primaryLaneKeys.reduce((max, k) => Math.max(max, (sectorWeights[k] ?? 0.5) * 20), 0);

  // Territory match
  const state = (project.state || "").toUpperCase().trim();
  const territories = profile.territories.map(t => t.toUpperCase().trim());
  const isNational = territories.some(t => ["NATIONAL", "ALL", "AU"].includes(t));
  const territoryMatch = isNational || territories.includes(state) ? 1 : 0;

  // Priority
  const priorityScore = project.priority === "hot" ? 20 : project.priority === "warm" ? 10 : 0;

  // Stage timing
  const stageScore = ["awarded_mobilizing", "awarded"].includes(project.stage) ? 15
    : ["tendering", "tender"].includes(project.stage) ? 10
    : ["planning", "early_signal"].includes(project.stage) ? 5 : 0;

  // Final score (territory hard filter — 0 if miss)
  const baseScore = primaryLaneScore * 0.5 + sectorBoost + priorityScore + stageScore;
  const finalScore = territoryMatch ? Math.round(baseScore) : 0;

  // Lane fit label
  const laneFit = primaryLaneScore >= 70 ? "High fit"
    : primaryLaneScore >= 40 ? "Medium fit"
    : primaryLaneScore >= 15 ? "Low fit"
    : "Poor fit";

  // Channel
  const channel = primaryLaneScore >= 50 ? "direct"
    : primaryLaneScore >= 20 ? "rental"
    : Object.values(laneScores).some(s => s >= 40) ? "crosssell"
    : "monitor";

  return {
    projectId: project.id,
    title: project.title,
    state: project.state,
    sector: project.sector,
    priority: project.priority,
    stage: project.stage,
    finalScore,
    primaryLaneScore,
    laneFit,
    channel,
    territoryMatch: !!territoryMatch,
    laneScores,
  };
}

// ── Run comparison ────────────────────────────────────────────────────────────

const results = {};

for (const userId of REP_IDS) {
  const profile = profiles[userId];
  if (!profile) { console.log(`No profile for userId=${userId}`); continue; }

  const scored = projectRows.map(p => {
    const blMap = buildBlScores(p.blNames, p.blScores);
    return scoreProject(p, profile, blMap);
  });

  const top10 = scored
    .filter(s => s.finalScore > 0)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, 10);

  const mustAct = top10.filter(s => s.priority === "hot" && s.laneFit !== "Poor fit").slice(0, 3);

  results[userId] = { profile, top10, mustAct };
}

// ── Print report ──────────────────────────────────────────────────────────────

for (const userId of REP_IDS) {
  const r = results[userId];
  if (!r) continue;
  const { profile, top10, mustAct } = r;

  console.log(`\n${"═".repeat(72)}`);
  console.log(`REP: ${profile.name}`);
  console.log(`  Territories: ${profile.territories.join(", ")}`);
  console.log(`  BLs: ${profile.assignedBusinessLines.join(", ")}`);
  console.log(`  Sectors: ${profile.sectorFocus.join(", ")}`);
  console.log(`${"─".repeat(72)}`);

  console.log(`\nTHIS WEEK — Top 10:`);
  for (let i = 0; i < top10.length; i++) {
    const p = top10[i];
    console.log(`  ${i + 1}. [${p.priority.toUpperCase()}] ${p.title}`);
    console.log(`     State: ${p.state} | Sector: ${p.sector} | Stage: ${p.stage}`);
    console.log(`     Score: ${p.finalScore} | Lane: ${p.primaryLaneScore} | Fit: ${p.laneFit} | Channel: ${p.channel}`);
  }

  console.log(`\nDIGEST — Must Act (top 3 hot + lane fit):`);
  if (mustAct.length === 0) {
    console.log("  (none — no hot projects with lane fit in territory)");
  } else {
    for (const p of mustAct) {
      console.log(`  • [${p.priority.toUpperCase()}] ${p.title} | ${p.state} | Score: ${p.finalScore} | ${p.laneFit} | ${p.channel}`);
    }
  }
}

// ── Overlap analysis ──────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(72)}`);
console.log("OVERLAP / DIFFERENCE ANALYSIS");
console.log(`${"─".repeat(72)}`);

const allTop10Sets = {};
for (const userId of REP_IDS) {
  if (!results[userId]) continue;
  allTop10Sets[userId] = new Set(results[userId].top10.map(p => p.projectId));
}

// Projects appearing in multiple reps' top 10
const allIds = Object.values(allTop10Sets).flatMap(s => [...s]);
const freq = {};
for (const id of allIds) freq[id] = (freq[id] || 0) + 1;
const shared = Object.entries(freq).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);

if (shared.length === 0) {
  console.log("  No projects appear in multiple reps' top 10 — good separation.");
} else {
  console.log(`  Projects in multiple top-10 lists:`);
  for (const [id, count] of shared) {
    const proj = projectRows.find(p => p.id === Number(id));
    const repsWithIt = REP_IDS.filter(uid => allTop10Sets[uid]?.has(Number(id)))
      .map(uid => results[uid]?.profile.name.split(" ")[0]).join(", ");
    console.log(`  • ${proj?.title || id} (${count} reps: ${repsWithIt})`);
  }
}

// Territory separation check
console.log(`\n  Territory separation:`);
for (const userId of REP_IDS) {
  const r = results[userId];
  if (!r) continue;
  const outOfTerritory = r.top10.filter(p => !p.territoryMatch);
  console.log(`  ${r.profile.name}: ${r.top10.length} in-territory, ${outOfTerritory.length} out-of-territory in top 10`);
}

await conn.end();
console.log(`\n✓ Done.`);
