/**
 * Generate digest preview summaries for all 6 registered catch-up recipients.
 * Shows: territory filter result, top projects, project count by tier.
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

// ── Load business line ID → name map ────────────────────────────────────────
const [blRows] = await conn.execute('SELECT id, name FROM businessLines');
const blIdToName = Object.fromEntries(blRows.map(r => [r.id, r.name]));

// ── Load all active non-suppressed opportunity projects ───────────────────────
const [projects] = await conn.execute(`
  SELECT id, name AS title, location, sector, priority, lifecycleStatus,
         projectType, suppressed, value AS estimatedValue, tenderCloseDate AS closingDate,
         matchedBusinessLines AS businessLineIds, actionTier, stage
  FROM projects
  WHERE suppressed = 0
    AND projectType = 'opportunity'
    AND lifecycleStatus = 'active'
  ORDER BY
    CASE priority WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END,
    value DESC
  LIMIT 2000
`);

// Resolve BL IDs to names on each project
for (const p of projects) {
  const ids = parseArr(p.businessLineIds);
  p.businessLineNames = ids.map(id => blIdToName[id]).filter(Boolean);
}

console.log(`\nLoaded ${projects.length} active non-suppressed opportunity projects`);

// ── Territory matching ────────────────────────────────────────────────────────
const NATIONAL_KEYWORDS = ["national", "australia", "multi-state", "nationwide"];
const STATE_PATTERNS = {
  WA: ["western australia", "wa", "perth", "pilbara", "kimberley", "goldfields", "mid west", "south west"],
  QLD: ["queensland", "qld", "brisbane", "townsville", "mackay", "cairns", "gladstone"],
  NSW: ["new south wales", "nsw", "sydney", "newcastle", "wollongong", "hunter"],
  VIC: ["victoria", "vic", "melbourne", "geelong", "ballarat"],
  SA: ["south australia", "sa", "adelaide"],
  TAS: ["tasmania", "tas", "hobart", "launceston"],
  ACT: ["australian capital territory", "act", "canberra"],
  NT: ["northern territory", "nt", "darwin", "alice springs"],
};

function matchesTerritory(project, territories) {
  if (!territories || territories.length === 0) return true;
  if (territories.some(t => t.toUpperCase() === "NATIONAL")) return true;
  const loc = (project.location || "").toLowerCase();
  if (NATIONAL_KEYWORDS.some(k => loc.includes(k))) return true;
  for (const terr of territories) {
    const patterns = STATE_PATTERNS[terr.toUpperCase()] || [terr.toLowerCase()];
    if (patterns.some(p => loc.includes(p))) return true;
  }
  return false;
}

function matchesBusinessLine(project, businessLines) {
  if (!businessLines || businessLines.length === 0) return true;
  const projectBLs = project.businessLineNames || [];
  if (projectBLs.length === 0) return true; // no BL assigned = include for all
  return businessLines.some(userBL =>
    projectBLs.some(projBL => projBL.toLowerCase() === userBL.toLowerCase())
  );
}

// ── Recipients ────────────────────────────────────────────────────────────────
const recipients = [
  { email: "leo.williams@atlascopco.com",    name: "Leo Williams",    territories: ["NATIONAL"],                      bl: ["Portable Air"] },
  { email: "ryan.pemberton@atlascopco.com",  name: "Ryan Pemberton",  territories: ["WA"],                             bl: ["Portable Air"] },
  { email: "daniel.zec@atlascopco.com",      name: "Daniel Zec",      territories: ["NSW", "VIC", "SA", "TAS", "ACT"], bl: ["Portable Air"] },
  { email: "dan.day@atlascopco.com",         name: "Dan Day",         territories: ["NSW", "VIC", "SA", "TAS", "ACT"], bl: ["Pump (Flow)"] },
  { email: "amit.bhargava@atlascopco.com",   name: "Amit Bhargava",   territories: ["NATIONAL"],                       bl: ["PAL", "BESS"] },
  { email: "egor.ivanov@atlascopco.com",     name: "Egor Ivanov",     territories: ["NATIONAL"],                       bl: ["BESS", "Portable Air", "PAL", "Pump (Flow)"] },
];

console.log("\n" + "═".repeat(100));
console.log("CATCH-UP DIGEST PREVIEW — W18 2026-04-27");
console.log("═".repeat(100));

for (const r of recipients) {
  // Filter by territory
  const terrMatched = projects.filter(p => matchesTerritory(p, r.territories));
  // Filter by business line (use territory-matched set)
  const blMatched = terrMatched.filter(p => matchesBusinessLine(p, r.bl));

  // Count by priority tier
  const hot = blMatched.filter(p => p.priority === "hot");
  const warm = blMatched.filter(p => p.priority === "warm");
  const cold = blMatched.filter(p => p.priority === "cold");

  // Top 5 projects
  const top5 = blMatched.slice(0, 5);

  console.log(`\n┌─ ${r.name.toUpperCase()} ─────────────────────────────────────────────────────────────────`);
  console.log(`│  Territory: ${r.territories.join(", ")}  |  Business Lines: ${r.bl.join(", ")}`);
  console.log(`│  Scope: ${terrMatched.length} territory-matched → ${blMatched.length} in-scope projects`);
  console.log(`│  Breakdown: ${hot.length} HOT  |  ${warm.length} WARM  |  ${cold.length} COLD`);
  console.log(`│`);
  console.log(`│  Top projects:`);
  for (const p of top5) {
    const val = p.estimatedValue ? `$${(Number(p.estimatedValue)/1e6).toFixed(0)}M` : "—";
    const close = p.closingDate ? new Date(p.closingDate).toLocaleDateString("en-AU", { day: "2-digit", month: "short" }) : "—";
    console.log(`│    [${(p.priority || "?").toUpperCase().padEnd(4)}] ${p.title.substring(0, 65).padEnd(65)} | ${p.location?.substring(0, 20).padEnd(20)} | ${val.padEnd(8)} | closes ${close}`);
  }
  if (blMatched.length > 5) console.log(`│    ... and ${blMatched.length - 5} more`);
  console.log(`└${"─".repeat(99)}`);
}

// ── Brett Hansen status ───────────────────────────────────────────────────────
console.log(`\n⚠ Brett Hansen (brett.hansen@atlascopco.com) — NOT REGISTERED`);
console.log(`  Expected scope: WA, NT | Pump (Flow)`);
console.log(`  Cannot receive digest until he registers and completes onboarding.`);

// ── Dedup safety check ────────────────────────────────────────────────────────
const [w18] = await conn.execute(
  `SELECT l.userId, u.name, l.status, l.sentDate FROM userEmailSendLog l
   JOIN users u ON u.id = l.userId
   WHERE l.weekKey = '2026-W18' AND l.digestType = 'monday' AND l.dryRun = 0`
);
console.log(`\n=== W18 Monday Dedup State ===`);
if (w18.length === 0) {
  console.log("✓ CLEAR — No W18 Monday sends recorded. Safe to send.");
} else {
  console.log(`⚠ ${w18.length} W18 Monday send(s) already recorded:`);
  for (const s of w18) console.log(`  ${s.name}: status=${s.status}, sentDate=${s.sentDate}`);
}

await conn.end();
console.log("\n✓ Preview generation complete.");
