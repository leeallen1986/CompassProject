/**
 * Digest preview diagnostic — runs scoreAndFilterProjects + section assignment
 * for each of the 5 test reps and prints the Must Act section.
 *
 * Run: node diag-digest-preview.mjs
 */
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// ── Load reps ──────────────────────────────────────────────────────────────
const repNames = ["Ryan Pemberton", "Daniel Zec", "Dan Day", "Leo Williams", "Amit Bhargava"];
const [users] = await db.query(
  `SELECT id, name, email FROM users WHERE name IN (${repNames.map(() => "?").join(",")})`,
  repNames
);

// ── Load profiles ──────────────────────────────────────────────────────────
const userIds = users.map(u => u.id);
const [profiles] = await db.query(
  `SELECT * FROM userProfiles WHERE userId IN (${userIds.map(() => "?").join(",")})`,
  userIds
);
const profileMap = Object.fromEntries(profiles.map(p => [p.userId, p]));

// ── Load projects with BL scores ───────────────────────────────────────────
const [projects] = await db.query(`
  SELECT p.id, p.name, p.location, p.projectState, p.value, p.owner, p.priority,
         p.sector, p.opportunityRoute, p.stage, p.overview, p.actionTier,
         p.productLane, p.stageCode, p.tenderCloseDate, p.isNew,
         p.govFallbackStatus, p.enrichmentBlockedReason,
         (SELECT COUNT(*) FROM contactProjects cp WHERE cp.projectId = p.id) AS contactCount
  FROM projects p
  WHERE p.priority IN ('hot','warm')
    AND (p.suppressed IS NULL OR p.suppressed = 0)
  LIMIT 500
`);

const projectIds = projects.map(p => p.id);
let blScoresMap = {};
if (projectIds.length > 0) {
  const [blRows] = await db.query(
    `SELECT projectId, scoringDimension, score FROM projectBusinessLineScores
     WHERE projectId IN (${projectIds.map(() => "?").join(",")})`,
    projectIds
  );
  for (const row of blRows) {
    if (!blScoresMap[row.projectId]) blScoresMap[row.projectId] = [];
    blScoresMap[row.projectId].push({ dimension: row.scoringDimension, score: row.score });
  }
}

// ── Load contacts ──────────────────────────────────────────────────────────
let contactsMap = {};
if (projectIds.length > 0) {
  const [contacts] = await db.query(
    `SELECT cp.projectId, c.name, c.title, c.email, c.linkedin, c.roleRelevance, c.contactTrustTier
     FROM contactProjects cp
     JOIN contacts c ON c.id = cp.contactId
     WHERE cp.projectId IN (${projectIds.map(() => "?").join(",")})`,
    projectIds
  );
  for (const c of contacts) {
    if (!contactsMap[c.projectId]) contactsMap[c.projectId] = [];
    contactsMap[c.projectId].push(c);
  }
}

// ── Inline lane scoring (mirrors laneScoring.ts logic) ────────────────────
const BL_TO_LANE_KEY = {
  "Portable Air": "portableAir",
  "PT Capital Sales": "portableAir",
  "PAL": "pal",
  "BESS": "bess",
  "Pump (Flow)": "pump",
  "Dewatering Pumps": "pump",
  "Pump/Dewatering": "pump",
  "Nitrogen": "portableAir",
  "Booster": "portableAir",
};

function getLaneScore(blScores, dimension) {
  const row = (blScores || []).find(r => r.dimension === dimension);
  return row ? Number(row.score) : 0;
}

function computeLaneScores(blScores) {
  return {
    portableAir: getLaneScore(blScores, "Portable Air"),
    pump: Math.max(getLaneScore(blScores, "Pump/Dewatering"), getLaneScore(blScores, "Dewatering Pumps")),
    pal: getLaneScore(blScores, "PAL"),
    bess: getLaneScore(blScores, "BESS"),
  };
}

function getPrimaryLaneScore(laneScores, assignedBLs) {
  let best = 0;
  for (const bl of assignedBLs) {
    const key = BL_TO_LANE_KEY[bl];
    if (key && laneScores[key] > best) best = laneScores[key];
  }
  return best;
}

function getChannel(laneScores, assignedBLs, primaryScore) {
  if (primaryScore >= 60) return "direct";
  const crossSell = Object.entries(laneScores)
    .filter(([k]) => !assignedBLs.some(bl => BL_TO_LANE_KEY[bl] === k))
    .reduce((max, [, v]) => Math.max(max, v), 0);
  if (crossSell >= 50) return "crosssell";
  if (primaryScore >= 30) return "rental";
  return "monitor";
}

function getLaneFitLabel(score) {
  if (score >= 65) return "High";
  if (score >= 40) return "Medium";
  if (score >= 20) return "Low";
  return "Not relevant";
}

function classifyBriefReadiness(project, contacts, visibilityTier) {
  if (visibilityTier === "suppress" || visibilityTier === "monitor_only") {
    return { readiness: "monitor_only", bestContact: null };
  }
  const tier = project.actionTier || "tier3_monitor";
  const priority = project.priority;
  if (tier === "tier3_monitor") return { readiness: "monitor_only", bestContact: null };
  if (tier === "tier2_warm" && priority === "cold") return { readiness: "monitor_only", bestContact: null };

  const sendReady = (contacts || [])
    .filter(c => c.contactTrustTier === "send_ready" && (c.roleRelevance === "high" || c.roleRelevance === "medium") && (c.email || c.linkedin))
    .sort((a, b) => (b.roleRelevance === "high" ? 1 : 0) - (a.roleRelevance === "high" ? 1 : 0));

  if (sendReady.length > 0) {
    const best = sendReady[0];
    return { readiness: "action_ready", bestContact: { name: best.name, title: best.title, email: best.email } };
  }
  return { readiness: "discovery_needed", bestContact: null };
}

function classifyVisibility(primaryScore, crossSellScore, actionabilityScore, hasProfile) {
  if (!hasProfile) return "watchlist_candidate";
  if (primaryScore < 15 && crossSellScore < 15 && actionabilityScore < 20) return "suppress";
  if (primaryScore < 20 && crossSellScore < 20) return "monitor_only";
  if (primaryScore >= 50 || crossSellScore >= 50) return "must_act_candidate";
  return "watchlist_candidate";
}

// ── Territory filter ───────────────────────────────────────────────────────
const STATE_KEYWORDS = {
  WA: ["western australia", "wa", "perth", "pilbara", "kalgoorlie", "karratha", "port hedland"],
  QLD: ["queensland", "qld", "brisbane", "townsville", "mackay", "gladstone"],
  NSW: ["new south wales", "nsw", "sydney", "newcastle", "hunter valley", "wollongong"],
  VIC: ["victoria", "vic", "melbourne", "geelong"],
  SA: ["south australia", "sa", "adelaide", "olympic dam"],
  NT: ["northern territory", "nt", "darwin"],
  TAS: ["tasmania", "tas", "hobart"],
  ACT: ["act", "canberra"],
};
const AU_STATES = new Set(Object.keys(STATE_KEYWORDS));

function matchesTerritory(project, territories) {
  if (!territories || territories.length === 0) return true;
  if (territories.some(t => t.toUpperCase() === "NATIONAL")) return true;
  const projectState = (project.projectState || "").toUpperCase();
  const loc = (project.location || "").toLowerCase();
  return territories.some(t => {
    const tUpper = t.toUpperCase();
    if (projectState && AU_STATES.has(projectState) && projectState !== tUpper) return false;
    const keywords = STATE_KEYWORDS[tUpper] || [t.toLowerCase()];
    return keywords.some(kw => kw.length <= 3
      ? new RegExp(`(?:^|[\\s,;/|()\-])${kw}(?:$|[\\s,;/|()\-])`, "i").test(loc)
      : loc.includes(kw));
  });
}

// ── Run preview for each rep ───────────────────────────────────────────────
for (const user of users) {
  const profile = profileMap[user.id];
  const assignedBLs = profile
    ? (typeof profile.assignedBusinessLines === "string"
        ? JSON.parse(profile.assignedBusinessLines || "[]")
        : profile.assignedBusinessLines || [])
    : [];
  const territories = profile
    ? (typeof profile.territories === "string"
        ? JSON.parse(profile.territories || "[]")
        : profile.territories || [])
    : [];

  const isNational = territories.some(t => t.toUpperCase() === "NATIONAL");

  // Score + filter projects
  const scored = [];
  for (const p of projects) {
    if (!isNational && !matchesTerritory(p, territories)) continue;
    const blScores = blScoresMap[p.id] || [];
    const laneScores = computeLaneScores(blScores);
    const primaryScore = getPrimaryLaneScore(laneScores, assignedBLs);
    const crossSellScore = Object.entries(laneScores)
      .filter(([k]) => !assignedBLs.some(bl => BL_TO_LANE_KEY[bl] === k))
      .reduce((max, [, v]) => Math.max(max, v), 0);
    const actionabilityScore = p.actionTier === "tier1_actionable" ? 70 : p.actionTier === "tier2_warm" ? 40 : 10;
    const visibilityTier = classifyVisibility(primaryScore, crossSellScore, actionabilityScore, assignedBLs.length > 0);
    if (visibilityTier === "suppress") continue;

    const contacts = contactsMap[p.id] || [];
    const { readiness, bestContact } = classifyBriefReadiness(p, contacts, visibilityTier);
    const laneFitLabel = getLaneFitLabel(primaryScore);
    const channel = getChannel(laneScores, assignedBLs, primaryScore);
    const finalScore = primaryScore + (p.priority === "hot" ? 10 : 0) + (p.actionTier === "tier1_actionable" ? 5 : 0);

    scored.push({
      ...p,
      primaryScore,
      finalScore,
      laneFitLabel,
      channel,
      visibilityTier,
      briefReadiness: readiness,
      bestContact,
    });
  }

  scored.sort((a, b) => b.finalScore - a.finalScore);

  const actionReady = scored.filter(p => p.briefReadiness === "action_ready");
  const discoveryNeeded = scored.filter(p => p.briefReadiness === "discovery_needed");

  // Must Act: primary + fallback
  let mustAct = actionReady.slice(0, 3);
  if (mustAct.length < 3) {
    const fallback = scored
      .filter(p => !mustAct.some(a => a.id === p.id) && p.briefReadiness !== "monitor_only" && p.priority === "warm" && (p.laneFitLabel === "High" || p.laneFitLabel === "Medium") && p.finalScore >= 35)
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, 3 - mustAct.length)
      .map(p => ({ ...p, isFallback: true }));
    mustAct = [...mustAct, ...fallback];
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`REP: ${user.name}`);
  console.log(`Territory: ${territories.join(", ") || "none"} | BLs: ${assignedBLs.join(", ") || "none"}`);
  console.log(`Projects in scope: ${scored.length} | Action-ready: ${actionReady.length} | Discovery-needed: ${discoveryNeeded.length}`);
  console.log(`${"=".repeat(70)}`);

  if (mustAct.length === 0) {
    console.log("🟥 Must Act: EMPTY — no qualifying projects");
  } else {
    console.log(`🟥 Must Act (${mustAct.length}):`);
    for (const p of mustAct) {
      const fallbackTag = p.isFallback ? " [FALLBACK ⚠️ contacts need validation]" : "";
      const contactTag = p.bestContact?.email ? ` → ${p.bestContact.email}` : p.bestContact?.name ? ` → ${p.bestContact.name}` : "";
      console.log(`  ${p.isFallback ? "⚠️" : "✅"} [${p.laneFitLabel} fit | ${p.channel}] ${p.name} (score:${p.finalScore}, ${p.priority})${fallbackTag}${contactTag}`);
    }
  }

  console.log(`\n📋 Top 3 This Week:`);
  for (const p of scored.slice(0, 3)) {
    console.log(`  [${p.laneFitLabel} fit | ${p.channel}] ${p.name} (score:${p.finalScore}, ${p.priority}, ${p.briefReadiness})`);
  }
}

await db.end();
console.log("\n✅ Digest preview complete.");
