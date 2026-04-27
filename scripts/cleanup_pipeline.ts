/**
 * Pipeline Cleanup Script
 * 1. Kill stuck run 660001 (and any other stuck runs)
 * 2. Suppress @unknown.com.au contacts (null out email, mark suppressed)
 * 3. Report counts
 */
import { getDb } from "../server/db";
import { contacts, pipelineRuns } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.log("No DB"); return; }

  // ── 1. Kill stuck running pipeline runs ──
  const stuckRuns = await db.select({ id: pipelineRuns.id, startedAt: pipelineRuns.startedAt })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.status, "running"));

  if (stuckRuns.length > 0) {
    for (const run of stuckRuns) {
      await db.update(pipelineRuns).set({
        status: "failed",
        completedAt: new Date(),
        errors: [`Pipeline run killed by cleanup script — contact enrichment timeout (24,236 pending contacts exceeded 25-min ENRICHMENT_TIMEOUT_MS). Root cause: missing per-batch limit on runEnrichmentPipeline query.`],
      }).where(eq(pipelineRuns.id, run.id));
      console.log(`✓ Killed stuck run ID ${run.id} (started ${run.startedAt})`);
    }
  } else {
    console.log("No stuck runs found.");
  }

  // ── 2. Suppress @unknown.com.au contacts ──
  // Null out the email and mark enrichmentStatus as 'suppressed' to exclude from outreach/digest
  const unknownResult = await db.execute(sql`
    UPDATE contacts 
    SET 
      email = NULL,
      enrichmentStatus = 'suppressed',
      enrichedAt = NOW()
    WHERE email LIKE '%@unknown.com.au%'
  `);
  console.log(`✓ Suppressed ${(unknownResult as any).affectedRows ?? 0} @unknown.com.au contacts`);

  // ── 3. Suppress contacts with double-domain emails (e.g. .com.au.com.au) ──
  const doubleDomainResult = await db.execute(sql`
    UPDATE contacts 
    SET 
      email = NULL,
      enrichmentStatus = 'suppressed',
      enrichedAt = NOW()
    WHERE email REGEXP '\\.com\\.au\\.com' OR email REGEXP '\\.com\\.com'
  `);
  console.log(`✓ Suppressed ${(doubleDomainResult as any).affectedRows ?? 0} double-domain contacts`);

  // ── 4. Suppress contacts with company = 'Unknown' that have inferred emails ──
  const unknownCompanyResult = await db.execute(sql`
    UPDATE contacts 
    SET 
      email = NULL,
      enrichmentStatus = 'suppressed',
      enrichedAt = NOW()
    WHERE company = 'Unknown' AND email IS NOT NULL AND enrichmentStatus != 'suppressed'
  `);
  console.log(`✓ Suppressed ${(unknownCompanyResult as any).affectedRows ?? 0} Unknown-company inferred email contacts`);

  // ── 5. Report final state ──
  const [pending] = await db.select({ count: sql<number>`count(*)` }).from(contacts)
    .where(sql`enrichmentStatus = 'pending' OR enrichmentStatus IS NULL`);
  const [suppressed] = await db.select({ count: sql<number>`count(*)` }).from(contacts)
    .where(eq(contacts.enrichmentStatus, "suppressed"));
  const [total] = await db.select({ count: sql<number>`count(*)` }).from(contacts);
  
  console.log(`\n── Final state ──`);
  console.log(`Total contacts: ${total.count}`);
  console.log(`Pending enrichment: ${pending.count}`);
  console.log(`Suppressed: ${suppressed.count}`);
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
