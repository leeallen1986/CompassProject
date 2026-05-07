/**
 * Ryan WA Specialty-Air Audit
 * 
 * Diagnoses why specialty-air projects are not surfacing in Ryan's digest.
 * Covers:
 * 1. Top 20 candidates with family classification and section eligibility
 * 2. Specialty-air candidate audit (Dryer/N2/Booster/Package)
 * 3. Upstream capture audit (explicit specialty-air signals in DB)
 * 4. Closing Soon audit (GE Frame 9)
 */

import * as dotenv from "dotenv";
dotenv.config();

import mysql from "mysql2/promise";
import {
  computePerUserFinalScore,
  portableAirOpportunityGate,
  classifyAirOpportunity,
  applyTieBreaker,
  classifyVisibility,
  type LaneScoredProject,
} from "../server/laneScoring";
import { getProjectScoresBatch } from "../server/businessLineScoring";

const RYAN_PROFILE = {
  territories: ["WA"],
  assignedBusinessLines: ["Portable Air", "PT Capital Sales"],
  sectorFocus: ["mining", "oil_gas", "infrastructure", "energy"],
  stageTiming: null,
  keyAccounts: null,
  buyerRoles: null,
};

const SPECIALTY_AIR_SIGNALS = [
  "nitrogen", "n2 membrane", "purging", "inerting", "inert gas",
  "dry-out", "dryout", "pipeline dry-out", "line drying", "pipe drying",
  "commissioning air", "pre-commissioning", "precommissioning",
  "pipeline testing", "pneumatic pressure test", "hydrostatic testing",
  "instrument air", "instrument-air", "control air",
  "booster compressor", "pressure booster", "gas booster",
  "high pressure testing", "high-pressure test",
  "pipeline purging", "pipeline commissioning",
];

const AIR_TREATMENT_SIGNALS = [
  "air dryer", "refrigerant dryer", "desiccant dryer", "air drying",
  "moisture separator", "dew point", "dew-point",
  "oil-free air", "oil free air", "iso 8573",
];

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  // ── 1. Fetch Ryan's WA project pool ──
  const [rawProjects] = await conn.execute(`
    SELECT 
      p.id, p.name, p.location, p.priority, p.sector, p.stage,
      p.overview, p.opportunityRoute, p.isNew, p.owner, p.value,
      p.projectState, p.tenderCloseDate, p.lifecycleStatus, p.suppressed,
      COALESCE(p.equipmentSignals, '[]') as equipmentSignals
    FROM projects p
    WHERE 
      p.lifecycleStatus NOT IN ('stale', 'archived')
      AND p.suppressed != 1
      AND (
        p.projectState IN ('WA', 'Western Australia')
        OR p.location LIKE '%Western Australia%'
        OR p.location LIKE '%, WA%'
        OR p.location LIKE '%WA,%'
        OR p.location LIKE '% WA %'
        OR p.location LIKE '%Pilbara%'
        OR p.location LIKE '%Kimberley%'
        OR p.location LIKE '%Goldfields%'
        OR p.location LIKE '%Perth%'
        OR p.location LIKE '%Karratha%'
        OR p.location LIKE '%Port Hedland%'
        OR p.location LIKE '%Kalgoorlie%'
        OR p.location LIKE '%Broome%'
        OR p.location LIKE '%Dampier%'
        OR p.location LIKE '%Onslow%'
        OR p.location LIKE '%Barrow Island%'
        OR p.location LIKE '%Exmouth%'
        OR p.location LIKE '%Carnarvon%'
      )
    ORDER BY p.priority DESC, p.id DESC
    LIMIT 500
  `) as any[];

  const projects = rawProjects.map((p: any) => ({
    ...p,
    equipmentSignals: typeof p.equipmentSignals === "string" ? JSON.parse(p.equipmentSignals) : (p.equipmentSignals || []),
  }));

  // Fetch dimension scores for all projects
  const projectIds = projects.map((p: any) => p.id);
  const blScoresMap = await getProjectScoresBatch(projectIds);

  console.log(`\n=== RYAN WA PROJECT POOL: ${projects.length} projects ===\n`);

  // ── 2. Score all projects ──
  const scored: Array<{
    project: any;
    laneResult: LaneScoredProject;
    airClass: ReturnType<typeof classifyAirOpportunity>;
    gateResult: ReturnType<typeof portableAirOpportunityGate>;
    visibilityTier: string;
    finalScore: number;
  }> = [];

  for (const project of projects) {
    const blScores = blScoresMap.get(project.id) || [];
    const laneResult = computePerUserFinalScore(project, RYAN_PROFILE, blScores, []);
    const withTieBreaker = applyTieBreaker(laneResult, 0);
    const portableAirScore = (blScoresMap.get(project.id) || []).find((s: any) => s.dimension === 'portable_air')?.score ?? 0;
    const gateResult = portableAirOpportunityGate(project, portableAirScore);
    const hasAssignedBLs = RYAN_PROFILE.assignedBusinessLines.length > 0;
    const visibilityTier = classifyVisibility(withTieBreaker, hasAssignedBLs);
    const airClass = classifyAirOpportunity(project);

    scored.push({
      project,
      laneResult: withTieBreaker,
      airClass,
      gateResult,
      visibilityTier,
      finalScore: withTieBreaker.finalScoreWithTieBreaker,
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // ── 3. TOP 20 CANDIDATES ──
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("SECTION 1: TOP 20 CANDIDATES FOR RYAN WA");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const top20 = scored.slice(0, 20);
  top20.forEach((item, idx) => {
    const p = item.project;
    const gate = item.gateResult;
    const gatePass = gate.pass ? "✅ PASS" : `❌ FAIL (${gate.reason?.slice(0, 60)})`;
    const sectionEligibility = item.visibilityTier === "suppress"
      ? "SUPPRESSED"
      : item.visibilityTier === "monitor_only"
      ? "Monitor Only"
      : item.finalScore >= 75
      ? "Must Act"
      : item.finalScore >= 55
      ? "Closing Soon / Watchlist"
      : "Monitor Only";

    const mustActReason = item.visibilityTier === "suppress"
      ? "Gate failed → suppressed"
      : item.visibilityTier === "monitor_only"
      ? "Gate soft-fail → monitor_only"
      : item.finalScore >= 75
      ? "Score ≥ 75 → eligible"
      : `Score ${item.finalScore} < 75 threshold`;

    console.log(`#${idx + 1} [ID:${p.id}] ${p.name}`);
    console.log(`   Score: ${item.finalScore} | Priority: ${p.priority} | Sector: ${p.sector}`);
    console.log(`   Family: ${item.airClass.opportunityType || "none"} | Angle: ${item.airClass.bestProductAngle || "Compressor"} | AirFit: ${item.airClass.airFit}`);
    console.log(`   Gate: ${gatePass}`);
    console.log(`   Visibility: ${item.visibilityTier} → Section: ${sectionEligibility}`);
    console.log(`   Must Act: ${mustActReason}`);
    console.log(`   WhyNow: ${item.laneResult.whyNow?.slice(0, 100) || "n/a"}`);
    console.log(`   RouteToBuy: ${item.laneResult.routeToBuy?.slice(0, 100) || "n/a"}`);
    console.log(`   Location: ${p.location}`);
    console.log(`   EquipSignals: ${JSON.stringify(item.project.equipmentSignals).slice(0, 120)}`);
    console.log();
  });

  // ── 4. SPECIALTY-AIR CANDIDATE AUDIT ──
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("SECTION 2: SPECIALTY-AIR CANDIDATES (Dryer/N2/Booster/Package)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const specialtyAirItems = scored.filter(item => {
    const angle = item.airClass.bestProductAngle;
    return angle === "N2 Membrane" || angle === "Dryer" || angle === "Booster" || angle === "Package";
  });

  if (specialtyAirItems.length === 0) {
    console.log("⚠️  ZERO specialty-air candidates found in Ryan's WA pool.\n");
    console.log("   This means classifyAirOpportunity() is returning bestProductAngle='Compressor' for ALL projects.");
    console.log("   Root cause: no projects in the WA pool have specialty-air signals in their equipmentSignals or overview.\n");
  } else {
    specialtyAirItems.forEach((item, idx) => {
      const rank = scored.indexOf(item) + 1;
      const top3 = scored.slice(0, 3);
      const top3Scores = top3.map(t => t.finalScore);
      const gap = top3Scores[0] - item.finalScore;

      console.log(`#${rank} [ID:${item.project.id}] ${item.project.name}`);
      console.log(`   Score: ${item.finalScore} | Top-3 scores: ${top3Scores.join(", ")} | Gap to #1: ${gap}`);
      console.log(`   Family: ${item.airClass.opportunityType} | Angle: ${item.airClass.bestProductAngle}`);
      console.log(`   Gate: ${item.gateResult.pass ? "PASS" : "FAIL: " + item.gateResult.reason}`);
      console.log(`   Visibility: ${item.visibilityTier}`);
      console.log(`   Why it lost: ${gap > 30 ? "Score gap too large — needs more signals" : gap > 15 ? "Moderate gap — borderline" : "Close race — could surface with minor signal boost"}`);
      console.log(`   EquipSignals: ${JSON.stringify(item.project.equipmentSignals).slice(0, 120)}`);
      console.log();
    });
  }

  // ── 5. UPSTREAM CAPTURE AUDIT ──
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("SECTION 3: UPSTREAM CAPTURE AUDIT — Specialty-Air Signals in WA Pool");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const signalCounts: Record<string, number> = {};
  const signalProjects: Record<string, string[]> = {};

  for (const signal of [...SPECIALTY_AIR_SIGNALS, ...AIR_TREATMENT_SIGNALS]) {
    signalCounts[signal] = 0;
    signalProjects[signal] = [];
  }

  for (const item of scored) {
    const p = item.project;
    const text = [
      p.name || "",
      p.overview || "",
      p.opportunityRoute || "",
      ...(Array.isArray(p.equipmentSignals) ? p.equipmentSignals : []),
    ].join(" ").toLowerCase();

    for (const signal of [...SPECIALTY_AIR_SIGNALS, ...AIR_TREATMENT_SIGNALS]) {
      if (text.includes(signal.toLowerCase())) {
        signalCounts[signal]++;
        if (signalProjects[signal].length < 3) {
          signalProjects[signal].push(`[${p.id}] ${p.name.slice(0, 50)}`);
        }
      }
    }
  }

  console.log("Specialty Air / Gas signals:");
  for (const signal of SPECIALTY_AIR_SIGNALS) {
    const count = signalCounts[signal];
    const examples = signalProjects[signal].join(", ").slice(0, 100);
    const flag = count === 0 ? "❌ MISSING" : count === 1 ? "⚠️  THIN" : "✅";
    console.log(`  ${flag} "${signal}": ${count} projects${count > 0 ? " — e.g. " + examples : ""}`);
  }

  console.log("\nAir Treatment signals:");
  for (const signal of AIR_TREATMENT_SIGNALS) {
    const count = signalCounts[signal];
    const examples = signalProjects[signal].join(", ").slice(0, 100);
    const flag = count === 0 ? "❌ MISSING" : count === 1 ? "⚠️  THIN" : "✅";
    console.log(`  ${flag} "${signal}": ${count} projects${count > 0 ? " — e.g. " + examples : ""}`);
  }

  const missingSignals = [...SPECIALTY_AIR_SIGNALS, ...AIR_TREATMENT_SIGNALS].filter(s => signalCounts[s] === 0);
  const thinSignals = [...SPECIALTY_AIR_SIGNALS, ...AIR_TREATMENT_SIGNALS].filter(s => signalCounts[s] === 1);
  console.log(`\nSummary: ${missingSignals.length} signals with ZERO projects, ${thinSignals.length} with only 1 project`);
  console.log(`Missing: ${missingSignals.join(", ")}`);

  // ── 6. CLOSING SOON AUDIT ──
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("SECTION 4: CLOSING SOON AUDIT — GE Frame 9 Gas Turbine");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const geFrame9 = scored.find(item =>
    item.project.name?.toLowerCase().includes("ge frame 9") ||
    item.project.name?.toLowerCase().includes("frame 9") ||
    item.project.name?.toLowerCase().includes("gas turbine control")
  );

  if (geFrame9) {
    const p = geFrame9.project;
    console.log(`Found: [ID:${p.id}] ${p.name}`);
    console.log(`Score: ${geFrame9.finalScore} | Priority: ${p.priority} | Sector: ${p.sector}`);
    console.log(`Stage: ${p.stage} | TenderCloseDate: ${p.tenderCloseDate}`);
    console.log(`Location: ${p.location}`);
    console.log(`Overview: ${(p.overview || "").slice(0, 300)}`);
    console.log(`EquipSignals: ${JSON.stringify(p.equipmentSignals)}`);
    console.log(`Gate: ${geFrame9.gateResult.pass ? "PASS" : "FAIL: " + geFrame9.gateResult.reason}`);
    console.log(`Visibility: ${geFrame9.visibilityTier}`);
    console.log(`AirFit: ${geFrame9.airClass.airFit} | Angle: ${geFrame9.airClass.bestProductAngle}`);
    console.log(`\nVerdict: ${
      geFrame9.gateResult.pass && geFrame9.airClass.bestProductAngle !== "Compressor"
        ? "Genuine specialty-air opportunity"
        : geFrame9.gateResult.pass
        ? "Passes gate but only as generic compressor — not specialty air"
        : "Fails gate — should not be in Closing Soon"
    }`);
  } else {
    // Search by tender close date proximity
    const closingSoon = scored
      .filter(item => item.project.tenderCloseDate)
      .sort((a, b) => new Date(a.project.tenderCloseDate).getTime() - new Date(b.project.tenderCloseDate).getTime())
      .slice(0, 5);

    console.log("GE Frame 9 not found in WA pool. Closest Closing Soon projects by tender date:");
    closingSoon.forEach(item => {
      console.log(`  [ID:${item.project.id}] ${item.project.name} | Close: ${item.project.tenderCloseDate} | Score: ${item.finalScore} | Gate: ${item.gateResult.pass ? "PASS" : "FAIL"}`);
    });
  }

  // ── 7. ROOT CAUSE DIAGNOSIS ──
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("SECTION 5: ROOT CAUSE DIAGNOSIS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const totalProjects = scored.length;
  const suppressed = scored.filter(i => i.visibilityTier === "suppress").length;
  const monitorOnly = scored.filter(i => i.visibilityTier === "monitor_only").length;
  const actionable = scored.filter(i => i.visibilityTier !== "suppress" && i.visibilityTier !== "monitor_only").length;
  const mustAct = scored.filter(i => i.visibilityTier !== "suppress" && i.visibilityTier !== "monitor_only" && i.finalScore >= 75).length;
  const specialtyAirCount = scored.filter(i => i.airClass.bestProductAngle !== "Compressor" && i.airClass.bestProductAngle !== undefined).length;
  const specialtyAirActionable = scored.filter(i =>
    i.airClass.bestProductAngle !== "Compressor" &&
    i.airClass.bestProductAngle !== undefined &&
    i.visibilityTier !== "suppress"
  ).length;

  console.log(`Pool: ${totalProjects} WA projects`);
  console.log(`  Suppressed: ${suppressed} | Monitor-only: ${monitorOnly} | Actionable: ${actionable} | Must Act: ${mustAct}`);
  console.log(`  Specialty-air classified: ${specialtyAirCount} | Specialty-air actionable: ${specialtyAirActionable}`);
  console.log();

  if (specialtyAirCount === 0) {
    console.log("DIAGNOSIS: UPSTREAM CAPTURE FAILURE");
    console.log("  No projects in Ryan's WA pool have specialty-air signals.");
    console.log("  The three-family model is working correctly but has nothing to classify.");
    console.log("  The bottleneck is that the WA project database does not contain LNG/pipeline/N2 projects.");
    console.log("  Fix: The new RSS feeds (Offshore Technology, LNG Prime, etc.) will supply these projects");
    console.log("  on the next Sunday harvest. The model will then classify them correctly.");
  } else if (specialtyAirActionable === 0) {
    console.log("DIAGNOSIS: SPECIALTY-AIR CANDIDATES PRESENT BUT SUPPRESSED");
    console.log("  Specialty-air projects exist but are being suppressed by the gate.");
    console.log("  Fix: Review gate suppression rules for specialty-air signals.");
  } else if (specialtyAirActionable > 0 && mustAct < 3) {
    console.log("DIAGNOSIS: SPECIALTY-AIR CANDIDATES PRESENT BUT UNDER-RANKED");
    console.log("  Specialty-air projects exist and pass the gate but score below the Must Act threshold.");
    console.log("  Fix: Add specialty-air signal boost to the scoring function.");
  } else {
    console.log("DIAGNOSIS: MIXED ISSUE — see sections above for details.");
  }

  await conn.end();
  process.exit(0);
}

main().catch(e => {
  console.error("Audit failed:", e.message);
  process.exit(1);
});
