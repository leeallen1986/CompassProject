/**
 * Seed X-Air+ 1250-10 collateral item and run matching.
 * 
 * The X-Air+ 1250-10 is a versatile, high-flow, low-pressure portable compressor
 * (1,235 cfm, 5-10.3 bar) for:
 * - Abrasive blasting (multi-operator, large surface prep)
 * - Pipeline pigging, drying, purging, pressure testing
 * - Plant backup & shutdown air
 * - Shutdown & maintenance support
 * - Pneumatic tools on large sites
 * - Shallow drilling support
 * 
 * NOT for: deep RC/DTH drilling (that's X1350/Y1260), high-pressure blasting (XAVS1800)
 */
import { getDb } from "../server/db";
import {
  collateralItems, collateralProjectMatches, projects,
} from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { classifyProjectSize } from "../server/collateralService";

const XAIR_FILE_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663178278143/3SMu786VMCWdCnmNSx6pxw/atlas_copco_xair1250_flyer_bc7b538a.pdf";

async function seedXAir1250() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  // Check if already exists
  const existing = await db.select().from(collateralItems)
    .where(sql`${collateralItems.name} LIKE '%X-Air%1250%'`);

  let itemId: number;

  if (existing.length > 0) {
    itemId = existing[0].id;
    console.log(`X-Air+ 1250-10 already exists (id=${itemId}), updating tags...`);
  } else {
    // Insert new collateral item
    const [result] = await db.insert(collateralItems).values({
      name: "X-Air+ 1250-10 — High-Flow Portable Compressor for Industrial Work",
      description: "1,235 cfm adjustable air across 5-10.3 bar. Versatile high-flow compressor for abrasive blasting, pipeline services (pigging, drying, purging), plant backup & shutdown air, pneumatic tools, and shallow drilling support. AirXpert 2.0 control, Dynamic Flowboost, ECO Mode, Fleetlink Telematics, 50°C ambient rated. Cat C9.3B engine, 796L fuel tank.",
      productLine: "portable_air",
      fileKey: "collateral/seed/xair1250-flyer.pdf",
      fileUrl: XAIR_FILE_URL,
      fileName: "atlas_copco_xair1250_flyer.pdf",
      fileMimeType: "application/pdf",
      fileSizeBytes: 20894618,
      applicationTags: [
        "sandblasting",       // Abrasive blasting — core application
        "pipeline_testing",   // Pipeline pigging, drying, purging, pressure testing
        "pneumatic_tools",    // Large pneumatic tool demand on sites
        "mining_production",  // Plant backup air for mining operations
        "oil_gas_production", // Plant backup air for oil & gas
      ],
      sectorTags: [
        "mining",         // Mining shutdowns, plant air, pneumatic tools
        "oil_gas",        // Pipeline services, refinery turnarounds, LNG
        "infrastructure", // Pipeline corridors, large infrastructure maintenance
      ],
      keywordTags: [
        // Shutdown & turnaround signals (core use case)
        "shutdown",
        "turnaround",
        "maintenance outage",
        "plant backup",
        // Pipeline signals (core use case)
        "pigging",
        "pipeline",
        "purging",
        // Blasting signals (core use case — but lower pressure than XAVS1800)
        "surface prep",
        "abrasive blasting",
        "sandblasting",
        "coating",
        // Processing/plant signals
        "refinery",
        "processing plant",
        "smelter",
        "lng",
        "gas processing",
        // Large site pneumatic signals
        "pneumatic",
      ],
      minProjectSize: "large",
      uploadedBy: 0,
      uploadedByName: "System Seed",
    });
    itemId = result.insertId;
    console.log(`Created X-Air+ 1250-10 (id=${itemId})`);
  }

  // Update tags on existing item
  await db.update(collateralItems).set({
    applicationTags: [
      "sandblasting",
      "pipeline_testing",
      "pneumatic_tools",
      "mining_production",
      "oil_gas_production",
    ],
    sectorTags: ["mining", "oil_gas", "infrastructure"],
    keywordTags: [
      "shutdown", "turnaround", "maintenance outage", "plant backup",
      "pigging", "pipeline", "purging",
      "surface prep", "abrasive blasting", "sandblasting", "coating",
      "refinery", "processing plant", "smelter", "lng", "gas processing",
      "pneumatic",
    ],
    minProjectSize: "large" as any,
  }).where(eq(collateralItems.id, itemId));

  // Clear old matches for this item
  await db.delete(collateralProjectMatches)
    .where(eq(collateralProjectMatches.collateralId, itemId));

  // Get all projects
  const allProjects = await db.select({
    id: projects.id,
    name: projects.name,
    sector: projects.sector,
    value: projects.value,
    capexGrade: projects.capexGrade,
    priority: projects.priority,
    overview: projects.overview,
    location: projects.location,
    stage: projects.stage,
    contractors: projects.contractors,
  }).from(projects);

  console.log(`Scoring ${allProjects.length} projects...`);

  // Get the collateral item for matching
  const [item] = await db.select().from(collateralItems).where(eq(collateralItems.id, itemId));

  const sectorTags = (item.sectorTags || []).map((s: string) => s.toLowerCase());
  const appTags = (item.applicationTags || []).map((t: string) => t.toLowerCase().replace(/_/g, " "));
  const keywords = (item.keywordTags || []).map((k: string) => k.toLowerCase());

  const matches: { projectId: number; score: number; reason: string; name: string }[] = [];

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
    let hasAppOrKwMatch = false;

    // Sector match (0-30)
    if (sectorTags.includes(projectSector)) {
      score += 30;
      reasons.push(`Sector: ${projectSector}`);
    }

    // Application tag match (0-40)
    let appMatchCount = 0;
    const matchedApps: string[] = [];
    for (const tag of appTags) {
      const tagWords = tag.split(" ");
      const anyWordMatch = tagWords.some(w => w.length > 3 && projectText.includes(w));
      if (projectText.includes(tag) || anyWordMatch) {
        appMatchCount++;
        matchedApps.push(tag);
      }
    }
    if (appMatchCount > 0) {
      score += Math.min(40, appMatchCount * 20);
      reasons.push(`${appMatchCount} app tag(s): ${matchedApps.join(", ")}`);
      hasAppOrKwMatch = true;
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
      reasons.push(`${kwMatchCount} kw: ${matchedKws.join(", ")}`);
      hasAppOrKwMatch = true;
    }

    // Drilling context bonus
    const drillingKeywords = ["drill", "drilling", "bore", "borehole", "compressor", "pneumatic", "blast"];
    if (drillingKeywords.some(k => projectText.includes(k))) {
      score += 10;
      reasons.push("Drilling/compressor context");
    }

    // Size-restricted: require at least one app or keyword match
    if (!hasAppOrKwMatch) continue;

    // Cap at 100
    score = Math.min(100, score);

    // Require score >= 60 for high concentration
    if (score < 60) continue;

    matches.push({
      projectId: project.id,
      score,
      reason: reasons.join("; "),
      name: project.name,
    });
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  console.log(`\n=== X-Air+ 1250-10 Matching Results ===`);
  console.log(`Total matches: ${matches.length}`);

  // Score distribution
  const tiers = { "80-100": 0, "60-79": 0 };
  for (const m of matches) {
    if (m.score >= 80) tiers["80-100"]++;
    else tiers["60-79"]++;
  }
  console.log(`Score 80-100: ${tiers["80-100"]}`);
  console.log(`Score 60-79: ${tiers["60-79"]}`);

  console.log(`\nTop matches:`);
  for (const m of matches.slice(0, 30)) {
    console.log(`  [${m.score}] ${m.name} — ${m.reason}`);
  }

  if (matches.length > 30) {
    console.log(`  ... and ${matches.length - 30} more`);
  }

  // Insert matches into DB
  if (matches.length > 0) {
    for (const m of matches) {
      await db.insert(collateralProjectMatches).values({
        collateralId: itemId,
        projectId: m.projectId,
        matchScore: m.score,
        matchReason: m.reason,
      });
    }
    console.log(`\nInserted ${matches.length} matches into DB.`);
  }

  // Update match count on collateral item
  await db.update(collateralItems).set({
    matchCount: matches.length,
  }).where(eq(collateralItems.id, itemId));

  console.log("Done!");
  process.exit(0);
}

seedXAir1250().catch(err => {
  console.error(err);
  process.exit(1);
});
