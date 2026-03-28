/**
 * Tighten XAVS1800 tags to only match genuinely large abrasive blasting projects.
 * 
 * Current problem: sectorTags include mining, oil_gas, infrastructure, energy, construction
 * and applicationTags include generic "construction_general" and "mining_production".
 * This matches almost every large project regardless of blasting relevance.
 * 
 * Fix: Remove broad sector/application tags, keep only blasting-specific signals.
 * The XAVS1800 is a 1,800 cfm compressor for 3-4 simultaneous blast nozzles.
 * Real use cases: shutdown/turnaround surface prep, pipeline coating, tank blasting,
 * structural steel prep, shipyard maintenance, large mining maintenance shutdowns.
 */
import { getDb } from "../server/db";
import {
  collateralItems, collateralProjectMatches, projects,
} from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { classifyProjectSize } from "../server/collateralService";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  // Find the XAVS1800
  const allItems = await db.select().from(collateralItems);
  const xavs = allItems.find(i => i.name.includes("XAVS1800"));
  if (!xavs) { console.error("XAVS1800 not found"); process.exit(1); }

  console.log("=== BEFORE ===");
  console.log(`Application tags: ${JSON.stringify(xavs.applicationTags)}`);
  console.log(`Sector tags: ${JSON.stringify(xavs.sectorTags)}`);
  console.log(`Keyword tags: ${JSON.stringify(xavs.keywordTags)}`);

  // New tightened tags — focused on abrasive blasting use cases only
  const newApplicationTags = [
    "sandblasting",       // Core application
    "pipeline_testing",   // Pipeline coating/testing involves blasting
  ];
  // Remove "construction_general" and "mining_production" — too broad

  const newSectorTags = [
    "mining",         // Keep — mining shutdowns need blasting
    "oil_gas",        // Keep — refinery/pipeline turnarounds
    "infrastructure", // Keep — but only matches if keywords also match
  ];
  // Remove "energy" and "construction" — too broad, matches solar farms etc.

  const newKeywordTags = [
    // Core blasting terms
    "blasting", "abrasive", "abrasive blasting", "sandblast", "sandblasting",
    "blast nozzle", "nozzle pressure",
    // Surface preparation
    "surface prep", "surface preparation", "coating", "paint removal", "corrosion",
    "protective coating", "anti-corrosion",
    // Shutdown / turnaround (where blasting happens at scale)
    "shutdown", "turnaround", "planned shutdown", "maintenance shutdown",
    "overhaul", "outage",
    // Specific large-scale blasting contexts
    "tank blasting", "structural steel", "pipeline coating",
    "shipyard", "shipbuilding", "dry dock", "ship hull", "vessel maintenance",
    "bridge maintenance", "wharf",
    // Equipment signals
    "high volume", "dual pressure", "multi-operator", "aftercooler", "bunded",
  ];

  // Update the XAVS1800 tags
  await db.update(collateralItems)
    .set({
      applicationTags: newApplicationTags,
      sectorTags: newSectorTags,
      keywordTags: newKeywordTags,
      minProjectSize: "large" as any,
    })
    .where(eq(collateralItems.id, xavs.id));

  console.log("\n=== AFTER ===");
  console.log(`Application tags: ${JSON.stringify(newApplicationTags)}`);
  console.log(`Sector tags: ${JSON.stringify(newSectorTags)}`);
  console.log(`Keyword tags: ${JSON.stringify(newKeywordTags)}`);

  // Delete existing matches
  await db.delete(collateralProjectMatches)
    .where(eq(collateralProjectMatches.collateralId, xavs.id));

  // Reset match count
  await db.update(collateralItems)
    .set({ matchCount: 0 })
    .where(eq(collateralItems.id, xavs.id));

  // Get all projects
  const allProjects = await db.select().from(projects);
  console.log(`\nTotal projects: ${allProjects.length}`);

  // Re-score in memory with new tags
  const sectorTags = newSectorTags.map(s => s.toLowerCase());
  const appTags = newApplicationTags.map(t => t.toLowerCase().replace(/_/g, " "));
  const keywords = newKeywordTags.map(k => k.toLowerCase());
  const drillingKeywords = ["drill", "drilling", "bore", "borehole", "compressor", "pneumatic", "blast"];

  const matchesToInsert: { projectId: number; matchScore: number; matchReason: string; projectName: string; projectValue: string; capexGrade: string; priority: string }[] = [];

  for (const project of allProjects) {
    // Size gate — XAVS1800 requires large or mega
    const projectSize = classifyProjectSize(project);
    if (projectSize === "standard") continue;

    // Build project text
    const projectText = [
      project.name,
      project.overview,
      project.sector,
      project.location,
      project.stage,
      project.contractors ? JSON.stringify(project.contractors) : "",
    ].filter(Boolean).join(" ").toLowerCase();

    const projectSector = (project.sector || "").toLowerCase();

    let score = 0;
    const reasons: string[] = [];

    // Sector match (0-30)
    if (sectorTags.includes(projectSector)) {
      score += 30;
      reasons.push(`Sector match: ${projectSector}`);
    } else if (sectorTags.length === 0) {
      score += 10;
    }

    // Application tag match (0-40)
    let appMatchCount = 0;
    for (const tag of appTags) {
      const tagWords = tag.split(" ");
      const anyWordMatch = tagWords.some(w => w.length > 3 && projectText.includes(w));
      if (projectText.includes(tag) || anyWordMatch) appMatchCount++;
    }
    if (appMatchCount > 0) {
      score += Math.min(40, appMatchCount * 20);
      reasons.push(`${appMatchCount} application tag(s) matched`);
    }

    // Keyword match (0-20)
    let kwMatchCount = 0;
    const matchedKws: string[] = [];
    for (const kw of keywords) {
      if (projectText.includes(kw)) {
        kwMatchCount++;
        matchedKws.push(kw);
      }
    }
    if (kwMatchCount > 0) {
      score += Math.min(20, kwMatchCount * 10);
      reasons.push(`${kwMatchCount} keyword(s) matched: ${matchedKws.slice(0, 3).join(", ")}`);
    }

    // Product line bonus (0-10)
    if (xavs.productLine === "portable_air" && drillingKeywords.some(k => projectText.includes(k))) {
      score += 10;
      reasons.push("Portable air relevant to drilling/compressor context");
    }

    const finalScore = Math.min(100, score);
    // For size-restricted collateral, require at least one keyword or application match
    const hasAppOrKw = appMatchCount > 0 || kwMatchCount > 0;
    if (finalScore > 20 && hasAppOrKw) {
      matchesToInsert.push({
        projectId: project.id,
        matchScore: finalScore,
        matchReason: reasons.join("; "),
        projectName: project.name,
        projectValue: project.value,
        capexGrade: project.capexGrade,
        priority: project.priority,
      });
    }
  }

  console.log(`\nMatches to insert: ${matchesToInsert.length}`);

  // Batch insert
  const BATCH_SIZE = 50;
  for (let i = 0; i < matchesToInsert.length; i += BATCH_SIZE) {
    const batch = matchesToInsert.slice(i, i + BATCH_SIZE);
    await db.insert(collateralProjectMatches).values(
      batch.map(m => ({
        collateralId: xavs.id,
        projectId: m.projectId,
        matchScore: m.matchScore,
        matchReason: m.matchReason,
      }))
    );
  }

  // Update match count
  await db.update(collateralItems)
    .set({ matchCount: matchesToInsert.length })
    .where(eq(collateralItems.id, xavs.id));

  console.log(`\n=== RESULTS ===`);
  console.log(`Previous matches: 337 (broad tags, no size filter)`);
  console.log(`New matches: ${matchesToInsert.length} (tightened tags + large project filter)`);
  console.log(`Reduction: ${337 - matchesToInsert.length} irrelevant projects removed (${Math.round((337 - matchesToInsert.length) / 337 * 100)}%)`);

  // Show all matches sorted by score
  const sorted = matchesToInsert.sort((a, b) => b.matchScore - a.matchScore);
  console.log(`\nAll ${sorted.length} XAVS1800 matches:`);
  for (const m of sorted) {
    console.log(`  [${m.capexGrade}/${m.priority}] Score ${m.matchScore}: ${m.projectName} (${m.projectValue})`);
    console.log(`    Reason: ${m.matchReason}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
