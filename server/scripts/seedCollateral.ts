/**
 * Seed Collateral Library with the X1350 and XAVS1800 flyers.
 * Run: npx tsx server/scripts/seedCollateral.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { createCollateralItem, runCollateralMatching } from "../collateralService";
import { getDb } from "../db";
import { projects } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const FLYERS = [
  {
    filePath: "/home/ubuntu/upload/atlas_copco_x1350_flyer.pdf.pdf",
    name: "DrillAir X1350 — Short-Package 25 Bar Truck-Deck Compressor",
    description: "The X1350 delivers 1,320 cfm at 25 bar through a Cummins Stage III engine in a shorter package designed for truck-deck drilling. Built for drillers who need high-pressure performance without giving away truck tray space. Features DrillAir, Oiltronix V2, and Dynamic Flow Boost. Ideal non-CAT alternative for RC drilling, waterwell, and exploration drilling operations.",
    productLine: "portable_air",
    applicationTags: [
      "rc_drilling",
      "waterwell_drilling",
      "exploration_drilling",
      "blast_hole_drilling",
    ],
    sectorTags: [
      "mining",
      "oil_gas",
      "infrastructure",
      "water",
    ],
    keywordTags: [
      "25 bar",
      "truck-deck",
      "short package",
      "cummins",
      "drillair",
      "drill support",
      "rig builder",
      "oiltronix",
      "high pressure",
      "tray space",
      "drill",
      "drilling",
      "bore",
      "borehole",
      "exploration",
      "geotechnical",
    ],
    fileName: "atlas_copco_x1350_flyer.pdf",
    fileMimeType: "application/pdf",
  },
  {
    filePath: "/home/ubuntu/upload/atlas_copco_xavs1800_flyer.pdf.pdf",
    name: "XAVS1800 — High-Volume Air for Demanding Abrasive Blasting",
    description: "The XAVS1800 delivers 1,800 cfm at 7 bar (or 1,500 cfm at 14 bar dual pressure) to support high-production blasting where nozzle pressure and continuous airflow matter. Supports up to four 11mm blasting setups or three 12.5mm setups simultaneously. Features 975L fuel tank for full-shift runtime, aftercooler fitted for air quality, and fully bunded. Built for large surface preparation, shutdown work, tank blasting, structural steel, and multi-operator blasting crews.",
    productLine: "portable_air",
    applicationTags: [
      "sandblasting",
      "pipeline_testing",
      "construction_general",
      "mining_production",
    ],
    sectorTags: [
      "mining",
      "oil_gas",
      "infrastructure",
      "energy",
      "construction",
    ],
    keywordTags: [
      "blasting",
      "abrasive",
      "high volume",
      "dual pressure",
      "multi-operator",
      "surface prep",
      "surface preparation",
      "shutdown",
      "tank blasting",
      "structural steel",
      "sandblast",
      "nozzle pressure",
      "aftercooler",
      "bunded",
      "maintenance",
      "coating",
      "paint removal",
      "corrosion",
    ],
    fileName: "atlas_copco_xavs1800_flyer.pdf",
    fileMimeType: "application/pdf",
  },
];

async function main() {
  console.log("=== Seeding Collateral Library ===\n");

  for (const flyer of FLYERS) {
    console.log(`Uploading: ${flyer.name}`);
    
    const fileBuffer = readFileSync(flyer.filePath);
    const fileSizeBytes = fileBuffer.length;
    
    console.log(`  File size: ${(fileSizeBytes / 1024).toFixed(1)} KB`);
    console.log(`  Applications: ${flyer.applicationTags.join(", ")}`);
    console.log(`  Sectors: ${flyer.sectorTags.join(", ")}`);
    console.log(`  Keywords: ${flyer.keywordTags.length} tags`);

    try {
      const item = await createCollateralItem({
        name: flyer.name,
        description: flyer.description,
        productLine: flyer.productLine,
        fileBuffer,
        fileName: flyer.fileName,
        fileMimeType: flyer.fileMimeType,
        fileSizeBytes,
        applicationTags: flyer.applicationTags,
        sectorTags: flyer.sectorTags,
        keywordTags: flyer.keywordTags,
        uploadedBy: 1, // System/admin upload
        uploadedByName: "System",
      });

      console.log(`  ✓ Created collateral item #${item.id}`);
      console.log(`  ✓ S3 URL: ${item.fileUrl}`);
    } catch (err: any) {
      console.error(`  ✗ Error: ${err.message}`);
    }
    console.log();
  }

  // Now run matching against all active projects
  console.log("=== Running Collateral Matching Against All Projects ===\n");
  
  const db = await getDb();
  if (!db) {
    console.error("Database not available");
    process.exit(1);
  }

  const allProjects = await db.select({ id: projects.id })
    .from(projects)
    .where(eq(projects.lifecycleStatus, "active"));

  console.log(`Found ${allProjects.length} active projects to match against.`);

  const projectIds = allProjects.map(p => p.id);
  
  // Process in batches of 50
  const batchSize = 50;
  let totalMatches = 0;
  
  for (let i = 0; i < projectIds.length; i += batchSize) {
    const batch = projectIds.slice(i, i + batchSize);
    const result = await runCollateralMatching(batch);
    totalMatches += result.matchesCreated;
    console.log(`  Batch ${Math.floor(i / batchSize) + 1}: ${result.matchesCreated} matches from ${result.projectsProcessed} projects`);
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Total project matches created: ${totalMatches}`);
  console.log(`Across ${allProjects.length} active projects`);
  
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
