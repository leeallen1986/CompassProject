/**
 * Run Apollo enrichment on the 4 zero-contact top projects.
 * These are the highest-priority projects blocking 9 reps.
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { enrichProjectContacts } from "../server/apolloEnrichment";

const TARGET_IDS = [690023, 690026, 690028, 690030];

async function main() {
  const db = await getDb();

  // Get project details including reportId
  const [projects] = await db.execute(sql`
    SELECT id, reportId, name, owner, projectState, sector, enrichmentBlockedReason
    FROM projects
    WHERE id IN (${sql.raw(TARGET_IDS.join(","))})
  `);

  console.log(`Found ${(projects as any[]).length} projects to enrich via Apollo\n`);

  for (const project of projects as any[]) {
    console.log(`\n${"═".repeat(80)}`);
    console.log(`APOLLO ENRICHING: ${project.name} (ID: ${project.id})`);
    console.log(`  Owner: ${project.owner || "Unknown"} | State: ${project.projectState || "Unknown"} | Sector: ${project.sector}`);
    if (project.enrichmentBlockedReason) {
      console.log(`  ⚠️ Previously blocked: ${project.enrichmentBlockedReason}`);
    }
    console.log(`${"═".repeat(80)}`);

    try {
      const result = await enrichProjectContacts(project.id, project.reportId, {
        enrichEmails: true,
        maxPerCompany: 5,
        targetTitles: [
          "project manager", "procurement", "operations manager",
          "site manager", "fleet manager", "maintenance manager",
          "engineering manager", "construction manager"
        ],
      });

      console.log(`  Result: ${result.contactsFound} contacts found`);
      if (result.contacts && result.contacts.length > 0) {
        for (const c of result.contacts.slice(0, 5)) {
          console.log(`    ✅ ${c.name} — ${c.title || "No title"} @ ${c.organization || "Unknown"}`);
          console.log(`       Email: ${c.email ? "YES" : "NO"} | LinkedIn: ${c.linkedinUrl ? "YES" : "NO"}`);
        }
      } else {
        console.log(`    ❌ No contacts returned`);
        if (result.blockedReason) console.log(`    Reason: ${result.blockedReason}`);
      }
    } catch (err: any) {
      console.log(`  ❌ Apollo enrichment failed: ${err.message}`);
    }
  }

  // Final check
  console.log(`\n\n${"═".repeat(80)}`);
  console.log(`POST-APOLLO CONTACT CHECK`);
  console.log(`${"═".repeat(80)}`);

  const [postCheck] = await db.execute(sql`
    SELECT p.id, p.name,
      COUNT(c.id) as totalContacts,
      SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) as sendReady,
      SUM(CASE WHEN c.contactTrustTier = 'named_unverified' THEN 1 ELSE 0 END) as namedUnverified,
      SUM(CASE WHEN c.contactTrustTier = 'llm_inferred' THEN 1 ELSE 0 END) as llmInferred
    FROM projects p
    LEFT JOIN contacts c ON LOWER(c.project) = LOWER(p.name)
    WHERE p.id IN (${sql.raw(TARGET_IDS.join(","))})
    GROUP BY p.id, p.name
  `);

  for (const r of postCheck as any[]) {
    const status = Number(r.sendReady) > 0 ? "✅ SEND_READY" : Number(r.namedUnverified) > 0 ? "⚠️ NAMED_UNVERIFIED" : "❌ STILL_NO_CONTACT";
    console.log(`  ${status} | ${r.name} — ${r.totalContacts} total (${r.sendReady} send_ready, ${r.namedUnverified} named_unverified, ${r.llmInferred} llm_inferred)`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
