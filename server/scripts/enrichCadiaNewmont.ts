/**
 * Targeted Apollo enrichment for Newmont Cadia named_unverified contacts.
 * Targets:
 *   - Adam Malcolm (Newmont, Maintenance Superintendent) — id 960103
 *   - Bucky Pinard (Newmont, Mine Maintenance Superintendent) — id 960102
 *   - Scott Laliberte (Newmont, Manager Process Operations) — id 960098
 * Also searches Apollo for additional Newmont Cadia site-level contacts.
 */

import "dotenv/config";
import { getDb } from "../db";
import { contacts, contactProjects } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  apolloPeopleSearch,
  apolloPeopleEnrich,
  logCreditUsage,
} from "../apolloEnrichment.js";

const CADIA_PROJECT_ID = 690089;
const CADIA_PROJECT_NAME = "Cadia Gold Mine Operations";
const REPORT_ID = 1;

// Named contacts to verify (existing named_unverified)
const NAMED_TARGETS = [
  { id: 960103, name: "Adam Malcolm", firstName: "Adam", lastName: "Malcolm", company: "Newmont", title: "Maintenance Superintendent" },
  { id: 960102, name: "Bucky Pinard", firstName: "Bucky", lastName: "Pinard", company: "Newmont", title: "Mine Maintenance Superintendent" },
  { id: 960098, name: "Scott Laliberte", firstName: "Scott", lastName: "Laliberte", company: "Newmont", title: "Manager Process Operations" },
];

// Search titles for new Newmont Cadia contacts
const SEARCH_TITLES = [
  "Mine Manager",
  "Site Manager",
  "Maintenance Superintendent",
  "Equipment Procurement",
  "Supply Chain Manager",
];

async function verifyNamedContacts(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  console.log("\n=== Step 1: Verify existing named_unverified Newmont contacts ===");
  for (const target of NAMED_TARGETS) {
    console.log(`\nSearching Apollo for: ${target.name} @ ${target.company}`);
    try {
      const searchResult = await apolloPeopleSearch({
        organizationName: target.company,
        personTitles: [target.title],
        keywords: target.firstName,
      });

      if (!searchResult.people || searchResult.people.length === 0) {
        console.log(`  ✗ Not found in Apollo`);
        continue;
      }

      // Find best match by first name
      const person = searchResult.people.find(
        (p) => p.first_name.toLowerCase() === target.firstName.toLowerCase()
      ) || searchResult.people[0];

      const displayName = `${person.first_name} ${person.last_name_obfuscated || ""}`.trim();
      console.log(`  Found: ${displayName} | ${person.title} | ${person.organization?.name || ""}`);

      if (!person.id) {
        console.log(`  ✗ No Apollo ID — cannot reveal email`);
        continue;
      }

      // Reveal email (1 credit)
      const enrichResult = await apolloPeopleEnrich({
        id: person.id,
        firstName: person.first_name,
        organizationName: person.organization?.name || target.company,
      });

      if (!enrichResult.person?.email) {
        console.log(`  ✗ No email returned from Apollo`);
        continue;
      }

      const email = enrichResult.person.email;
      const fullName = enrichResult.person.name || target.name;
      console.log(`  ✓ Email: ${email}`);

      await logCreditUsage({
        userId: 0,
        userName: "system:enrichCadiaNewmont",
        action: "reveal",
        creditsUsed: 1,
        contactName: fullName,
        projectId: CADIA_PROJECT_ID,
        projectName: CADIA_PROJECT_NAME,
        apolloPersonId: person.id,
      });

      await db
        .update(contacts)
        .set({
          email,
          contactTrustTier: "send_ready",
          enrichmentStatus: "enriched",
          enrichmentSource: "apollo",
          enrichedAt: new Date(),
          linkedinProfileUrl: enrichResult.person.linkedin_url || undefined,
        })
        .where(eq(contacts.id, target.id));

      console.log(`  ✓ Promoted contact ${target.id} to send_ready`);
    } catch (err) {
      console.error(`  ✗ Error processing ${target.name}:`, err);
    }
  }
}

async function searchNewContacts(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  console.log("\n=== Step 2: Search for new Newmont Cadia site-level contacts ===");

  // Get existing contact names to avoid duplicates
  const existing = await db
    .select({ name: contacts.name })
    .from(contacts)
    .innerJoin(contactProjects, eq(contactProjects.contactId, contacts.id))
    .where(eq(contactProjects.projectId, CADIA_PROJECT_ID));
  const existingNames = new Set(existing.map((c: { name: string }) => c.name.toLowerCase()));

  let newContactsAdded = 0;

  for (const titleQuery of SEARCH_TITLES) {
    console.log(`\nSearching: "${titleQuery}" @ Newmont (Australia)`);
    try {
      const searchResult = await apolloPeopleSearch({
        organizationName: "Newmont",
        personTitles: [titleQuery],
        personLocations: ["Australia"],
      });

      if (!searchResult.people || searchResult.people.length === 0) {
        console.log(`  No results`);
        continue;
      }

      for (const person of searchResult.people) {
        const displayName = `${person.first_name} ${person.last_name_obfuscated || ""}`.trim();
        if (existingNames.has(displayName.toLowerCase())) {
          console.log(`  Skip (duplicate): ${displayName}`);
          continue;
        }

        if (!person.has_email) {
          console.log(`  Skip (no email flag): ${displayName} | ${person.title}`);
          continue;
        }

        console.log(`  Candidate: ${displayName} | ${person.title}`);

        if (!person.id) continue;

        // Reveal email (1 credit)
        const enrichResult = await apolloPeopleEnrich({
          id: person.id,
          firstName: person.first_name,
          organizationName: person.organization?.name || "Newmont",
        });

        const email = enrichResult.person?.email;
        if (!email) {
          console.log(`    ✗ No email`);
          continue;
        }

        const fullName = enrichResult.person?.name || displayName;
        console.log(`    ✓ Email: ${email}`);

        await logCreditUsage({
          userId: 0,
          userName: "system:enrichCadiaNewmont",
          action: "reveal",
          creditsUsed: 1,
          contactName: fullName,
          projectId: CADIA_PROJECT_ID,
          projectName: CADIA_PROJECT_NAME,
          apolloPersonId: person.id,
        });

        // Determine role bucket from title
        const titleLower = (enrichResult.person?.title || titleQuery).toLowerCase();
        let roleBucket = "other";
        if (titleLower.includes("maintenance")) roleBucket = "maintenance";
        else if (titleLower.includes("procure") || titleLower.includes("supply")) roleBucket = "procurement";
        else if (titleLower.includes("manager") || titleLower.includes("site")) roleBucket = "operations";

        // Insert new contact
        const inserted = await db.insert(contacts).values({
          reportId: REPORT_ID,
          name: fullName,
          title: enrichResult.person?.title || titleQuery,
          company: enrichResult.person?.organization?.name || "Newmont",
          project: CADIA_PROJECT_NAME,
          priority: "hot",
          roleBucket,
          email,
          contactTrustTier: "send_ready",
          enrichmentStatus: "enriched",
          enrichmentSource: "apollo",
          enrichedAt: new Date(),
          linkedinProfileUrl: enrichResult.person?.linkedin_url || undefined,
          source: "apollo",
          regionClassification: "australia",
        });

        const insertedId = (inserted as unknown as { insertId: number }).insertId;
        if (insertedId) {
          await db.insert(contactProjects).values({
            contactId: insertedId,
            projectId: CADIA_PROJECT_ID,
            projectName: CADIA_PROJECT_NAME,
            relevance: "primary",
          });
          existingNames.add(fullName.toLowerCase());
          newContactsAdded++;
          console.log(`    ✓ Inserted as contact ${insertedId}`);
        }
      }
    } catch (err) {
      console.error(`  Error searching "${titleQuery}":`, err);
    }
  }

  console.log(`\nNew contacts added: ${newContactsAdded}`);
}

async function main(): Promise<void> {
  console.log("=== Cadia Newmont Enrichment Pass ===");
  console.log(`Target project: ${CADIA_PROJECT_NAME} (${CADIA_PROJECT_ID})`);

  await verifyNamedContacts();
  await searchNewContacts();

  // Final count
  const db2 = await getDb();
  if (!db2) { console.log("DB unavailable for final count"); process.exit(0); }
  const finalAll = await db2
    .select({ id: contacts.id, name: contacts.name, title: contacts.title, tier: contacts.contactTrustTier })
    .from(contacts)
    .innerJoin(contactProjects, eq(contactProjects.contactId, contacts.id))
    .where(eq(contactProjects.projectId, CADIA_PROJECT_ID));

  const srCount = finalAll.filter((c) => c.tier === "send_ready").length;
  console.log(`\n=== Final Cadia send_ready count: ${srCount} ===`);
  console.log("Send-ready contacts:");
  finalAll
    .filter((c) => c.tier === "send_ready")
    .forEach((c) => console.log(`  - ${c.name} | ${c.title}`));

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
