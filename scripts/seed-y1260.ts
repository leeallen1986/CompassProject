/**
 * Seed Y1260 DrillAir collateral item and run matching.
 * 
 * Target buyers:
 * 1. Drilling contractors (RC, DTH, multi-application fleets)
 * 2. Water well drillers
 * 3. Geothermal and foundation drilling
 * 4. Mine-site drilling support (pressure & flow matter)
 * 5. Fleet owners (cost per metre, uptime, resale value)
 */
import { getDb } from "../server/db";
import {
  collateralItems, collateralProjectMatches, projects,
} from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { classifyProjectSize } from "../server/collateralService";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  // ── 1. Upsert the Y1260 collateral item ──
  const Y1260_DATA = {
    name: "DrillAir Y1260 — High-Pressure 35 Bar Compressor for Serious Drilling",
    description: "35 bar / 1,382 cfm high-pressure compressor with DrillAirXpert control and Dynamic Flow Boost. Built for drilling contractors and fleet owners who need faster, deeper drilling at lower cost per metre. Suited to water well, geothermal, foundation, and high-pressure DTH drilling.",
    productLine: "portable_air",
    fileUrl: "https://d2xsxph8kpxj0f.cloudfront.net/310519663178278143/3SMu786VMCWdCnmNSx6pxw/atlas_copco_y1260_flyer_347e0287.pdf",
    fileKey: "collateral/seed/y1260-drillair-flyer.pdf",
    fileName: "atlas_copco_y1260_flyer.pdf",
    fileMimeType: "application/pdf",
    fileSizeBytes: 15614939,
    minProjectSize: "large" as const,

    // Tight sector tags — only sectors where high-pressure drilling happens
    sectorTags: ["mining", "oil_gas", "water"],

    // Application tags — focused on drilling types the Y1260 serves
    applicationTags: [
      "waterwell_drilling",
      "rc_drilling",
      "exploration_drilling",
      "blast_hole_drilling",
      "diamond_drilling",
    ],

    // Keyword tags — highly specific to the 5 buyer segments
    keywordTags: [
      // Drilling type signals
      "high pressure", "35 bar", "dth", "down the hole", "down-the-hole",
      "water well", "waterwell", "water bore", "water supply", "bore field",
      "geothermal", "ground source heat", "geothermal energy",
      "foundation drilling", "foundation piling", "piling rig",
      // Drilling contractor signals
      "drilling contractor", "drill rig", "drill fleet",
      "drill campaign", "drill program", "drilling campaign", "drilling program",
      "rc drill", "reverse circulation",
      // Mine-site drilling support
      "production drilling", "grade control", "resource definition",
      "blast hole", "open pit", "underground mine", "mine development",
      "mineral resource", "ore reserve", "resource estimate",
      "feasibility", "bankable", "definitive feasibility", "pre-feasibility",
      // Fleet owner / cost-per-metre signals
      "cost per metre", "metres drilled", "drilling productivity",
      "fleet standardis", "fleet renewal", "fleet replacement",
      "owner operator", "owner-operator",
    ],
  };

  // Check if Y1260 already exists
  const existing = await db.select().from(collateralItems)
    .where(sql`${collateralItems.name} LIKE '%Y1260%'`);

  let itemId: number;
  if (existing.length > 0) {
    itemId = existing[0].id;
    await db.update(collateralItems).set({
      ...Y1260_DATA,
      isActive: true,
      matchCount: 0,
    }).where(eq(collateralItems.id, itemId));
    // Clear old matches
    await db.delete(collateralProjectMatches)
      .where(eq(collateralProjectMatches.collateralId, itemId));
    console.log(`Updated existing Y1260 (id=${itemId}), cleared old matches`);
  } else {
    const [result] = await db.insert(collateralItems).values({
      ...Y1260_DATA,
      uploadedBy: 1,
      uploadedByName: "System Seed",
      isActive: true,
      matchCount: 0,
    });
    itemId = result.insertId;
    console.log(`Created Y1260 (id=${itemId})`);
  }

  // ── 2. Run matching against all projects ──
  const allProjects = await db.select({
    id: projects.id,
    name: projects.name,
    overview: projects.overview,
    sector: projects.sector,
    location: projects.location,
    stage: projects.stage,
    contractors: projects.contractors,
    value: projects.value,
    capexGrade: projects.capexGrade,
    priority: projects.priority,
  }).from(projects);

  console.log(`Scoring ${allProjects.length} projects...`);

  const matches: Array<{
    projectId: number;
    projectName: string;
    score: number;
    reasons: string[];
    size: string;
  }> = [];

  for (const project of allProjects) {
    // Size gate
    const projectSize = classifyProjectSize(project);
    if (projectSize === "standard") continue;

    const projectText = [
      project.name, project.overview, project.sector,
      project.location, project.stage,
      project.contractors ? JSON.stringify(project.contractors) : "",
    ].filter(Boolean).join(" ").toLowerCase();

    const projectSector = (project.sector || "").toLowerCase();

    let score = 0;
    const reasons: string[] = [];
    let hasApplicationOrKeywordMatch = false;

    // Sector match (0-30)
    if (Y1260_DATA.sectorTags.includes(projectSector)) {
      score += 30;
      reasons.push(`Sector: ${projectSector}`);
    }

    // Application tags (0-40)
    const appTags = Y1260_DATA.applicationTags.map(t => t.replace(/_/g, " "));
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

    // Keywords (0-20)
    let kwMatchCount = 0;
    const matchedKws: string[] = [];
    for (const kw of Y1260_DATA.keywordTags) {
      if (projectText.includes(kw)) {
        kwMatchCount++;
        matchedKws.push(kw);
      }
    }
    if (kwMatchCount > 0) {
      score += Math.min(20, kwMatchCount * 10);
      reasons.push(`${kwMatchCount} kw(s): ${matchedKws.slice(0, 3).join(", ")}`);
      hasApplicationOrKeywordMatch = true;
    }

    // Drilling bonus (0-10)
    const drillingKws = ["drill", "drilling", "bore", "borehole", "compressor", "pneumatic", "blast"];
    if (drillingKws.some(k => projectText.includes(k))) {
      score += 10;
      reasons.push("Drilling context");
    }

    score = Math.min(100, score);

    // Keyword-required gate for size-restricted collateral
    if (!hasApplicationOrKeywordMatch) continue;

    // Score threshold >= 60
    if (score < 60) continue;

    matches.push({
      projectId: project.id,
      projectName: project.name,
      score,
      reasons,
      size: projectSize,
    });
  }

  // Sort by score desc
  matches.sort((a, b) => b.score - a.score);

  console.log(`\n=== Y1260 MATCHING RESULTS ===`);
  console.log(`Total matches: ${matches.length}`);
  console.log(`Score 80-100: ${matches.filter(m => m.score >= 80).length}`);
  console.log(`Score 60-79: ${matches.filter(m => m.score >= 60 && m.score < 80).length}`);

  console.log(`\n--- All matches ---`);
  for (const m of matches) {
    console.log(`  [${m.score}] ${m.projectName} (${m.size}) — ${m.reasons.join("; ")}`);
  }

  // ── 3. Save matches to DB ──
  let saved = 0;
  for (const m of matches) {
    await db.insert(collateralProjectMatches).values({
      collateralId: itemId,
      projectId: m.projectId,
      matchScore: m.score,
      matchReason: m.reasons.join("; "),
    });
    saved++;
  }

  // Update match count
  await db.update(collateralItems)
    .set({ matchCount: matches.length })
    .where(eq(collateralItems.id, itemId));

  console.log(`\nSaved ${saved} matches to DB, matchCount updated to ${matches.length}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
