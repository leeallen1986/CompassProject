/**
 * diag-audit-ranking.mjs
 * Full ranking audit:
 * 1. Ryan before/after (top 10, score breakdown top 5)
 * 2. Cross-user comparison: Ryan, Daniel, Dan Day (top 5, Must Act IDs, fallback audit)
 * 3. Cache/stale check (digest table last_generated timestamps)
 */
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseBuf(v) {
  if (!v) return null;
  if (Buffer.isBuffer(v)) return JSON.parse(v.toString("utf8"));
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

// BL → lane key mapping (mirrors laneScoring.ts)
const BL_TO_LANE_KEY = {
  "Portable Air": "portableAir",
  "PT Capital Sales": "portableAir",
  "Pump (Flow)": "pump",
  "Dewatering Pumps": "pump",
  "Pump/Dewatering": "pump",
  "PAL": "pal",
  "Power Accessories & Lighting": "pal",
  "BESS": "bess",
  "Battery Energy Storage Systems": "bess",
  "Nitrogen": "portableAir",
  "Booster": "portableAir",
};

function getPrimaryLaneKey(bls) {
  if (!bls || bls.length === 0) return "portableAir";
  for (const bl of bls) {
    const key = BL_TO_LANE_KEY[bl];
    if (key) return key;
  }
  return "portableAir";
}

// ── "Before" scoring (legacy: territory + priority + BL boost, no lane scoring) ──
function legacyScore(project, profile, blScores) {
  const territories = profile.territories || [];
  const isNational = territories.length === 0 || territories.some(t => t.toUpperCase() === "NATIONAL");
  const projectState = project.projectState || "";
  const inTerritory = isNational || territories.some(t => {
    if (!t || t.toUpperCase() === "NATIONAL") return true;
    return projectState.toUpperCase() === t.toUpperCase() ||
      (project.location || "").toUpperCase().includes(t.toUpperCase());
  });
  if (!inTerritory) return 0;

  let score = 0;
  // Priority
  if (project.priority === "hot") score += 40;
  else if (project.priority === "warm") score += 20;
  else score += 5;

  // BL boost (old model: any BL score > 50 adds 15 pts)
  const assignedBLs = profile.assignedBusinessLines || [];
  for (const bl of assignedBLs) {
    const blScore = blScores.find(s => s.dimension === bl || s.dimension === BL_TO_LANE_KEY[bl]);
    if (blScore && blScore.score > 50) score += 15;
  }

  // Sector boost
  const sectorFocus = profile.sectorFocus || [];
  if (sectorFocus.includes(project.sector)) score += 10;

  return score;
}

// ── "After" scoring (new: laneScoring.ts — simplified inline version for audit) ──
function laneScore(project, profile, blScores) {
  const territories = profile.territories || [];
  const isNational = territories.length === 0 || territories.some(t => t.toUpperCase() === "NATIONAL");
  const projectState = project.projectState || "";
  const inTerritory = isNational || territories.some(t => {
    if (!t || t.toUpperCase() === "NATIONAL") return true;
    return projectState.toUpperCase() === t.toUpperCase() ||
      (project.location || "").toUpperCase().includes(t.toUpperCase());
  });
  if (!inTerritory) return { score: 0, breakdown: { territory: "miss" } };

  const assignedBLs = profile.assignedBusinessLines || [];
  const primaryLaneKey = getPrimaryLaneKey(assignedBLs);

  // Get BL scores by dimension
  const blMap = {};
  for (const s of blScores) {
    blMap[s.dimension] = s.score;
  }

  // Lane opportunity scores (simplified — mirrors laneScoring.ts computeLaneOpportunityScores)
  const portableAirScore = blMap["Portable Air"] ?? blMap["portableAir"] ?? 0;
  const pumpScore = Math.max(blMap["Pump/Dewatering"] ?? 0, blMap["Dewatering Pumps"] ?? 0, blMap["pump"] ?? 0);
  const palScore = blMap["PAL"] ?? blMap["Power Accessories & Lighting"] ?? 0;
  const bessScore = blMap["BESS"] ?? blMap["Battery Energy Storage Systems"] ?? 0;

  const laneScores = { portableAir: portableAirScore, pump: pumpScore, pal: palScore, bess: bessScore };
  const primaryLaneScore = laneScores[primaryLaneKey] ?? 0;

  // Non-primary lane scores for cross-sell
  const nonPrimaryScores = Object.entries(laneScores)
    .filter(([k]) => k !== primaryLaneKey)
    .map(([, v]) => v);
  const crossSellScore = nonPrimaryScores.length > 0 ? Math.max(...nonPrimaryScores) : 0;

  // Base score components
  let base = 0;
  // Priority
  if (project.priority === "hot") base += 30;
  else if (project.priority === "warm") base += 18;
  else base += 5;
  // Sector
  const sectorFocus = profile.sectorFocus || [];
  if (sectorFocus.includes(project.sector)) base += 12;
  // Lane fit
  const laneFit = primaryLaneScore >= 70 ? "High" : primaryLaneScore >= 40 ? "Medium" : "Low";
  if (laneFit === "High") base += 35;
  else if (laneFit === "Medium") base += 20;
  else if (crossSellScore >= 60) base += 15; // cross-sell
  else base += 5;

  return {
    score: base,
    breakdown: {
      territory: "match",
      priority: project.priority,
      primaryLaneKey,
      primaryLaneScore,
      crossSellScore,
      laneFit,
      base,
    }
  };
}

// ── Load data ─────────────────────────────────────────────────────────────────

const [users] = await db.query(
  `SELECT u.id, u.name, up.territories, up.assignedBusinessLines, up.sectorFocus
   FROM users u
   LEFT JOIN userProfiles up ON up.userId = u.id
   WHERE u.name IN ('Ryan Pemberton', 'Daniel Zec', 'Dan Day')`
);

const profiles = {};
for (const u of users) {
  profiles[u.name] = {
    userId: u.id,
    territories: parseBuf(u.territories) || [],
    assignedBusinessLines: parseBuf(u.assignedBusinessLines) || [],
    sectorFocus: parseBuf(u.sectorFocus) || [],
  };
}

// Load all hot+warm projects
const [projects] = await db.query(
  `SELECT id, name, location, projectState, value, owner, priority, sector,
          opportunityRoute, stage, overview, actionTier, productLane, stageCode,
          tenderCloseDate, isNew
   FROM projects
   WHERE priority IN ('hot','warm') AND (suppressed IS NULL OR suppressed = 0)
   LIMIT 600`
);

const projectIds = projects.map(p => p.id);

// Load BL scores
const [blRows] = await db.query(
  `SELECT projectId, scoringDimension AS dimension, score
   FROM projectBusinessLineScores
   WHERE projectId IN (${projectIds.map(() => "?").join(",")})`,
  projectIds
);
const blScoresMap = {};
for (const r of blRows) {
  if (!blScoresMap[r.projectId]) blScoresMap[r.projectId] = [];
  blScoresMap[r.projectId].push({ dimension: r.dimension, score: r.score });
}

// Load contacts per project
const [contactRows] = await db.query(
  `SELECT cp.projectId, c.contactTrustTier, c.roleRelevance, c.verificationStatus
   FROM contactProjects cp
   JOIN contacts c ON c.id = cp.contactId
   WHERE cp.projectId IN (${projectIds.map(() => "?").join(",")})`,
  projectIds
);
const contactsMap = {};
for (const r of contactRows) {
  if (!contactsMap[r.projectId]) contactsMap[r.projectId] = [];
  contactsMap[r.projectId].push(r);
}

// ── Audit function ────────────────────────────────────────────────────────────

function runAudit(repName) {
  const profile = profiles[repName];
  if (!profile) { console.log(`\n⚠️  Profile not found for ${repName}`); return; }

  const beforeScored = [];
  const afterScored = [];

  for (const p of projects) {
    const blScores = blScoresMap[p.id] || [];
    const contacts = contactsMap[p.id] || [];

    const legacySc = legacyScore(p, profile, blScores);
    const { score: laneSc, breakdown } = laneScore(p, profile, blScores);

    if (legacySc > 0) beforeScored.push({ id: p.id, name: p.name, priority: p.priority, sector: p.sector, state: p.projectState, score: legacySc });
    if (laneSc > 0) afterScored.push({ id: p.id, name: p.name, priority: p.priority, sector: p.sector, state: p.projectState, score: laneSc, breakdown, contactCount: contacts.length });
  }

  beforeScored.sort((a, b) => b.score - a.score);
  afterScored.sort((a, b) => b.score - a.score);

  const top10Before = beforeScored.slice(0, 10);
  const top10After = afterScored.slice(0, 10);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`REP: ${repName}`);
  console.log(`Territory: ${profile.territories.join(", ")} | BLs: ${profile.assignedBusinessLines.join(", ")}`);
  console.log(`Projects scored (before): ${beforeScored.length} | (after): ${afterScored.length}`);
  console.log(`\n── Top 10 BEFORE (legacy scoring) ──`);
  top10Before.forEach((p, i) => console.log(`  ${i+1}. [${p.id}] ${p.name.slice(0,50)} | ${p.priority} | ${p.state} | score:${p.score}`));

  console.log(`\n── Top 10 AFTER (laneScoring.ts) ──`);
  top10After.forEach((p, i) => console.log(`  ${i+1}. [${p.id}] ${p.name.slice(0,50)} | ${p.priority} | ${p.state} | score:${p.score}`));

  console.log(`\n── Score breakdown for top 5 AFTER ──`);
  top10After.slice(0, 5).forEach((p, i) => {
    const bd = p.breakdown;
    console.log(`  ${i+1}. [${p.id}] ${p.name.slice(0,50)}`);
    console.log(`     lane:${bd.primaryLaneKey}(${bd.primaryLaneScore}) xsell:${bd.crossSellScore} fit:${bd.laneFit} priority:${bd.priority} base:${bd.base} contacts:${p.contactCount}`);
  });

  // Must Act determination (mirrors emailDigest.ts logic)
  const actionReady = afterScored.filter(p => {
    const contacts = contactsMap[p.id] || [];
    const hasVerified = contacts.some(c => c.verificationStatus === "verified" || c.contactTrustTier === "verified");
    return p.priority === "hot" && hasVerified && p.score > 25;
  });
  const fallbackPool = afterScored.filter(p => {
    if (actionReady.find(a => a.id === p.id)) return false;
    const contacts = contactsMap[p.id] || [];
    const hasVerified = contacts.some(c => c.verificationStatus === "verified" || c.contactTrustTier === "verified");
    return p.priority === "warm" && hasVerified && p.score >= 35 && p.breakdown?.laneFit !== "Low";
  });

  const mustAct = actionReady.slice(0, 3);
  const usedFallback = mustAct.length < 3;
  if (usedFallback) {
    const needed = 3 - mustAct.length;
    mustAct.push(...fallbackPool.slice(0, needed));
  }

  console.log(`\n── Must Act ──`);
  console.log(`  action_ready: ${actionReady.length} | fallback used: ${usedFallback}`);
  mustAct.forEach((p, i) => {
    const isFallback = !actionReady.find(a => a.id === p.id);
    console.log(`  ${i+1}. [${p.id}] ${p.name.slice(0,50)} | ${p.priority} | score:${p.score} | ${isFallback ? "⚠️ FALLBACK" : "✅ action_ready"}`);
  });

  // Ordering change check
  const beforeIds = top10Before.map(p => p.id);
  const afterIds = top10After.map(p => p.id);
  const orderChanged = JSON.stringify(beforeIds) !== JSON.stringify(afterIds);
  const newInTop10 = afterIds.filter(id => !beforeIds.includes(id));
  const droppedFromTop10 = beforeIds.filter(id => !afterIds.includes(id));
  console.log(`\n── Ordering change ──`);
  console.log(`  Changed: ${orderChanged}`);
  if (newInTop10.length) console.log(`  New in top 10 after: [${newInTop10.join(", ")}]`);
  if (droppedFromTop10.length) console.log(`  Dropped from top 10 after: [${droppedFromTop10.join(", ")}]`);

  return { repName, top10Before: beforeIds, top10After: afterIds, mustActIds: mustAct.map(p => p.id), usedFallback };
}

// ── Cache/stale check ─────────────────────────────────────────────────────────
console.log("\n── Cache / stale digest check ──");
try {
  const [digestRows] = await db.query(
    `SELECT userId, generatedAt, weekStart
     FROM weeklyDigests
     ORDER BY generatedAt DESC
     LIMIT 10`
  );
  if (digestRows.length === 0) {
    console.log("  No cached digests found in weeklyDigests table — all previews are generated fresh.");
  } else {
    for (const r of digestRows) {
      console.log(`  userId:${r.userId} weekStart:${r.weekStart} generatedAt:${r.generatedAt}`);
    }
  }
} catch (e) {
  console.log(`  weeklyDigests table not found or empty — no caching layer: ${e.message}`);
}

// ── Run audits ────────────────────────────────────────────────────────────────
const results = [];
for (const name of ["Ryan Pemberton", "Daniel Zec", "Dan Day"]) {
  results.push(runAudit(name));
}

// ── Cross-user overlap summary ────────────────────────────────────────────────
console.log(`\n${"=".repeat(70)}`);
console.log("CROSS-USER OVERLAP SUMMARY");
for (let i = 0; i < results.length; i++) {
  for (let j = i + 1; j < results.length; j++) {
    const a = results[i], b = results[j];
    if (!a || !b) continue;
    const sharedTop10 = a.top10After.filter(id => b.top10After.includes(id));
    const sharedMustAct = a.mustActIds.filter(id => b.mustActIds.includes(id));
    console.log(`\n  ${a.repName} vs ${b.repName}:`);
    console.log(`    Shared top 10: ${sharedTop10.length} [${sharedTop10.join(", ")}]`);
    console.log(`    Shared Must Act: ${sharedMustAct.length} [${sharedMustAct.join(", ")}]`);
  }
}

await db.end();
console.log("\n✅ Audit complete.");
