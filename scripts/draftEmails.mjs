/**
 * Generate draft email content for Ryan Pemberton, Brett Hansen, and Amit Bhargava.
 * Uses the same filtering logic as the live email digest.
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

const parseArr = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return []; }
};

// ── Load business line ID → name map ─────────────────────────────────────────
const [blRows] = await conn.execute("SELECT id, name FROM businessLines");
const blIdToName = Object.fromEntries(blRows.map(r => [r.id, r.name]));

// ── Load all active non-suppressed opportunity projects ───────────────────────
const [allProjects] = await conn.execute(`
  SELECT id, name, location, sector, priority, lifecycleStatus,
         value, tenderCloseDate, matchedBusinessLines, actionTier,
         stage, overview, contractors, opportunityNote, equipmentSignals
  FROM projects
  WHERE suppressed = 0
    AND projectType = 'opportunity'
    AND lifecycleStatus = 'active'
  ORDER BY
    CASE priority WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END,
    value DESC
`);

// Resolve BL IDs to names
for (const p of allProjects) {
  const ids = parseArr(p.matchedBusinessLines);
  p.blNames = ids.map(id => blIdToName[id]).filter(Boolean);
}

// ── Territory matching (mirrors emailDigest logic) ────────────────────────────
const STATE_PATTERNS = {
  WA:  ["western australia", " wa ", "perth", "pilbara", "kimberley", "goldfields", "mid west", "south west", ", wa", "(wa)"],
  QLD: ["queensland", " qld", "brisbane", "townsville", "mackay", "cairns", "gladstone", ", qld", "(qld)"],
  NSW: ["new south wales", " nsw", "sydney", "newcastle", "wollongong", "hunter", ", nsw", "(nsw)"],
  VIC: ["victoria", " vic", "melbourne", "geelong", "ballarat", ", vic", "(vic)"],
  SA:  ["south australia", " sa ", "adelaide", ", sa,", "(sa)"],
  TAS: ["tasmania", " tas", "hobart", "launceston", ", tas", "(tas)"],
  ACT: ["australian capital territory", " act", "canberra", ", act", "(act)"],
  NT:  ["northern territory", " nt ", "darwin", "alice springs", ", nt,", "(nt)"],
};

function matchesTerritory(project, territories) {
  if (!territories || territories.length === 0) return true;
  if (territories.some(t => t.toUpperCase() === "NATIONAL")) return true;
  const loc = (project.location || "").toLowerCase();
  for (const terr of territories) {
    const patterns = STATE_PATTERNS[terr.toUpperCase()] || [terr.toLowerCase()];
    if (patterns.some(p => loc.includes(p))) return true;
  }
  return false;
}

function matchesBusinessLine(project, userBLs) {
  if (!userBLs || userBLs.length === 0) return true;
  if (!project.blNames || project.blNames.length === 0) return true;
  return userBLs.some(ubl =>
    project.blNames.some(pbl => pbl.toLowerCase() === ubl.toLowerCase())
  );
}

// ── Recipients to preview ─────────────────────────────────────────────────────
const recipients = [
  { name: "Ryan Pemberton",  email: "ryan.pemberton@atlascopco.com",  territories: ["WA"],         bl: ["Portable Air"] },
  { name: "Brett Hansen",    email: "brett.hansen@sykesgroup.com",    territories: ["WA", "NT"],   bl: ["Pump (Flow)"] },
  { name: "Amit Bhargava",   email: "amit.bhargava@atlascopco.com",   territories: ["NATIONAL"],   bl: ["PAL", "BESS"] },
];

const weekEnding = "4 May 2026";

for (const r of recipients) {
  const scoped = allProjects
    .filter(p => matchesTerritory(p, r.territories))
    .filter(p => matchesBusinessLine(p, r.bl));

  const hot  = scoped.filter(p => p.priority === "hot");
  const warm = scoped.filter(p => p.priority === "warm");
  const cold = scoped.filter(p => p.priority === "cold");

  // Top projects for email: up to 5 hot, then fill to 8 with warm
  const featured = [
    ...hot.slice(0, 5),
    ...warm.slice(0, Math.max(0, 8 - Math.min(hot.length, 5))),
  ].slice(0, 8);

  const formatVal = (v) => {
    const n = Number(v);
    if (!n || isNaN(n)) return "Value TBC";
    if (n >= 1e9) return `$${(n/1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n/1e6).toFixed(0)}M`;
    return `$${(n/1e3).toFixed(0)}K`;
  };

  const formatDate = (d) => {
    if (!d) return null;
    return new Date(d).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  };

  console.log("\n" + "═".repeat(90));
  console.log(`DRAFT EMAIL — ${r.name.toUpperCase()} <${r.email}>`);
  console.log(`Territory: ${r.territories.join(", ")}  |  Business Lines: ${r.bl.join(", ")}`);
  console.log("═".repeat(90));
  console.log(`Subject: Atlas Copco Power Technique — Weekly Intelligence Digest, W/E ${weekEnding}`);
  console.log("─".repeat(90));
  console.log(`Hi ${r.name.split(" ")[0]},`);
  console.log();
  console.log(`Here is your personalised market intelligence digest for the week ending ${weekEnding}.`);
  console.log(`Your scope: ${r.territories.join(", ")} | ${r.bl.join(", ")}`);
  console.log();
  console.log(`── PIPELINE SNAPSHOT ──────────────────────────────────────────────────────────`);
  console.log(`  ${hot.length} HOT  |  ${warm.length} WARM  |  ${cold.length} COLD  |  ${scoped.length} total in-scope projects`);
  console.log();
  console.log(`── FEATURED PROJECTS ──────────────────────────────────────────────────────────`);

  if (featured.length === 0) {
    console.log("  No projects matched your scope this week.");
  } else {
    for (let i = 0; i < featured.length; i++) {
      const p = featured[i];
      const val = formatVal(p.value);
      const close = formatDate(p.tenderCloseDate);
      const blBadge = p.blNames.join(", ") || "—";
      const tier = (p.priority || "?").toUpperCase();
      const tierIcon = tier === "HOT" ? "🔴" : tier === "WARM" ? "🟡" : "🔵";
      console.log();
      console.log(`  ${i+1}. ${tierIcon} [${tier}] ${p.name}`);
      console.log(`     Location: ${p.location || "Unknown"}`);
      console.log(`     Sector:   ${p.sector || "—"}  |  Value: ${val}  |  Business Line: ${blBadge}`);
      if (close) console.log(`     Closes:   ${close}`);
      if (p.stage) console.log(`     Stage:    ${p.stage}`);
      if (p.overview) {
        const snippet = (p.overview || "").substring(0, 200).replace(/\n/g, " ");
        console.log(`     Overview: ${snippet}${p.overview.length > 200 ? "..." : ""}`);
      }
      if (p.contractors) {
        const c = parseArr(p.contractors);
        if (c.length > 0) console.log(`     Contractors: ${c.slice(0,3).map(x => x.name || x).join(", ")}`);
      }
      if (p.opportunityNote) {
        console.log(`     Note:     ${(p.opportunityNote || "").substring(0, 150)}`);
      }
    }
  }

  console.log();
  console.log(`── ACTION ITEMS ───────────────────────────────────────────────────────────────`);
  const actionProjects = hot.slice(0, 3);
  if (actionProjects.length === 0) {
    console.log("  No urgent action items this week.");
  } else {
    actionProjects.forEach((p, i) => {
      console.log(`  ${i+1}. Follow up on: ${p.name} (${p.location || "—"})`);
    });
  }

  console.log();
  console.log(`── FOOTER ─────────────────────────────────────────────────────────────────────`);
  console.log(`  View full dashboard: https://compasspt.manus.space`);
  console.log(`  To update your preferences, visit Settings in the dashboard.`);
  console.log(`  This digest is generated automatically from live market intelligence data.`);
  console.log();
}

await conn.end();
console.log("\n✓ Draft emails generated.");
