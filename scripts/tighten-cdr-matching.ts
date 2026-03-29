/**
 * Tighten CDR dryer matching to focus on air-quality-specific projects.
 * 
 * Problem: First pass matched 315 projects because generic keywords like
 * "drilling", "maintenance", "compressor" match almost every mining project.
 * 
 * CDR dryers are about AIR QUALITY — they matter where:
 * 1. Pneumatic tools need clean dry air (mining production, construction)
 * 2. Instrumentation needs moisture-free air (oil & gas, chemical/process)
 * 3. Pipeline testing needs dry air (pipeline projects)
 * 4. Abrasive blasting needs dry air (shutdown/turnaround, shipyard)
 * 5. LNG/gas processing (instrumentation protection)
 * 
 * Strategy: Remove generic keywords, keep air-quality-specific signals,
 * and require at least one keyword/application match beyond just sector.
 * Also set minProjectSize=large since CDR units are substantial equipment.
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

  // Find CDR collateral item
  const [cdr] = await db.select().from(collateralItems)
    .where(eq(collateralItems.name, "CDR Portable Desiccant Dryers (CDR 850/1200/1700)"));
  if (!cdr) { console.error("CDR not found"); process.exit(1); }
  const collateralId = cdr.id;

  // ── Step 1: Update tags — tighter, air-quality focused ──
  const newSectorTags = ["mining", "oil_gas"];
  const newApplicationTags = [
    "sandblasting",
    "pipeline_testing",
    "pneumatic_tools",
    "oil_gas_production",
    "mining_production",
  ];
  // Tightened keywords — focus on air quality signals, not generic mining/drilling
  const newKeywordTags = [
    // Direct air quality signals
    "dry air",
    "desiccant",
    "dew point",
    "moisture",
    "air treatment",
    "air quality",
    "pneumatic tool",
    "pneumatic control",
    "instrumentation",
    "process air",
    // Specific applications where CDR matters
    "abrasive blasting",
    "sandblasting",
    "pipeline testing",
    "pipeline maintenance",
    "pressure testing",
    "shutdown",
    "turnaround",
    "overhaul",
    // Industrial processing (needs clean air)
    "lng",
    "gas processing",
    "refinery",
    "chemical plant",
    "processing plant",
    "smelter",
    // Production mining (sustained operations need air treatment)
    "production drilling",
    "grade control",
    "underground mine",
    "open pit mining",
    "mine production",
  ];

  await db.update(collateralItems).set({
    sectorTags: newSectorTags,
    applicationTags: newApplicationTags,
    keywordTags: newKeywordTags,
    minProjectSize: "large" as any,
  }).where(eq(collateralItems.id, collateralId));

  console.log("✅ Updated CDR tags:");
  console.log("  Sectors:", newSectorTags.join(", "));
  console.log("  Applications:", newApplicationTags.length, "tags");
  console.log("  Keywords:", newKeywordTags.length, "tags");
  console.log("  minProjectSize: large");

  // ── Step 2: Clear old matches ──
  await db.delete(collateralProjectMatches).where(eq(collateralProjectMatches.collateralId, collateralId));
  console.log("✅ Cleared old CDR matches");

  // ── Step 3: Re-run matching ──
  const allProjects = await db.select().from(projects);
  console.log(`\n📊 Processing ${allProjects.length} projects...`);

  let matchCount = 0;
  let sizeFiltered = 0;
  let noKeywordFiltered = 0;
  let lowScoreFiltered = 0;
  const matches: { name: string; score: number; reason: string; value: string; sector: string; size: string }[] = [];

  for (const project of allProjects) {
    const projectSize = classifyProjectSize(project);

    // Size gate: require large or mega
    if (projectSize === "standard") {
      sizeFiltered++;
      continue;
    }

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
    let hasApplicationOrKeywordMatch = false;

    // Sector match (0-30)
    if (newSectorTags.map(s => s.toLowerCase()).includes(projectSector)) {
      score += 30;
      reasons.push(`Sector: ${projectSector}`);
    }

    // Application tag match (0-40)
    const appTags = newApplicationTags.map(t => t.replace(/_/g, " "));
    let appMatchCount = 0;
    for (const tag of appTags) {
      const tagWords = tag.split(" ");
      const anyWordMatch = tagWords.some(w => w.length > 3 && projectText.includes(w));
      if (projectText.includes(tag) || anyWordMatch) appMatchCount++;
    }
    if (appMatchCount > 0) {
      score += Math.min(40, appMatchCount * 20);
      reasons.push(`${appMatchCount} app tag(s)`);
      hasApplicationOrKeywordMatch = true;
    }

    // Keyword match (0-20)
    let kwMatchCount = 0;
    const matchedKeywords: string[] = [];
    for (const kw of newKeywordTags) {
      if (projectText.includes(kw.toLowerCase())) {
        kwMatchCount++;
        matchedKeywords.push(kw);
      }
    }
    if (kwMatchCount > 0) {
      score += Math.min(20, kwMatchCount * 10);
      reasons.push(`${kwMatchCount} kw: ${matchedKeywords.slice(0, 4).join(", ")}`);
      hasApplicationOrKeywordMatch = true;
    }

    // Compressed air context bonus (only for very specific terms)
    const airContextTerms = ["compressed air", "air compressor", "pneumatic", "desiccant", "dew point", "air treatment"];
    if (airContextTerms.some(k => projectText.includes(k))) {
      score += 10;
      reasons.push("Air treatment context");
    }

    score = Math.min(100, score);

    // Keyword-required gate
    if (!hasApplicationOrKeywordMatch) {
      noKeywordFiltered++;
      continue;
    }

    // Minimum score threshold — require multiple signals for highest hit rate
    if (score < 60) {
      lowScoreFiltered++;
      continue;
    }

    // Save match
    await db.insert(collateralProjectMatches).values({
      collateralId,
      projectId: project.id,
      matchScore: score,
      matchReason: reasons.join("; "),
    });
    matchCount++;
    matches.push({
      name: project.name,
      score,
      reason: reasons.join("; "),
      value: project.value || "Unknown",
      sector: project.sector || "Unknown",
      size: projectSize,
    });
  }

  // Update match count
  await db.update(collateralItems).set({ matchCount }).where(eq(collateralItems.id, collateralId));

  console.log(`\n📊 Results:`);
  console.log(`  Total projects: ${allProjects.length}`);
  console.log(`  Size filtered (standard): ${sizeFiltered}`);
  console.log(`  No keyword/app match: ${noKeywordFiltered}`);
  console.log(`  Low score: ${lowScoreFiltered}`);
  console.log(`  ✅ Final matches: ${matchCount}`);

  // Show all matches sorted by score
  matches.sort((a, b) => b.score - a.score);
  console.log(`\n🎯 All ${matchCount} matches:`);
  for (const m of matches) {
    console.log(`  [${m.score}] ${m.name} (${m.sector}, ${m.size}, ${m.value})`);
    console.log(`       ${m.reason}`);
  }

  // Show score distribution
  const dist: Record<string, number> = {};
  for (const m of matches) {
    const tier = m.score >= 80 ? "80-100" : m.score >= 60 ? "60-79" : m.score >= 40 ? "40-59" : "21-39";
    dist[tier] = (dist[tier] || 0) + 1;
  }
  console.log(`\n📊 Score distribution:`);
  for (const [tier, count] of Object.entries(dist).sort().reverse()) {
    console.log(`  ${tier}: ${count} matches`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
