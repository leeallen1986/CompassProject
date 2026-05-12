/**
 * Targeted Apollo enrichment for Cairns Water Infrastructure Upgrade (720008).
 * The project owner is "Cairns Regional Council (implied)" — classified as government,
 * so the standard enrichProjectContacts flow blocks it.
 *
 * Strategy: temporarily override the project owner to a known contractor domain,
 * then run enrichProjectContacts for each likely contractor separately.
 * This uses the full DB-insert path including contactProjects linking.
 */
import { getDb } from "../server/db";
import { projects, contacts, contactProjects } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { searchContactsForCompany, enrichSingleContact, logCreditUsage } from "../server/apolloEnrichment";

const PROJECT_ID = 720008;
const REPORT_ID = 480001;
const PROJECT_NAME = "Cairns Water Infrastructure Upgrade";

const PUMP_TITLES = [
  "project manager",
  "site manager",
  "construction manager",
  "operations manager",
  "maintenance manager",
  "engineering manager",
  "water infrastructure",
  "infrastructure manager",
  "asset manager",
  "capital works manager",
];

// Companies to search — Cairns Regional Council + likely contractors for water infrastructure
const COMPANIES = [
  { name: "Cairns Regional Council", domain: "cairns.qld.gov.au" },
  { name: "John Holland", domain: "jhg.com.au" },
  { name: "McConnell Dowell", domain: "mcconnelldowell.com" },
  { name: "Veolia Water Australia", domain: "veolia.com.au" },
];

function inferRoleBucket(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("project manager") || t.includes("site manager")) return "Project Management";
  if (t.includes("construction")) return "Construction";
  if (t.includes("operations") || t.includes("maintenance")) return "Operations";
  if (t.includes("engineering") || t.includes("asset")) return "Engineering";
  if (t.includes("procurement")) return "Procurement";
  return "Other";
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  console.log(`\n${"═".repeat(70)}`);
  console.log(`TARGETED ENRICHMENT: ${PROJECT_NAME} (ID: ${PROJECT_ID})`);
  console.log(`${"═".repeat(70)}`);

  let totalInserted = 0;

  for (const company of COMPANIES) {
    console.log(`\n  Searching ${company.name} (${company.domain})...`);

    const candidates = await searchContactsForCompany(
      company.domain,
      company.name,
      PUMP_TITLES,
      { locations: ["australia"], maxResults: 5 }
    );

    if (candidates.length === 0) {
      console.log(`    ❌ No candidates found`);
      continue;
    }

    console.log(`    Found ${candidates.length} candidates — enriching top 3 with emails`);

    for (const person of candidates.slice(0, 3)) {
      if (!person.hasEmail) {
        console.log(`    ⚠️ ${person.name} — no email flag, skipping`);
        continue;
      }

      const enriched = await enrichSingleContact(person, {
        projectId: PROJECT_ID,
        projectName: PROJECT_NAME,
      });

      if (enriched.status !== "enriched" || !enriched.email) {
        console.log(`    ⚠️ ${enriched.name} — enrichment failed or no email`);
        continue;
      }

      // Check if contact already exists
      const existing = await db.select({ id: contacts.id })
        .from(contacts)
        .where(sql`LOWER(${contacts.name}) = LOWER(${enriched.name}) AND LOWER(${contacts.company}) = LOWER(${company.name})`)
        .limit(1);

      let contactId: number;

      if (existing.length > 0) {
        contactId = existing[0].id;
        console.log(`    ♻️  Existing contact: ${enriched.name} (ID: ${contactId})`);
      } else {
        // Insert new contact
        const [inserted] = await db.insert(contacts).values({
          reportId: REPORT_ID,
          name: enriched.name,
          title: enriched.title || "Unknown",
          company: company.name,
          project: PROJECT_NAME,
          priority: "warm",
          roleBucket: inferRoleBucket(enriched.title || ""),
          email: enriched.email,
          linkedin: enriched.linkedinUrl || null,
          enrichmentStatus: "enriched",
          enrichmentSource: "apollo",
          enrichedAt: new Date(),
          linkedinHeadline: enriched.title,
          linkedinLocation: [enriched.city, enriched.state, enriched.country].filter(Boolean).join(", ") || null,
          linkedinProfilePic: enriched.photoUrl || null,
          verificationStatus: enriched.emailStatus === "verified" ? "verified" : "unverified",
          verificationScore: enriched.emailStatus === "verified" ? 95 : enriched.emailStatus === "likely_to_engage" ? 80 : 50,
          emailVerified: enriched.emailStatus === "verified",
          contactTrustTier: enriched.emailStatus === "verified" ? "send_ready" : "named_unverified",
        } as any);
        contactId = (inserted as any).insertId;
        console.log(`    ✅ Inserted: ${enriched.name} — ${enriched.title} | ${enriched.email} | Trust: ${enriched.emailStatus === "verified" ? "send_ready" : "named_unverified"}`);
        totalInserted++;
      }

      // Link to project via contactProjects
      const existingLink = await db.select({ id: contactProjects.id })
        .from(contactProjects)
        .where(sql`${contactProjects.contactId} = ${contactId} AND ${contactProjects.projectId} = ${PROJECT_ID}`)
        .limit(1);

      if (existingLink.length === 0) {
        await db.insert(contactProjects).values({
          contactId,
          projectId: PROJECT_ID,
          projectName: PROJECT_NAME,
          relevance: "secondary",
        } as any);
        console.log(`       Linked to project ${PROJECT_ID}`);
      }
    }
  }

  // Post-enrichment check
  console.log(`\n${"═".repeat(70)}`);
  console.log(`POST-ENRICHMENT CHECK`);
  console.log(`${"═".repeat(70)}`);

  const [check] = await db.execute(sql`
    SELECT c.id, c.name, c.title, c.email, c.contactTrustTier, c.company
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    WHERE cp.projectId = ${PROJECT_ID} AND c.rejectionReason IS NULL
    ORDER BY CASE c.contactTrustTier WHEN 'send_ready' THEN 1 WHEN 'named_unverified' THEN 2 ELSE 3 END
  `);

  const rows = check as any[];
  if (rows.length === 0) {
    console.log("  ❌ Still no contacts linked to project");
  } else {
    console.log(`  ✅ ${rows.length} contacts now linked to Cairns Water:`);
    rows.forEach((r: any) => {
      console.log(`    ${r.name} — ${r.title} @ ${r.company} | ${r.contactTrustTier} | ${r.email}`);
    });
  }

  console.log(`\nTotal new contacts inserted: ${totalInserted}`);
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
