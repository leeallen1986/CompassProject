/**
 * Tighten X1350 DrillAir matching for $200K+ purchase-worthy projects.
 * 
 * The X1350 is a 1350 cfm / 25 bar truck-deck compressor for RC drilling.
 * At $200K+, the buyer needs to be a drilling contractor or large mining company
 * running sustained, high-meterage drilling campaigns — not a junior explorer
 * doing a one-off 5,000m program.
 * 
 * Changes:
 * 1. Set minProjectSize = "large" (requires large/mega project classification)
 * 2. Remove "infrastructure" and "water" from sector tags (not drilling sectors)
 * 3. Tighten keyword tags — focus on sustained drilling signals
 * 4. Require at least one keyword/application match (sector alone not enough)
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

  // ── Step 1: Update X1350 tags in database ──
  const newSectorTags = ["mining", "oil_gas"];
  const newApplicationTags = [
    "rc_drilling",
    "waterwell_drilling",
    "exploration_drilling",
    "blast_hole_drilling",
    "diamond_drilling",
  ];
  // Tightened keywords — focus on sustained drilling campaigns, not one-off exploration
  const newKeywordTags = [
    "25 bar",
    "truck-deck",
    "truck deck",
    "drillair",
    "drill support",
    "rig builder",
    "high pressure",
    "rc drill",
    "reverse circulation",
    "drill campaign",
    "drill program",
    "drilling contractor",
    "drilling campaign",
    "drilling program",
    "production drilling",
    "grade control",
    "resource definition",
    "feasibility",
    "bankable",
    "definitive feasibility",
    "pre-feasibility",
    "mine development",
    "mine construction",
    "open pit",
    "underground mine",
    "mineral resource",
    "ore reserve",
    "resource estimate",
    "waterwell",
    "water bore",
    "water supply",
  ];

  await db.update(collateralItems).set({
    sectorTags: newSectorTags,
    applicationTags: newApplicationTags,
    keywordTags: newKeywordTags,
    minProjectSize: "large" as any,
  }).where(eq(collateralItems.id, 1));

  console.log("✅ Updated X1350 tags:");
  console.log("  Sectors:", newSectorTags.join(", "));
  console.log("  Applications:", newApplicationTags.join(", "));
  console.log("  Keywords:", newKeywordTags.length, "tags");
  console.log("  minProjectSize: large");

  // ── Step 2: Clear old matches ──
  await db.delete(collateralProjectMatches).where(eq(collateralProjectMatches.collateralId, 1));
  console.log("✅ Cleared old X1350 matches");

  // ── Step 3: Re-run matching with new tags ──
  const allProjects = await db.select().from(projects);
  console.log(`\n📊 Processing ${allProjects.length} projects...`);

  let matchCount = 0;
  let sizeFiltered = 0;
  let noKeywordFiltered = 0;
  let lowScoreFiltered = 0;
  const matches: { name: string; score: number; reason: string; size: string; value: string }[] = [];

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
      reasons.push(`${kwMatchCount} keyword(s): ${matchedKeywords.slice(0, 3).join(", ")}`);
      hasApplicationOrKeywordMatch = true;
    }

    // Drilling bonus
    const drillingKeywords = ["drill", "drilling", "bore", "borehole", "compressor", "pneumatic", "blast"];
    if (drillingKeywords.some(k => projectText.includes(k))) {
      score += 10;
      reasons.push("Drilling context");
    }

    score = Math.min(100, score);

    // Keyword-required gate for size-restricted collateral
    if (!hasApplicationOrKeywordMatch) {
      noKeywordFiltered++;
      continue;
    }

    // Minimum score threshold
    if (score <= 20) {
      lowScoreFiltered++;
      continue;
    }

    // Save match
    await db.insert(collateralProjectMatches).values({
      collateralId: 1,
      projectId: project.id,
      matchScore: score,
      matchReason: reasons.join("; "),
    });
    matchCount++;
    matches.push({
      name: project.name,
      score,
      reason: reasons.join("; "),
      size: projectSize,
      value: project.value || "Unknown",
    });
  }

  // Reset match count
  await db.update(collateralItems).set({ matchCount }).where(eq(collateralItems.id, 1));

  console.log(`\n📊 Results:`);
  console.log(`  Total projects: ${allProjects.length}`);
  console.log(`  Size filtered (standard): ${sizeFiltered}`);
  console.log(`  No keyword match: ${noKeywordFiltered}`);
  console.log(`  Low score: ${lowScoreFiltered}`);
  console.log(`  ✅ Final matches: ${matchCount}`);

  // Show matches sorted by score
  matches.sort((a, b) => b.score - a.score);
  console.log(`\n🎯 All ${matchCount} matches:`);
  for (const m of matches) {
    console.log(`  [${m.score}] ${m.name} (${m.size}, ${m.value})`);
    console.log(`       ${m.reason}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
