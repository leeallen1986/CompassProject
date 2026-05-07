/**
 * Ryan Gate Audit V4 — post-gate-strengthening
 * Shows which projects pass / fail the new portableAirOpportunityGate for Ryan (WA rep)
 */
import { createConnection } from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const db = await createConnection(process.env.DATABASE_URL);

// Fetch Ryan's projects (WA territory, tier1/tier2)
// projectBusinessLineScores uses scoringDimension text, not a businessLineId FK.
// We look for the Portable Air dimension score and join to projects.
// actionTier, relevanceScore, laneFitLabel, visibilityTier, channel live in the projects table itself.
const [projects] = await db.execute(`
  SELECT p.id, p.name, p.sector, p.stage, p.owner, p.location,
         p.overview, p.opportunityRoute, p.projectState,
         p.actionTier, p.priority,
         pbs.score AS portableAirScore
  FROM projects p
  JOIN projectBusinessLineScores pbs
    ON pbs.projectId = p.id
    AND pbs.scoringDimension = 'Portable Air'
  WHERE p.lifecycleStatus = 'active'
    AND p.actionTier IN ('tier1_actionable','tier2_warm')
    AND (
      LOWER(p.projectState) = 'wa'
      OR LOWER(p.location) LIKE '%western australia%'
      OR LOWER(p.location) LIKE '% wa%'
      OR LOWER(p.location) LIKE '%perth%'
      OR LOWER(p.location) LIKE '%pilbara%'
      OR LOWER(p.location) LIKE '%kalgoorlie%'
      OR LOWER(p.location) LIKE '%karratha%'
      OR LOWER(p.location) LIKE '%port hedland%'
    )
  ORDER BY pbs.score DESC
  LIMIT 50
`);

await db.end();

// Inline the gate logic (mirrors the updated laneScoring.ts)
function portableAirOpportunityGate(project, portableAirScore) {
  const text = [
    project.name,
    project.overview ?? "",
    project.opportunityRoute ?? "",
  ].join(" ").toLowerCase();
  const ownerText = (project.owner ?? "").toLowerCase();

  // Hard suppress: negative signals
  const hardSuppressPatterns = [
    [/\b(school|primary school|high school|secondary school|college|university|tafe|education|childcare|kindergarten|early learning)\b/, "education facility"],
    [/\b(hospital|health|aged care|nursing home|medical centre|community health|mental health facility|ambulance)\b/, "health/community facility"],
    [/\b(residential|apartment|townhouse|housing estate|retirement village|social housing|affordable housing)\b/, "residential development"],
    [/\b(community centre|recreation centre|sports centre|library|museum|art gallery|cultural centre|civic)\b/, "community/civic facility"],
  ];
  for (const [pattern, reason] of hardSuppressPatterns) {
    if (pattern.test(text)) return { pass: false, reason, level: 'SUPPRESS' };
  }

  // Hard suppress: property developer owners
  const propertyDevs = ["stockland","mirvac","lendlease","scentre","vicinity","dexus","charter hall","goodman group","frasers property","cromwell"];
  if (propertyDevs.some(d => ownerText.includes(d))) {
    const hasOverride = ["compressor","portable air","drilling","mining","oil","gas","pipeline","commissioning","shutdown","blast","pneumatic"].some(kw => text.includes(kw));
    if (!hasOverride) return { pass: false, reason: `property developer owner (${project.owner})`, level: 'SUPPRESS' };
  }

  // Hard suppress: programme wrappers
  const programmePatterns = [
    [/\b(infrastructure priority list|priority list|ipl)\b/, "programme/priority list wrapper"],
    [/\b(long.?term partner(ing)? agreement|partnering agreement|framework agreement|master services agreement|msa)\b/, "framework/partnering agreement"],
    [/\b(seismic survey|geophysical survey|aeromagnetic survey|gravity survey)\b/, "seismic/geophysical survey"],
    [/\b(research facility|research centre|innovation hub|technology hub|energy research)\b/, "research/innovation facility"],
    [/\b(rare earth.{0,30}(partnership|agreement|framework)|partnership.{0,30}rare earth)\b/, "rare earth partnership/framework"],
  ];
  for (const [pattern, reason] of programmePatterns) {
    if (pattern.test(text)) return { pass: false, reason, level: 'SUPPRESS' };
  }

  // Explicit compressor signals
  const explicitSignals = [
    "compressor","portable air","air compressor","cfm","psi",
    "pneumatic","abrasive blast","sandblast","grit blast","shot blast",
    "drilling","blast hole","blasthole","exploration drilling","rotary drill",
    "rock drill","drill rig","borehole","water bore","aircore","air core",
    "shutdown","turnaround","plant air","instrument air","process air",
    "commissioning air","tie-in","hydrostatic test","pigging",
    "contractor fleet","fleet replacement","equipment supply",
  ];
  const hasExplicit = explicitSignals.some(kw => text.includes(kw));

  // Soft suppress: weak-signal categories
  const weakPatterns = [
    [/\b(wind farm|wind turbine|wind energy|offshore wind|onshore wind)\b/, "wind project"],
    [/\b(battery storage|bess|grid-scale battery|utility battery|battery energy storage)\b/, "battery storage"],
    [/\b(desalination|desal plant|water treatment|wastewater treatment|sewage treatment)\b/, "desal/water treatment"],
    [/\b(solar farm|solar park|photovoltaic|pv farm|solar generation)\b/, "solar farm"],
    [/\b(road upgrade|road widening|highway upgrade|intersection upgrade|footpath|footbridge|pedestrian bridge)\b/, "minor civil works"],
    [/\b(office fitout|commercial fitout|retail fitout|fit-out|fitout)\b/, "commercial fitout"],
    [/\b(green steel|hydrogen plant|hydrogen facility|green hydrogen|renewable energy project)\b/, "green energy project"],
  ];
  for (const [pattern, reason] of weakPatterns) {
    if (pattern.test(text) && !hasExplicit) return { pass: false, reason, level: 'MONITOR_ONLY' };
  }

  if (portableAirScore < 15 && !hasExplicit) {
    return { pass: false, reason: `low lane score (${portableAirScore}) no explicit signal`, level: 'MONITOR_ONLY' };
  }

  // Positive signals (tightened — no generic "construction"/"civil"/"infrastructure")
  const positiveSignals = [
    "drilling","blast hole","blasthole","exploration drilling","rotary drill",
    "rock drill","drill rig","borehole","water bore","aircore","air core",
    "exploration","mine development","underground mine","open pit","open cut",
    "quarrying","tunnelling","tunneling","shaft sinking",
    "commissioning","tie-in","shutdown","turnaround","plant air","instrument air",
    "process air","commissioning air","hydrostatic test","pigging",
    "abrasive blast","sandblast","grit blast","shot blast","coating","painting",
    "pneumatic","compressor","portable air","air compressor","cfm","psi",
    "contractor fleet","fleet replacement","equipment supply","equipment procurement",
    "remote site","off-grid","fly-in fly-out","fifo","camp",
    "oil field","gas field","lng","lng plant","pipeline","offshore",
    "fpso","refinery","petrochemical","gas processing","lng terminal",
    "gas power","gas generation","gas plant",
    "mining","mineral processing","ore processing","concentrator","smelter",
    "gold mine","gold project","iron ore","copper mine","nickel mine",
    "coal mine","bauxite","lithium mine",
    "naval","frigate","destroyer","submarine","naval vessel","warship",
    "military base","defence facility","shipyard",
    "port development","berth","jetty","wharf","bulk terminal",
    "power station","power plant","gas turbine","diesel generation",
    "decommissioning","demolition",
  ];
  const hasPositive = positiveSignals.some(kw => text.includes(kw));

  if (portableAirScore >= 40) return { pass: true };
  if (hasExplicit) return { pass: true };
  if (hasPositive && portableAirScore >= 20) return { pass: true };

  const highValueSectors = ["mining","oil_gas","defence"];
  if (highValueSectors.includes((project.sector ?? "").toLowerCase()) && hasPositive) return { pass: true };

  return { pass: false, reason: `insufficient signal (lane score ${portableAirScore}, no positive keywords)`, level: 'MONITOR_ONLY' };
}

// Run audit
let passCount = 0;
let suppressCount = 0;
let monitorCount = 0;
const suppressed = [];
const passed = [];

for (const p of projects) {
  const score = Number(p.portableAirScore ?? 0);
  const gate = portableAirOpportunityGate(p, score);
  if (gate.pass) {
    passCount++;
    passed.push({ name: p.name, score, tier: p.actionTier, sector: p.sector });
  } else {
    if (gate.level === 'SUPPRESS') suppressCount++;
    else monitorCount++;
    suppressed.push({ name: p.name, score, tier: p.actionTier, sector: p.sector, reason: gate.reason, level: gate.level ?? (gate.pass ? 'PASS' : 'MONITOR_ONLY') });
  }
}

console.log("\n=== RYAN WA — PORTABLE AIR GATE AUDIT (V4 — Tightened Gate) ===\n");
console.log(`Total projects in WA tier1/tier2 pool: ${projects.length}`);
console.log(`✅ PASS (enter digest pool): ${passCount}`);
console.log(`🚫 SUPPRESS (hard excluded):  ${suppressCount}`);
console.log(`⚠️  MONITOR_ONLY (demoted):   ${monitorCount}`);

console.log("\n--- SUPPRESSED / DEMOTED PROJECTS ---");
for (const p of suppressed) {
  console.log(`  [${p.level}] ${p.name} (score:${p.score}, ${p.sector})`);
  console.log(`    Reason: ${p.reason}`);
}

console.log("\n--- PROJECTS THAT PASS (digest pool) ---");
for (const p of passed) {
  console.log(`  ✅ ${p.name} (score:${p.score}, tier:${p.tier}, ${p.sector}, channel:${p.channel})`);
}
