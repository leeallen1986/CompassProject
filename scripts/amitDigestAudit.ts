/**
 * Amit Digest Audit — traces every project in Amit's digest pool
 * and checks PAL/BESS signal quality for each.
 */
import { getActiveProjects, getDb } from "../server/db";
import { userProfiles, projectBusinessLineScores } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { portableAirOpportunityGate, computePerUserFinalScore, applyTieBreaker } from "../server/laneScoring";

const AMIT_USER_ID = 3870014;

// PAL/BESS positive signal keywords — explicit package-level evidence
const PAL_BESS_POSITIVE = [
  // BESS / storage / hybrid power
  "bess", "battery energy storage", "battery storage", "energy storage system",
  "hybrid power", "microgrid", "micro-grid", "grid-scale storage", "grid scale storage",
  "pumped hydro", "pumped storage", "virtual power plant", "vpp",
  "behind the meter", "behind-the-meter", "grid stabilisation", "frequency regulation",
  "renewable integration", "solar storage", "wind storage",
  // PAL / temporary access / elevated access
  "pal", "portable access", "elevated access", "elevated work platform", "ewp",
  "boom lift", "scissor lift", "mast lift", "temporary access platform",
  "access platform", "working at height", "height access",
  "shutdown access", "maintenance access", "turnaround access",
  // Temporary power / remote site power
  "temporary power", "temp power", "temporary electricity", "standby power",
  "backup power", "emergency power", "generator hire", "generator rental",
  "diesel generator", "gas generator", "mobile power", "power station",
  "remote power", "off-grid power", "off grid power", "island power",
  "power supply solution", "power as a service",
  // Energisation / commissioning
  "energisation", "energize", "energise", "commissioning power",
  "temporary plant power", "construction power", "site power",
  "first power", "power-on", "power on date",
  // Lighting towers
  "lighting tower", "light tower", "temporary lighting", "site lighting",
  "construction lighting", "floodlight", "flood light",
  // Remote / mine site / offshore
  "remote site", "mine site power", "camp power", "accommodation power",
  "fly-in fly-out", "fifo", "offshore platform", "offshore power",
  "island mode", "black start",
];

// PAL/BESS hard suppress — broad civils/road/rail without explicit PAL/BESS use case
const PAL_BESS_SUPPRESS_NAMES = [
  /bruce highway/i,
  /inland rail/i,
  /highway upgrade/i,
  /road upgrade/i,
  /road widening/i,
  /motorway/i,
  /freeway/i,
  /expressway/i,
  /bridge upgrade/i,
  /bridge replacement/i,
  /level crossing/i,
  /rail corridor/i,
  /rail upgrade/i,
  /rail duplication/i,
  /signalling upgrade/i,
  /school upgrade/i,
  /school construction/i,
  /hospital upgrade/i,
  /hospital construction/i,
  /aged care/i,
  /social housing/i,
  /public housing/i,
  /community centre/i,
  /community center/i,
  /sports complex/i,
  /aquatic centre/i,
  /aquatic center/i,
  /golf course/i,
  /bus depot/i,
  /office fitout/i,
  /office refurbishment/i,
];

function checkPalBessGate(project: {
  name: string;
  overview: string | null;
  opportunityRoute: string | null;
  equipmentSignals: string | null;
  sector: string | null;
}): { pass: boolean; reason: string; positiveSignals: string[] } {
  const nameText = (project.name || "").toLowerCase();
  const overviewText = (project.overview || "").toLowerCase();
  const routeText = (project.opportunityRoute || "").toLowerCase();
  // For PAL/BESS: equipment signals are AI-inferred, so we use them only for industrial sectors
  const isIndustrial = ["energy", "mining", "oil_gas", "defence"].includes(project.sector || "");
  const equipRaw = Array.isArray(project.equipmentSignals)
    ? (project.equipmentSignals as string[]).join(" ")
    : (project.equipmentSignals || "");
  const equipText = isIndustrial ? String(equipRaw).toLowerCase() : "";
  const combined = `${nameText} ${overviewText} ${routeText} ${equipText}`;

  // Hard suppress by name pattern
  for (const pattern of PAL_BESS_SUPPRESS_NAMES) {
    if (pattern.test(project.name)) {
      return { pass: false, reason: `hard_suppress: name matches ${pattern}`, positiveSignals: [] };
    }
  }

  // Check for positive PAL/BESS signals
  const foundSignals: string[] = [];
  for (const signal of PAL_BESS_POSITIVE) {
    if (combined.includes(signal)) {
      foundSignals.push(signal);
    }
  }

  if (foundSignals.length > 0) {
    return { pass: true, reason: `positive_signals: ${foundSignals.slice(0, 3).join(", ")}`, positiveSignals: foundSignals };
  }

  // No positive signals — monitor only
  return { pass: false, reason: "no_pal_bess_signal: no explicit PAL/BESS package-level evidence", positiveSignals: [] };
}

async function main() {
  const drizzle = await getDb();
  const [profileRow] = await drizzle.select().from(userProfiles).where(eq(userProfiles.userId, AMIT_USER_ID));
  if (!profileRow) { console.error("Amit profile not found"); process.exit(1); }
  const profile = profileRow;

  console.log("Amit profile:", {
    territories: profile.territories,
    assignedBusinessLines: profile.assignedBusinessLines,
    sectorFocus: profile.sectorFocus,
    salesMotion: profile.salesMotion,
  });

  // Get all active projects
  const allProjects = await getActiveProjects();
  console.log(`Total active projects: ${allProjects.length}`);

  // Get BL scores for all projects
  const projectIds = allProjects.map(p => p.id);
  const blScores = projectIds.length > 0
    ? await drizzle.select().from(projectBusinessLineScores).where(inArray(projectBusinessLineScores.projectId, projectIds))
    : [];
  const blScoresMap = new Map<number, typeof blScores>();
  for (const s of blScores) {
    if (!blScoresMap.has(s.projectId)) blScoresMap.set(s.projectId, []);
    blScoresMap.get(s.projectId)!.push(s);
  }

  // Score all projects for Amit
  const results = allProjects.map(p => {
    const projectBLScores = blScoresMap.get(p.id) || [];
    const laneResult = computePerUserFinalScore(
      {
        id: p.id,
        name: p.name,
        location: p.location,
        value: p.value,
        owner: p.owner,
        priority: p.priority,
        sector: p.sector,
        opportunityRoute: p.opportunityRoute,
        isNew: (p as any).isNew,
        stage: p.stage,
        overview: p.overview,
        equipmentSignals: (p as any).equipmentSignals ?? null,
        contractors: (p as any).contractors ?? null,
      },
      {
        territories: profile.territories,
        assignedBusinessLines: profile.assignedBusinessLines,
        sectorFocus: profile.sectorFocus,
        stageTiming: profile.stageTiming,
        keyAccounts: profile.keyAccounts,
        buyerRoles: profile.buyerRoles,
        salesMotion: profile.salesMotion,
      },
      projectBLScores,
      [],
    );
    const laneResultWithTieBreaker = applyTieBreaker(laneResult, 0);
    const portableAirGate = portableAirOpportunityGate({
      name: p.name,
      overview: p.overview,
      opportunityRoute: p.opportunityRoute,
      equipmentSignals: (p as any).equipmentSignals ?? null,
      sector: p.sector,
      portableAirScore: laneResultWithTieBreaker.finalScoreWithTieBreaker,
    });
    const palBessGate = checkPalBessGate({
      name: p.name,
      overview: p.overview,
      opportunityRoute: p.opportunityRoute,
      equipmentSignals: (p as any).equipmentSignals ?? null,
      sector: p.sector,
    });

    return {
      id: p.id,
      name: p.name,
      location: p.location,
      sector: p.sector,
      priority: p.priority,
      score: laneResultWithTieBreaker.finalScoreWithTieBreaker,
      laneFitLabel: laneResultWithTieBreaker.laneFitLabel,
      channel: laneResultWithTieBreaker.channel,
      portableAirGate: portableAirGate.pass ? "PASS" : portableAirGate.suppress ? "SUPPRESS" : "MONITOR",
      portableAirGateReason: portableAirGate.reason,
      palBessGate: palBessGate.pass ? "PASS" : "SUPPRESS",
      palBessGateReason: palBessGate.reason,
      palBessSignals: palBessGate.positiveSignals.slice(0, 3),
    };
  });

  // Sort by score
  results.sort((a, b) => b.score - a.score);

  // Filter to projects that would appear in digest (score > 25)
  const digestPool = results.filter(p => p.score > 25);
  console.log(`\nDigest pool (score > 25): ${digestPool.length} projects`);

  // Show top 20 with PAL/BESS gate result
  console.log("\n=== TOP 20 PROJECTS IN AMIT'S DIGEST POOL ===");
  console.log("Rank | Score | PA Gate | PAL/BESS Gate | Priority | Sector | Name");
  console.log("-----|-------|---------|---------------|----------|--------|-----");
  for (let i = 0; i < Math.min(20, digestPool.length); i++) {
    const p = digestPool[i];
    console.log(
      `${String(i+1).padStart(4)} | ${String(Math.round(p.score)).padStart(5)} | ${p.portableAirGate.padEnd(7)} | ${p.palBessGate.padEnd(13)} | ${(p.priority || "").padEnd(8)} | ${(p.sector || "").padEnd(14)} | ${p.name}`
    );
    if (p.palBessGate === "PASS") {
      console.log(`       signals: ${p.palBessSignals.join(", ")}`);
    } else {
      console.log(`       reason: ${p.palBessGateReason}`);
    }
  }

  // Summary
  const passBoth = digestPool.filter(p => p.portableAirGate === "PASS" && p.palBessGate === "PASS");
  const passPortableAirOnly = digestPool.filter(p => p.portableAirGate === "PASS" && p.palBessGate === "SUPPRESS");
  const suppressBoth = digestPool.filter(p => p.portableAirGate === "SUPPRESS" || p.portableAirGate === "MONITOR");

  console.log("\n=== SUMMARY ===");
  console.log(`Pass both gates (PA + PAL/BESS): ${passBoth.length}`);
  console.log(`Pass PA gate only (no PAL/BESS signal): ${passPortableAirOnly.length}`);
  console.log(`Suppressed/Monitor by PA gate: ${suppressBoth.length}`);

  console.log("\n=== PROJECTS THAT WOULD BE SUPPRESSED BY PAL/BESS GATE ===");
  console.log("(These currently appear in Amit's digest but should be removed)");
  for (const p of passPortableAirOnly.slice(0, 15)) {
    console.log(`  [${p.priority?.toUpperCase()}] ${p.name} (${p.location}) — score=${Math.round(p.score)}`);
    console.log(`    reason: ${p.palBessGateReason}`);
  }

  console.log("\n=== PROJECTS THAT PASS PAL/BESS GATE (Amit's real opportunities) ===");
  for (const p of passBoth.slice(0, 15)) {
    console.log(`  [${p.priority?.toUpperCase()}] ${p.name} (${p.location}) — score=${Math.round(p.score)}`);
    console.log(`    signals: ${p.palBessSignals.join(", ")}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
