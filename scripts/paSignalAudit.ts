/**
 * Portable Air Signal Audit
 * Audits the current project pool for:
 * 1. Core PA signals (drill/blast/piling/shutdown/commissioning)
 * 2. Air Treatment signals (dryer/instrument air/moisture)
 * 3. Specialty Air/Gas signals (N2/pipeline test/purge/booster)
 * 4. False positives (hot/warm with no PA signal)
 * 5. False negatives (cold/no-signal projects with strong PA keywords)
 * 6. Source quality breakdown
 */

import { getDb } from "../server/db";
import { projects } from "../drizzle/schema";
import { and, inArray, isNull, or, eq } from "drizzle-orm";

// ── Application Family Signal Dictionaries ──────────────────────────────────

const CORE_PA_SIGNALS: Record<string, string[]> = {
  drilling: [
    "drill", "drilling", "DTH", "RC drilling", "rotary drill", "core drill",
    "exploration drill", "percussion drill", "shot drill", "blast hole",
    "water well drill", "waterwell", "borehole", "bore hole",
    "geotechnical drill", "sonic drill", "directional drill",
  ],
  blasting: [
    "blast", "blasting", "abrasive blast", "sandblast", "shot blast",
    "surface preparation blast", "grit blast",
  ],
  piling: [
    "piling", "pile", "driven pile", "bored pile", "CFA pile",
    "sheet pile", "micropile", "spun pile", "precast pile",
  ],
  shutdown_maintenance: [
    "shutdown", "turnaround", "TAR", "planned maintenance", "outage",
    "maintenance window", "plant shutdown", "refinery shutdown",
  ],
  commissioning: [
    "commissioning", "pre-commissioning", "pre-comm", "start-up", "startup",
    "first gas", "first oil", "handover", "energisation",
  ],
  pneumatic_tools: [
    "pneumatic", "temporary plant air", "air tools", "jackhammer",
    "rock breaker", "impact wrench", "air powered", "compressed air supply",
  ],
};

const AIR_TREATMENT_SIGNALS: Record<string, string[]> = {
  drying: [
    "dryer", "desiccant dryer", "refrigerant dryer", "aftercooler",
    "line drying", "air dryer", "compressed air dryer",
  ],
  quality: [
    "instrument air", "clean air", "dry air", "moisture removal",
    "compressed air quality", "air treatment", "air purity",
    "ISO 8573", "dew point",
  ],
  backup: [
    "instrument air backup", "air backup system", "standby air",
    "emergency air supply",
  ],
};

const SPECIALTY_AIR_SIGNALS: Record<string, string[]> = {
  nitrogen: [
    "nitrogen", "N2 membrane", "nitrogen membrane", "nitrogen generation",
    "nitrogen purge", "nitrogen blanket", "inert gas",
  ],
  pipeline_testing: [
    "pipeline test", "pressure test", "leak test", "hydro test", "hydrotest",
    "hydrostatic test", "pipeline commission", "line pack", "gas line test",
    "pigging", "pig launch", "pig receive",
  ],
  purging_inerting: [
    "purge", "purging", "inerting", "inert", "dry-out", "dryout",
    "nitrogen purge", "gas purge", "vessel purge",
  ],
  high_pressure: [
    "high pressure test", "booster", "pressure booster", "HP air",
    "high pressure air", "booster compressor",
  ],
  process_air: [
    "temporary instrument air", "process air", "temporary process air",
    "plant air", "utility air", "service air",
  ],
};

// Flatten all signals for quick lookup
const ALL_CORE_PA = Object.values(CORE_PA_SIGNALS).flat();
const ALL_AIR_TREATMENT = Object.values(AIR_TREATMENT_SIGNALS).flat();
const ALL_SPECIALTY_AIR = Object.values(SPECIALTY_AIR_SIGNALS).flat();

function matchSignals(text: string, signals: string[]): string[] {
  const lower = text.toLowerCase();
  return signals.filter(s => lower.includes(s.toLowerCase()));
}

function classifyProject(p: {
  name: string | null;
  overview: string | null;
  equipmentSignals: unknown;
}): {
  corePA: string[];
  airTreatment: string[];
  specialtyAir: string[];
  family: "core_pa" | "air_treatment" | "specialty_air" | "multi" | "none";
} {
  const eqSig = Array.isArray(p.equipmentSignals)
    ? (p.equipmentSignals as string[]).join(" ")
    : typeof p.equipmentSignals === "string"
    ? p.equipmentSignals
    : "";
  const text = `${p.name ?? ""} ${p.overview ?? ""} ${eqSig}`;

  const corePA = matchSignals(text, ALL_CORE_PA);
  const airTreatment = matchSignals(text, ALL_AIR_TREATMENT);
  const specialtyAir = matchSignals(text, ALL_SPECIALTY_AIR);

  const families = [
    corePA.length > 0 ? "core_pa" : null,
    airTreatment.length > 0 ? "air_treatment" : null,
    specialtyAir.length > 0 ? "specialty_air" : null,
  ].filter(Boolean);

  const family =
    families.length > 1
      ? "multi"
      : families.length === 1
      ? (families[0] as "core_pa" | "air_treatment" | "specialty_air")
      : "none";

  return { corePA, airTreatment, specialtyAir, family };
}

async function main() {
  const db = await getDb();
  const allProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      overview: projects.overview,
      sector: projects.sector,
      priority: projects.priority,
      stage: projects.stage,
      stageCode: projects.stageCode,
      opportunityRoute: projects.opportunityRoute,
      equipmentSignals: projects.equipmentSignals,
      matchedBusinessLines: projects.matchedBusinessLines,
      sourceType: projects.sourcePurpose,
      productLane: projects.productLane,
      suppressed: projects.suppressed,
      projectType: projects.projectType,
      lifecycleStatus: projects.lifecycleStatus,
    })
    .from(projects)
    .where(
      and(
        inArray(projects.lifecycleStatus, ["active", "awarded"]),
        inArray(projects.priority, ["hot", "warm", "cold"]),
        or(
          isNull(projects.suppressed),
          eq(projects.suppressed, false as unknown as boolean)
        )
      )
    );

  console.log("Total active/awarded non-suppressed projects:", allProjects.length);

  // ── Classify ──────────────────────────────────────────────────────────────
  const classified = allProjects.map(p => ({
    ...p,
    signals: classifyProject(p),
  }));

  const withCorePA = classified.filter(p => p.signals.corePA.length > 0);
  const withAirTreatment = classified.filter(p => p.signals.airTreatment.length > 0);
  const withSpecialtyAir = classified.filter(p => p.signals.specialtyAir.length > 0);
  const withAnySignal = classified.filter(p => p.signals.family !== "none");
  const withNoSignal = classified.filter(p => p.signals.family === "none");

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("SIGNAL CAPTURE RATES");
  console.log("════════════════════════════════════════════════════════════════");
  console.log(`Core PA (drill/blast/piling/shutdown/commissioning): ${withCorePA.length} (${Math.round(withCorePA.length / allProjects.length * 100)}%)`);
  console.log(`Air Treatment (dryer/instrument air/moisture):        ${withAirTreatment.length} (${Math.round(withAirTreatment.length / allProjects.length * 100)}%)`);
  console.log(`Specialty Air (N2/pipeline test/purge/booster):       ${withSpecialtyAir.length} (${Math.round(withSpecialtyAir.length / allProjects.length * 100)}%)`);
  console.log(`Any PA signal:                                         ${withAnySignal.length} (${Math.round(withAnySignal.length / allProjects.length * 100)}%)`);
  console.log(`No PA signal at all:                                   ${withNoSignal.length} (${Math.round(withNoSignal.length / allProjects.length * 100)}%)`);

  // ── By priority breakdown ─────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("SIGNAL PRESENCE BY PRIORITY");
  console.log("════════════════════════════════════════════════════════════════");
  for (const pri of ["hot", "warm", "cold"]) {
    const pool = classified.filter(p => p.priority === pri);
    const hasSignal = pool.filter(p => p.signals.family !== "none");
    console.log(`${pri.toUpperCase()} (${pool.length} total): ${hasSignal.length} with PA signal (${Math.round(hasSignal.length / pool.length * 100)}%)`);
  }

  // ── Core PA projects ──────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("TOP CORE PA PROJECTS (drill/blast/piling/shutdown/commissioning)");
  console.log("════════════════════════════════════════════════════════════════");
  withCorePA
    .sort((a, b) => (a.priority === "hot" ? -1 : b.priority === "hot" ? 1 : 0))
    .slice(0, 20)
    .forEach(p => {
      console.log(`  [${p.priority?.toUpperCase()}] ${(p.name ?? "").slice(0, 65)}`);
      console.log(`         signals: ${p.signals.corePA.slice(0, 4).join(", ")} | sector: ${p.sector}`);
    });

  // ── Specialty Air projects ────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("SPECIALTY AIR PROJECTS (N2/pipeline test/purge/booster)");
  console.log("════════════════════════════════════════════════════════════════");
  withSpecialtyAir
    .sort((a, b) => (a.priority === "hot" ? -1 : b.priority === "hot" ? 1 : 0))
    .slice(0, 20)
    .forEach(p => {
      console.log(`  [${p.priority?.toUpperCase()}] ${(p.name ?? "").slice(0, 65)}`);
      console.log(`         signals: ${p.signals.specialtyAir.slice(0, 4).join(", ")} | sector: ${p.sector}`);
    });

  // ── False positives: hot/warm with NO PA signal ───────────────────────────
  const falsePositives = withNoSignal.filter(p => p.priority === "hot" || p.priority === "warm");
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log(`FALSE POSITIVES — hot/warm with NO PA signal (${falsePositives.length} total)`);
  console.log("════════════════════════════════════════════════════════════════");
  falsePositives.slice(0, 25).forEach(p => {
    console.log(`  [${p.priority?.toUpperCase()}] ${(p.name ?? "").slice(0, 70)} | ${p.sector}`);
  });

  // ── False negatives: cold projects with strong PA signals ─────────────────
  const falseNegatives = withCorePA
    .filter(p => p.priority === "cold")
    .concat(withSpecialtyAir.filter(p => p.priority === "cold"));
  const uniqueFN = [...new Map(falseNegatives.map(p => [p.id, p])).values()];
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log(`FALSE NEGATIVES — cold projects WITH strong PA signals (${uniqueFN.length} total)`);
  console.log("════════════════════════════════════════════════════════════════");
  uniqueFN.slice(0, 20).forEach(p => {
    const sigs = [...p.signals.corePA, ...p.signals.specialtyAir].slice(0, 3).join(", ");
    console.log(`  [COLD] ${(p.name ?? "").slice(0, 65)}`);
    console.log(`         signals: ${sigs} | sector: ${p.sector}`);
  });

  // ── Source quality breakdown ──────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("SOURCE QUALITY — PA signal rate by sourcePurpose");
  console.log("════════════════════════════════════════════════════════════════");
  const bySource: Record<string, { total: number; withSignal: number }> = {};
  for (const p of classified) {
    const src = p.sourceType ?? "unknown";
    if (!bySource[src]) bySource[src] = { total: 0, withSignal: 0 };
    bySource[src].total++;
    if (p.signals.family !== "none") bySource[src].withSignal++;
  }
  Object.entries(bySource)
    .sort((a, b) => b[1].withSignal - a[1].withSignal)
    .forEach(([src, stats]) => {
      const rate = Math.round(stats.withSignal / stats.total * 100);
      console.log(`  ${src.padEnd(25)} ${stats.withSignal}/${stats.total} (${rate}%)`);
    });

  // ── Drilling sub-type breakdown ───────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("DRILLING SUB-TYPE BREAKDOWN");
  console.log("════════════════════════════════════════════════════════════════");
  const drillingTypes: Record<string, number> = {};
  for (const kw of CORE_PA_SIGNALS.drilling) {
    const count = withCorePA.filter(p =>
      `${p.name ?? ""} ${p.overview ?? ""}`.toLowerCase().includes(kw.toLowerCase())
    ).length;
    if (count > 0) drillingTypes[kw] = count;
  }
  Object.entries(drillingTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([kw, count]) => console.log(`  "${kw}": ${count} projects`));

  // ── Specialty air sub-type breakdown ──────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("SPECIALTY AIR SUB-TYPE BREAKDOWN");
  console.log("════════════════════════════════════════════════════════════════");
  const specialtyTypes: Record<string, number> = {};
  for (const [family, keywords] of Object.entries(SPECIALTY_AIR_SIGNALS)) {
    for (const kw of keywords) {
      const count = classified.filter(p =>
        `${p.name ?? ""} ${p.overview ?? ""}`.toLowerCase().includes(kw.toLowerCase())
      ).length;
      if (count > 0) specialtyTypes[`[${family}] ${kw}`] = count;
    }
  }
  Object.entries(specialtyTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([kw, count]) => console.log(`  ${kw}: ${count} projects`));

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("SUMMARY");
  console.log("════════════════════════════════════════════════════════════════");
  console.log(`Total projects audited: ${allProjects.length}`);
  console.log(`With any PA signal: ${withAnySignal.length} (${Math.round(withAnySignal.length / allProjects.length * 100)}%)`);
  console.log(`Hot/warm false positives (no signal): ${falsePositives.length}`);
  console.log(`Cold false negatives (has signal): ${uniqueFN.length}`);
}

main().catch(console.error);
