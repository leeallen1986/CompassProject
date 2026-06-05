/**
 * enrich-hot-projects.mjs
 * Targeted Apollo enrichment pass on hot tier1_actionable projects with zero send-ready contacts.
 * Run with: node scripts/enrich-hot-projects.mjs
 */

import { config } from "dotenv";
config();

// Project IDs identified as hot + tier1_actionable + zero send-ready contacts
const TARGET_PROJECT_IDS = [
  120006,   // Arrow Energy — Surat Gas Project (QLD)
  120004,   // Australian Submarine Agency — AUKUS Pillar 1 (SA)
  1680006,  // Remote Fibre Corridor Project (National)
  1290005,  // Yindjibarndi Energy Solar Project (Pilbara, WA)
  1740008,  // SA Firm Energy Reliability (FER) Battery Projects (SA)
  1380025,  // Rasp Mine ATA Tailings Dewatering Plant (Broken Hill, NSW)
  1380014,  // Melbourne hyperscale data centre development (VIC)
  1350038,  // Jinbi Solar Farm (Pilbara, WA)
  1020016,  // SAMI Bitumen Container Facility Expansion (Darwin, NT)
  840002,   // First Nations Microgrids Program (NT)
  1350012,  // Secondary School Upgrade (Western Sydney, NSW)
];

const BASE_URL = process.env.APP_SITE_URL || "http://localhost:3000";
const PIPELINE_SECRET = process.env.PIPELINE_SECRET;

if (!PIPELINE_SECRET) {
  console.error("ERROR: PIPELINE_SECRET not set in environment");
  process.exit(1);
}

async function triggerEnrichment(projectId) {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/enrich-project`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pipeline-secret": PIPELINE_SECRET,
      },
      body: JSON.stringify({ projectId, maxPerCompany: 5, enrichEmails: true }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { projectId, success: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = await res.json();
    return { projectId, success: true, ...data };
  } catch (err) {
    return { projectId, success: false, error: err.message };
  }
}

// Check if admin endpoint exists, otherwise use tRPC directly
async function checkAdminEndpoint() {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/enrich-project`, {
      method: "OPTIONS",
      headers: { "x-pipeline-secret": PIPELINE_SECRET },
    });
    return res.status !== 404;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`\n=== Targeted Hot Project Enrichment Pass ===`);
  console.log(`Target: ${TARGET_PROJECT_IDS.length} projects`);
  console.log(`Base URL: ${BASE_URL}\n`);

  // Check if dedicated endpoint exists
  const hasEndpoint = await checkAdminEndpoint();
  if (!hasEndpoint) {
    console.log("Admin endpoint not found — will use pipeline trigger approach");
    // Trigger via the scheduled run endpoint with targeted mode
    const res = await fetch(`${BASE_URL}/api/scheduled/run-pipeline`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pipeline-secret": PIPELINE_SECRET,
      },
      body: JSON.stringify({
        mode: "targeted_enrichment",
        projectIds: TARGET_PROJECT_IDS,
        maxCreditsPerProject: 5,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Pipeline trigger failed: HTTP ${res.status}: ${text.slice(0, 500)}`);
      process.exit(1);
    }

    const data = await res.json();
    console.log("Pipeline trigger response:", JSON.stringify(data, null, 2));
    return;
  }

  // Run per-project enrichment
  let totalFound = 0;
  let totalEnriched = 0;
  let totalCredits = 0;

  for (const projectId of TARGET_PROJECT_IDS) {
    process.stdout.write(`  Project ${projectId}... `);
    const result = await triggerEnrichment(projectId);
    if (result.success) {
      const found = result.contactsFound ?? 0;
      const enriched = result.contactsEnriched ?? 0;
      const credits = result.creditsUsed ?? 0;
      totalFound += found;
      totalEnriched += enriched;
      totalCredits += credits;
      console.log(`✓ found=${found} enriched=${enriched} credits=${credits}`);
    } else {
      console.log(`✗ ${result.error}`);
    }
    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total contacts found: ${totalFound}`);
  console.log(`Total contacts enriched: ${totalEnriched}`);
  console.log(`Total Apollo credits used: ${totalCredits}`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
