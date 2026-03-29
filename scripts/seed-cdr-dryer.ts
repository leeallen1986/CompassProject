/**
 * Seed CDR Dryer flyer into collateral library and run matching.
 * 
 * CDR 850/1200/1700 — Portable desiccant dryers for compressed air treatment.
 * Delivers -40°C dew point on location. Target: mining, oil & gas, chemical/process,
 * pipeline maintenance — any project using compressed air in harsh/remote conditions.
 * 
 * Unlike the X1350 ($200K+ purchase), CDR dryers are more broadly applicable —
 * they're needed wherever compressed air quality matters. But we still want to
 * concentrate on projects that genuinely use compressed air (not just any mining project).
 */

import { getDb } from "../server/db";
import {
  collateralItems, collateralProjectMatches, projects,
} from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { storagePut } from "../server/storage";
import { classifyProjectSize } from "../server/collateralService";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  // ── Step 1: Upload PDF to S3 ──
  const pdfPath = path.resolve("/home/ubuntu/upload/atlas_copco_cdr_flyer_v2.pdf");
  const pdfBuffer = fs.readFileSync(pdfPath);
  const randomSuffix = Math.random().toString(36).substring(2, 10);
  const fileKey = `collateral/seed/${randomSuffix}-atlas_copco_cdr_flyer_v2.pdf`;
  const { url: fileUrl } = await storagePut(fileKey, pdfBuffer, "application/pdf");
  console.log("✅ Uploaded CDR flyer to S3:", fileUrl);

  // ── Step 2: Insert collateral item ──
  // CDR dryers are portable air solutions used wherever compressed air quality matters.
  // Target sectors: mining (pneumatic tools, drilling), oil & gas (instrumentation),
  // chemical/process, pipeline maintenance.
  // 
  // Unlike the X1350/XAVS1800, CDR dryers don't need a "large" project filter —
  // they're relevant to any project using compressed air. But we DO want to filter
  // for projects that actually mention compressed air, pneumatic tools, drilling,
  // instrumentation, or pipeline work.
  
  const sectorTags = ["mining", "oil_gas"];
  const applicationTags = [
    "rc_drilling",
    "waterwell_drilling",
    "exploration_drilling",
    "blast_hole_drilling",
    "diamond_drilling",
    "sandblasting",
    "pipeline_testing",
    "pneumatic_tools",
    "oil_gas_production",
    "mining_production",
    "nitrogen_generation",
  ];
  const keywordTags = [
    "dry air",
    "desiccant",
    "dew point",
    "moisture",
    "air treatment",
    "air quality",
    "pneumatic",
    "instrumentation",
    "process air",
    "compressed air",
    "compressor",
    "drilling",
    "drill rig",
    "drill program",
    "drilling campaign",
    "drilling contractor",
    "production drilling",
    "grade control",
    "blasting",
    "abrasive blasting",
    "sandblasting",
    "pipeline testing",
    "pipeline maintenance",
    "shutdown",
    "turnaround",
    "maintenance",
    "corrosion",
    "lng",
    "gas processing",
    "refinery",
    "chemical plant",
    "processing plant",
    "smelter",
  ];

  // Check if CDR already exists
  const existing = await db.select().from(collateralItems)
    .where(eq(collateralItems.name, "CDR Portable Desiccant Dryers (CDR 850/1200/1700)"));
  
  let collateralId: number;
  if (existing.length > 0) {
    collateralId = existing[0].id;
    await db.update(collateralItems).set({
      sectorTags,
      applicationTags,
      keywordTags,
      fileKey,
      fileUrl,
      fileName: "atlas_copco_cdr_flyer_v2.pdf",
      fileMimeType: "application/pdf",
      fileSizeBytes: pdfBuffer.length,
      minProjectSize: "any" as any,
    }).where(eq(collateralItems.id, collateralId));
    console.log(`✅ Updated existing CDR collateral item (id: ${collateralId})`);
  } else {
    const [result] = await db.insert(collateralItems).values({
      name: "CDR Portable Desiccant Dryers (CDR 850/1200/1700)",
      description: "Atlas Copco CDR portable desiccant dryers deliver -40°C dew point air on location. Three models (880-1,700 cfm @ 7 bar). Fully pneumatic, no external power. Protects pneumatic tools, instrumentation, and downstream equipment from moisture damage. Ideal for mining, oil & gas, chemical/process, and pipeline maintenance.",
      productLine: "portable_air" as any,
      fileKey,
      fileUrl,
      fileName: "atlas_copco_cdr_flyer_v2.pdf",
      fileMimeType: "application/pdf",
      fileSizeBytes: pdfBuffer.length,
      applicationTags,
      sectorTags,
      keywordTags,
      minProjectSize: "any" as any,
      uploadedBy: 0,
      uploadedByName: "System Seed",
    });
    collateralId = result.insertId;
    console.log(`✅ Created CDR collateral item (id: ${collateralId})`);
  }

  console.log("  Sectors:", sectorTags.join(", "));
  console.log("  Applications:", applicationTags.length, "tags");
  console.log("  Keywords:", keywordTags.length, "tags");
  console.log("  minProjectSize: any (CDR dryers are broadly applicable)");

  // ── Step 3: Clear old matches and re-run ──
  await db.delete(collateralProjectMatches).where(eq(collateralProjectMatches.collateralId, collateralId));
  console.log("✅ Cleared old CDR matches");

  const allProjects = await db.select().from(projects);
  console.log(`\n📊 Processing ${allProjects.length} projects...`);

  let matchCount = 0;
  let noKeywordFiltered = 0;
  let lowScoreFiltered = 0;
  const matches: { name: string; score: number; reason: string; value: string; sector: string }[] = [];

  for (const project of allProjects) {
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
    if (sectorTags.map(s => s.toLowerCase()).includes(projectSector)) {
      score += 30;
      reasons.push(`Sector: ${projectSector}`);
    }

    // Application tag match (0-40)
    const appTags = applicationTags.map(t => t.replace(/_/g, " "));
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
    for (const kw of keywordTags) {
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

    // Drilling/compressor bonus
    const drillingKeywords = ["drill", "drilling", "bore", "borehole", "compressor", "pneumatic", "blast"];
    if (drillingKeywords.some(k => projectText.includes(k))) {
      score += 10;
      reasons.push("Compressed air context");
    }

    score = Math.min(100, score);

    // CDR dryers are broadly applicable but we still require at least one
    // keyword or application match — sector alone is too broad
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
    });
  }

  // Update match count
  await db.update(collateralItems).set({ matchCount }).where(eq(collateralItems.id, collateralId));

  console.log(`\n📊 Results:`);
  console.log(`  Total projects: ${allProjects.length}`);
  console.log(`  No keyword/app match: ${noKeywordFiltered}`);
  console.log(`  Low score: ${lowScoreFiltered}`);
  console.log(`  ✅ Final matches: ${matchCount}`);

  // Show matches sorted by score
  matches.sort((a, b) => b.score - a.score);
  console.log(`\n🎯 Top 30 matches (of ${matchCount}):`);
  for (const m of matches.slice(0, 30)) {
    console.log(`  [${m.score}] ${m.name} (${m.sector}, ${m.value})`);
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
