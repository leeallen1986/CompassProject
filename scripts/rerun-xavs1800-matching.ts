/**
 * Efficient script to:
 * 1. Set XAVS1800 collateral item's minProjectSize to "large"
 * 2. Delete all existing XAVS1800 project matches
 * 3. Re-run matching with the size filter active (in-memory scoring, batch DB writes)
 */
import { getDb } from "../server/db";
import {
  collateralItems, collateralProjectMatches, projects,
} from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import {
  classifyProjectSize, parseProjectValue,
} from "../server/collateralService";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  // 1. Find the XAVS1800 collateral item
  const allItems = await db.select().from(collateralItems);
  const xavs = allItems.find(i => i.name.includes("XAVS1800"));
  if (!xavs) { console.error("XAVS1800 not found"); process.exit(1); }
  console.log(`Found XAVS1800: id=${xavs.id}, current minProjectSize=${xavs.minProjectSize}`);

  // 2. Update minProjectSize to "large"
  await db.update(collateralItems)
    .set({ minProjectSize: "large" as any })
    .where(eq(collateralItems.id, xavs.id));
  console.log("Updated XAVS1800 minProjectSize to 'large'");

  // 3. Delete all existing XAVS1800 matches
  await db.delete(collateralProjectMatches)
    .where(eq(collateralProjectMatches.collateralId, xavs.id));
  console.log("Deleted existing XAVS1800 matches");

  // 4. Reset match count
  await db.update(collateralItems)
    .set({ matchCount: 0 })
    .where(eq(collateralItems.id, xavs.id));

  // 5. Get all projects
  const allProjects = await db.select().from(projects);
  console.log(`Total projects: ${allProjects.length}`);

  // 6. Classify and count sizes
  const sizeDistribution = { mega: 0, large: 0, standard: 0 };
  for (const p of allProjects) {
    sizeDistribution[classifyProjectSize(p)]++;
  }
  console.log(`\nProject size distribution:`);
  console.log(`  Mega (>$500M): ${sizeDistribution.mega}`);
  console.log(`  Large (>$50M or Grade A+hot+signals): ${sizeDistribution.large}`);
  console.log(`  Standard: ${sizeDistribution.standard}`);
  console.log(`  Eligible for XAVS1800 (large+mega): ${sizeDistribution.mega + sizeDistribution.large}`);

  // 7. Score all eligible projects in-memory (no per-project DB calls)
  const sectorTags = (xavs.sectorTags || []).map(s => s.toLowerCase());
  const appTags = (xavs.applicationTags || []).map(t => t.toLowerCase().replace(/_/g, " "));
  const keywords = (xavs.keywordTags || []).map(k => k.toLowerCase());
  const drillingKeywords = ["drill", "drilling", "bore", "borehole", "compressor", "pneumatic", "blast"];

  const matchesToInsert: { projectId: number; matchScore: number; matchReason: string }[] = [];

  for (const project of allProjects) {
    // Size gate
    const projectSize = classifyProjectSize(project);
    if (projectSize === "standard") continue; // XAVS1800 requires "large" or "mega"

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
    for (const kw of keywords) {
      if (projectText.includes(kw)) kwMatchCount++;
    }
    if (kwMatchCount > 0) {
      score += Math.min(20, kwMatchCount * 10);
      reasons.push(`${kwMatchCount} keyword(s) matched`);
    }

    // Product line bonus (0-10)
    if (xavs.productLine === "portable_air" && drillingKeywords.some(k => projectText.includes(k))) {
      score += 10;
      reasons.push("Portable air relevant to drilling/compressor context");
    }

    const finalScore = Math.min(100, score);
    if (finalScore > 20) {
      matchesToInsert.push({
        projectId: project.id,
        matchScore: finalScore,
        matchReason: reasons.join("; "),
      });
    }
  }

  console.log(`\nMatches to insert: ${matchesToInsert.length}`);

  // 8. Batch insert matches (chunks of 50)
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

  // 9. Update match count
  await db.update(collateralItems)
    .set({ matchCount: matchesToInsert.length })
    .where(eq(collateralItems.id, xavs.id));

  console.log(`\nXAVS1800 re-matching complete:`);
  console.log(`  Previous matches: 337 (no size filter)`);
  console.log(`  New matches: ${matchesToInsert.length} (large/mega projects only)`);
  console.log(`  Reduction: ${337 - matchesToInsert.length} small projects filtered out`);

  // 10. Show top matches
  const topMatches = matchesToInsert
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 15);

  console.log(`\nTop 15 XAVS1800 matches (after size filter):`);
  for (const m of topMatches) {
    const p = allProjects.find(pr => pr.id === m.projectId);
    if (p) {
      console.log(`  [${p.capexGrade}/${p.priority}] ${p.name} (${p.value}) — Score: ${m.matchScore}`);
    }
  }

  // 11. Show some filtered-out examples
  const filteredOut = allProjects
    .filter(p => classifyProjectSize(p) === "standard")
    .slice(0, 5);
  console.log(`\nSample projects filtered OUT (too small for XAVS1800):`);
  for (const p of filteredOut) {
    console.log(`  ${p.name} (${p.value}, ${p.capexGrade}/${p.priority})`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
