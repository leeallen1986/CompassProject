/**
 * Validate the Activity Signal Layer on existing projects.
 * Runs activity detection + score modifiers on a sample of projects
 * to verify the improvements before bulk re-scoring.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = mysql.createPool(DATABASE_URL);
const db = drizzle(pool);

async function main() {
  // Get a diverse sample of projects
  const rows = await db.execute(sql`
    SELECT id, name, overview, sector, stage, equipmentSignals, location
    FROM projects
    ORDER BY RAND()
    LIMIT 30
  `);

  const projects = rows[0];

  // Dynamically import the activity signal layer
  const { detectActivities, detectEnvironmentalSignals, getStageWeight, computeScoreModifiers } =
    await import("../server/activitySignalLayer.ts");

  let totalActivities = 0;
  let totalEnvSignals = 0;
  let boostCount = 0;
  let reduceCount = 0;
  let neutralCount = 0;

  const results = [];

  for (const p of projects) {
    const eqSignals = typeof p.equipmentSignals === "string"
      ? JSON.parse(p.equipmentSignals)
      : p.equipmentSignals;

    const mods = computeScoreModifiers(
      p.name,
      p.overview,
      eqSignals,
      p.stage,
      p.sector,
    );

    totalActivities += mods.activities.length;
    totalEnvSignals += mods.environmentalSignals.length;
    if (mods.stageWeight === "boost") boostCount++;
    else if (mods.stageWeight === "reduce") reduceCount++;
    else neutralCount++;

    results.push({
      id: p.id,
      name: p.name?.substring(0, 50),
      stage: p.stage,
      stageWeight: mods.stageWeight,
      activities: mods.activities.map(a => `${a.activity}(${a.confidence})`).join(", ") || "none",
      envSignals: mods.environmentalSignals.length,
      paAdj: mods.adjustments["Portable Air"],
      dwAdj: mods.adjustments["Pump/Dewatering"],
      n2Adj: mods.adjustments["Nitrogen"],
      genAdj: mods.adjustments["Generators"],
    });
  }

  console.log("\n=== Activity Signal Layer Validation ===\n");
  console.log(`Sample size: ${projects.length} projects`);
  console.log(`Total activities detected: ${totalActivities} (avg ${(totalActivities / projects.length).toFixed(1)} per project)`);
  console.log(`Environmental signals: ${totalEnvSignals}`);
  console.log(`Stage weights: boost=${boostCount}, neutral=${neutralCount}, reduce=${reduceCount}`);

  console.log("\n--- Sample Results ---\n");
  for (const r of results.slice(0, 15)) {
    console.log(`[${r.id}] ${r.name}`);
    console.log(`  Stage: ${r.stage} → ${r.stageWeight}`);
    console.log(`  Activities: ${r.activities}`);
    console.log(`  Adjustments: PA=${r.paAdj > 0 ? "+" : ""}${r.paAdj}, DW=${r.dwAdj > 0 ? "+" : ""}${r.dwAdj}, N2=${r.n2Adj > 0 ? "+" : ""}${r.n2Adj}, Gen=${r.genAdj > 0 ? "+" : ""}${r.genAdj}`);
    console.log();
  }

  // Check specific scenarios
  console.log("--- Scenario Checks ---\n");

  // Check: early-stage projects should have reduced scores
  const earlyStage = results.filter(r => r.stageWeight === "reduce");
  console.log(`Early-stage projects (reduced): ${earlyStage.length}`);
  for (const r of earlyStage.slice(0, 3)) {
    console.log(`  [${r.id}] ${r.name} — PA adj: ${r.paAdj}`);
  }

  // Check: projects with dewatering activities
  const dewateringProjects = results.filter(r => r.activities.includes("dewatering") || r.envSignals > 0);
  console.log(`\nProjects with dewatering/env signals: ${dewateringProjects.length}`);
  for (const r of dewateringProjects.slice(0, 3)) {
    console.log(`  [${r.id}] ${r.name} — DW adj: ${r.dwAdj}, env: ${r.envSignals}`);
  }

  await pool.end();
  console.log("\nDone.");
}

main().catch(console.error);
