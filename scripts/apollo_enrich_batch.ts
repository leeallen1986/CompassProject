/**
 * Batch Apollo enrichment for all zero-contact top projects with known private owners.
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { enrichProjectContacts } from "../server/apolloEnrichment";

async function main() {
  const db = await getDb();

  // Find all active projects with BL score >= 90, zero send_ready/named_unverified contacts,
  // and a non-Unknown owner
  const [candidates] = await db.execute(sql`
    SELECT p.id, p.reportId, p.name, p.owner, p.projectState, pbl.scoringDimension, pbl.score,
      (SELECT COUNT(*) FROM contacts c WHERE LOWER(c.project) = LOWER(p.name) AND c.contactTrustTier IN ('send_ready', 'named_unverified')) as contactCount
    FROM projects p
    JOIN projectBusinessLineScores pbl ON p.id = pbl.projectId
    WHERE p.lifecycleStatus IN ('active', 'awarded')
    AND pbl.score >= 90
    AND p.owner != 'Unknown'
    AND p.owner NOT LIKE '%Government%'
    AND p.owner NOT LIKE '%Department%'
    AND p.enrichmentBlockedReason IS NULL
    HAVING contactCount = 0
    ORDER BY pbl.score DESC
    LIMIT 20
  `);

  const projects = candidates as any[];
  console.log(`Found ${projects.length} zero-contact projects with enrichable owners\n`);

  let enriched = 0;
  let failed = 0;

  for (const project of projects) {
    console.log(`\n[${enriched + failed + 1}/${projects.length}] ${project.name}`);
    console.log(`  Owner: ${project.owner} | State: ${project.projectState} | Dim: ${project.scoringDimension} | Score: ${project.score}`);

    try {
      const result = await enrichProjectContacts(project.id, project.reportId, {
        enrichEmails: true,
        maxPerCompany: 3,
      });

      const found = result?.contactsFound ?? 0;
      if (found > 0) {
        console.log(`  ✅ ${found} contacts found`);
        enriched++;
      } else {
        console.log(`  ⚠️ 0 contacts found`);
        failed++;
      }
    } catch (err: any) {
      console.log(`  ❌ Failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`BATCH COMPLETE: ${enriched} enriched, ${failed} failed out of ${projects.length}`);
  console.log(`${"═".repeat(60)}`);

  // Final verification
  const [verify] = await db.execute(sql`
    SELECT p.id, p.name, p.owner,
      (SELECT COUNT(*) FROM contacts c WHERE LOWER(c.project) = LOWER(p.name) AND c.contactTrustTier IN ('send_ready', 'named_unverified')) as contactCount
    FROM projects p
    JOIN projectBusinessLineScores pbl ON p.id = pbl.projectId
    WHERE p.lifecycleStatus IN ('active', 'awarded')
    AND pbl.score >= 90
    AND p.owner != 'Unknown'
    AND p.owner NOT LIKE '%Government%'
    AND p.owner NOT LIKE '%Department%'
    ORDER BY pbl.score DESC
    LIMIT 30
  `);

  console.log(`\nPOST-ENRICHMENT TOP 30 PROJECTS:`);
  for (const r of verify as any[]) {
    const status = Number(r.contactCount) > 0 ? "✅" : "❌";
    console.log(`  ${status} ${r.name} | Owner: ${r.owner} | Contacts: ${r.contactCount}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
