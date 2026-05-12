/**
 * Apollo enrichment for zero-contact pump projects:
 * 1. Bass Strait Decommissioning (690073) — Woodside owner, no contractors
 * 2. Cairns Water Infrastructure Upgrade (720008) — government owner (blocked), manual domain search
 */
import { enrichProjectContacts, searchContactsForCompany, enrichSingleContact } from "../server/apolloEnrichment";
import { getDb } from "../server/db";
import { contacts, contactProjects } from "../drizzle/schema";
import { sql } from "drizzle-orm";

const PUMP_TITLES = [
  "project manager",
  "site manager",
  "construction manager",
  "operations manager",
  "maintenance manager",
  "engineering manager",
  "dewatering",
  "water infrastructure",
  "infrastructure manager",
  "asset manager",
  "capital works manager",
];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  // ─── 1. Bass Strait Decommissioning (690073) — Woodside ───
  console.log("\n" + "═".repeat(70));
  console.log("ENRICHING: Bass Strait Decommissioning (690073) — Woodside");
  console.log("═".repeat(70));

  try {
    const result = await enrichProjectContacts(690073, 450001, {
      enrichEmails: true,
      maxPerCompany: 5,
      targetTitles: PUMP_TITLES,
    });
    console.log(`  Contacts found: ${result.contactsFound}`);
    if (result.contacts && result.contacts.length > 0) {
      result.contacts.slice(0, 8).forEach((c: any) => {
        console.log(`  ✅ ${c.name} — ${c.title || "No title"} @ ${c.organization || "Unknown"}`);
        console.log(`     Email: ${c.email ? c.email : "NO"} | LinkedIn: ${c.linkedinUrl ? "YES" : "NO"}`);
      });
    } else {
      console.log("  ❌ No contacts returned");
      if (result.blockedReason) console.log("  Reason:", result.blockedReason);
    }
  } catch (err: any) {
    console.log("  ❌ Error:", err.message);
  }

  // ─── 2. Cairns Water (720008) — manual domain search ───
  // Owner is government (Cairns Regional Council) — blocked from standard enrichment
  // Try direct domain search for cairns.qld.gov.au and likely contractors
  console.log("\n" + "═".repeat(70));
  console.log("SEARCHING: Cairns Water Infrastructure Upgrade (720008) — manual domains");
  console.log("═".repeat(70));

  const cairnsDomains = [
    { name: "Cairns Regional Council", domain: "cairns.qld.gov.au" },
    { name: "John Holland", domain: "jhg.com.au" },
    { name: "Veolia Water", domain: "veolia.com" },
    { name: "McConnell Dowell", domain: "mcconnelldowell.com" },
  ];

  for (const co of cairnsDomains) {
    console.log(`\n  Searching ${co.name} (${co.domain})...`);
    try {
      const searchResults = await searchContactsForCompany(
        co.domain,
        co.name,
        PUMP_TITLES,
        { locations: ["australia"], maxResults: 5 }
      );
      console.log(`    Found: ${searchResults.length} candidates`);
      if (searchResults.length > 0) {
        // Enrich top 3 with emails (costs credits)
        for (const person of searchResults.slice(0, 3)) {
          console.log(`    Enriching: ${person.name} — ${person.title}`);
          if (person.hasEmail && person.apolloId) {
            try {
              const enriched = await enrichSingleContact(person, {
                projectId: 720008,
                reportId: 480001,
                projectName: "Cairns Water Infrastructure Upgrade",
              });
              if (enriched) {
                console.log(`    ✅ ${enriched.name} — ${enriched.title}`);
                console.log(`       Email: ${enriched.email || "NO"} | LinkedIn: ${enriched.linkedinUrl ? "YES" : "NO"}`);
              }
            } catch (err: any) {
              console.log(`    ⚠️ Enrich failed: ${err.message}`);
            }
          } else {
            console.log(`    ⚠️ No email flag — skipping credit spend`);
          }
        }
      } else {
        console.log("    ❌ No candidates found");
      }
    } catch (err: any) {
      console.log(`    ❌ Error: ${err.message}`);
    }
  }

  // ─── Post-enrichment check ───
  console.log("\n" + "═".repeat(70));
  console.log("POST-ENRICHMENT CHECK");
  console.log("═".repeat(70));

  const [check] = await db.execute(sql`
    SELECT p.id, p.name,
      COUNT(c.id) as totalContacts,
      SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) as sendReady,
      SUM(CASE WHEN c.contactTrustTier = 'named_unverified' THEN 1 ELSE 0 END) as namedUnverified
    FROM projects p
    LEFT JOIN contactProjects cp ON cp.projectId = p.id
    LEFT JOIN contacts c ON c.id = cp.contactId AND c.rejectionReason IS NULL
    WHERE p.id IN (720008, 690073)
    GROUP BY p.id, p.name
  `);

  for (const r of check as any[]) {
    const status = Number(r.sendReady) > 0 ? "✅ SEND_READY" :
      Number(r.namedUnverified) > 0 ? "⚠️ NAMED_UNVERIFIED" : "❌ STILL NO CONTACTS";
    console.log(`  ${status} | ${r.name} — ${r.totalContacts} total (${r.sendReady} send_ready, ${r.namedUnverified} named_unverified)`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
