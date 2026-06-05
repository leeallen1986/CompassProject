/**
 * run-hot-enrichment.ts
 * Targeted Apollo enrichment pass on hot tier1_actionable projects with zero send-ready contacts.
 * Run with: npx tsx scripts/run-hot-enrichment.ts
 */

import "dotenv/config";
import { enrichProjectContacts } from "../server/apolloEnrichment";
import { getDb } from "../server/db";
import { contactProjects, contacts, projects } from "../drizzle/schema";
import { eq, and, inArray, isNotNull, ne } from "drizzle-orm";

// Hot tier1_actionable projects with zero send-ready contacts
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

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database not available");
    process.exit(1);
  }

  console.log(`\n=== Targeted Hot Project Enrichment Pass ===`);
  console.log(`Targeting ${TARGET_PROJECT_IDS.length} hot tier1_actionable projects with 0 send-ready contacts\n`);

  let totalFound = 0;
  let totalEnriched = 0;
  let totalCredits = 0;
  let totalErrors = 0;

  for (const projectId of TARGET_PROJECT_IDS) {
    // Get project name for logging
    const [project] = await db
      .select({ name: projects.name, location: projects.location })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    const label = project ? `${project.name} (${project.location})` : `Project ${projectId}`;
    process.stdout.write(`  [${TARGET_PROJECT_IDS.indexOf(projectId) + 1}/${TARGET_PROJECT_IDS.length}] ${label}... `);

    try {
      const result = await enrichProjectContacts(projectId, 0, {
        maxPerCompany: 5,
        enrichEmails: true,
      });

      const found = result.contactsFound ?? 0;
      const enriched = result.contactsEnriched ?? 0;
      const credits = result.creditsUsed ?? 0;

      totalFound += found;
      totalEnriched += enriched;
      totalCredits += credits;

      if (found > 0) {
        console.log(`✓ found=${found} enriched=${enriched} credits=${credits}`);
      } else {
        const reason = result.skipReason || result.blockedReason || "no contacts found";
        console.log(`○ skipped — ${reason}`);
      }
    } catch (err: unknown) {
      totalErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ error: ${msg.slice(0, 100)}`);
    }

    // Small delay between projects to avoid rate limiting
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n=== Summary ===`);
  console.log(`Projects processed: ${TARGET_PROJECT_IDS.length}`);
  console.log(`Contacts found:     ${totalFound}`);
  console.log(`Contacts enriched:  ${totalEnriched}`);
  console.log(`Apollo credits used: ${totalCredits}`);
  console.log(`Errors:             ${totalErrors}`);

  // Final check — how many of the target projects now have send-ready contacts
  const enrichedProjects = await db
    .select({ projectId: contactProjects.projectId })
    .from(contactProjects)
    .innerJoin(contacts, eq(contacts.id, contactProjects.contactId))
    .where(
      and(
        inArray(contactProjects.projectId, TARGET_PROJECT_IDS),
        eq(contacts.enrichmentStatus, "enriched"),
        isNotNull(contacts.email),
        ne(contacts.email, "")
      )
    )
    .groupBy(contactProjects.projectId);

  const coveredIds = new Set(enrichedProjects.map(r => r.projectId));
  const stillEmpty = TARGET_PROJECT_IDS.filter(id => !coveredIds.has(id));

  console.log(`\nProjects now with send-ready contacts: ${coveredIds.size}/${TARGET_PROJECT_IDS.length}`);
  if (stillEmpty.length > 0) {
    console.log(`Still empty (${stillEmpty.length}): ${stillEmpty.join(", ")}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
