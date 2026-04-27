/**
 * Cleanup script:
 * 1. Kill stuck pipeline run 660001 (set status='failed', durationMs=0)
 * 2. Suppress all @unknown.com.au contacts (null out email, set enrichmentStatus='failed')
 * 3. Report counts
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  console.log("=== Pipeline Cleanup ===\n");

  // 1. Kill stuck run 660001
  console.log("1. Killing stuck run 660001...");
  const [killResult] = await db.execute(sql`
    UPDATE pipelineRuns
    SET status = 'failed',
        durationMs = 0,
        errors = JSON_ARRAY('Killed by cleanup script: enrichment hang due to missing per-call timeout in callDataApi')
    WHERE id = 660001 AND status = 'running'
  `) as any;
  console.log(`   Rows affected: ${killResult.affectedRows}`);

  // Also kill any other stuck 'running' runs older than 1 hour
  const [otherStuck] = await db.execute(sql`
    UPDATE pipelineRuns
    SET status = 'failed',
        durationMs = 0,
        errors = JSON_ARRAY('Killed by cleanup script: stale running state')
    WHERE status = 'running'
      AND startedAt < DATE_SUB(NOW(), INTERVAL 1 HOUR)
  `) as any;
  console.log(`   Other stale runs killed: ${otherStuck.affectedRows}`);

  // 2. Suppress @unknown.com.au contacts
  console.log("\n2. Suppressing @unknown.com.au contacts...");
  
  // First, count them
  const [countResult] = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM contacts WHERE email LIKE '%@unknown.com.au'
  `) as any;
  const unknownCount = countResult[0]?.cnt || 0;
  console.log(`   Found ${unknownCount} contacts with @unknown.com.au emails`);

  if (unknownCount > 0) {
    // List them before suppressing
    const [unknownContacts] = await db.execute(sql`
      SELECT id, name, email, company FROM contacts WHERE email LIKE '%@unknown.com.au' LIMIT 50
    `) as any;
    for (const c of unknownContacts) {
      console.log(`   - [${c.id}] ${c.name} <${c.email}> (${c.company})`);
    }

    // Null out the email and mark as failed
    const [suppressResult] = await db.execute(sql`
      UPDATE contacts
      SET email = NULL,
          enrichmentStatus = 'failed'
      WHERE email LIKE '%@unknown.com.au'
    `) as any;
    console.log(`   Suppressed: ${suppressResult.affectedRows} contacts`);
  }

  // 3. Also suppress other garbage patterns
  console.log("\n3. Checking for other garbage email patterns...");
  const garbagePatterns = [
    '%@various.com.au',
    '%@tba.com.au',
    '%@tbc.com.au',
    '%@na.com.au',
    '%@none.com.au',
    '%@undisclosed.com.au',
    '%@confidential.com.au',
  ];
  
  for (const pattern of garbagePatterns) {
    const [cnt] = await db.execute(sql`SELECT COUNT(*) as cnt FROM contacts WHERE email LIKE ${pattern}`) as any;
    const count = cnt[0]?.cnt || 0;
    if (count > 0) {
      console.log(`   Found ${count} contacts with ${pattern} — suppressing...`);
      await db.execute(sql`UPDATE contacts SET email = NULL, enrichmentStatus = 'failed' WHERE email LIKE ${pattern}`);
    }
  }

  // 4. Summary
  console.log("\n=== Summary ===");
  const [runStatus] = await db.execute(sql`
    SELECT id, status, durationMs FROM pipelineRuns WHERE id = 660001
  `) as any;
  if (runStatus[0]) {
    console.log(`Run 660001 status: ${runStatus[0]?.status} (duration: ${runStatus[0]?.durationMs}ms)`);
  } else {
    console.log("Run 660001 not found — may have a different ID");
    // Check the most recent runs
    const [recentRuns] = await db.execute(sql`
      SELECT id, runType, status, startedAt, durationMs FROM pipelineRuns ORDER BY id DESC LIMIT 5
    `) as any;
    console.log("Recent runs:");
    for (const r of recentRuns) {
      console.log(`  [${r.id}] ${r.runType} ${r.status} started=${r.startedAt} duration=${r.durationMs}ms`);
    }
  }

  const [totalContacts] = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) as withEmail,
      SUM(CASE WHEN enrichmentStatus = 'failed' THEN 1 ELSE 0 END) as failedCount
    FROM contacts
  `) as any;
  console.log(`Contacts: total=${totalContacts[0]?.total}, withEmail=${totalContacts[0]?.withEmail}, failed=${totalContacts[0]?.failedCount}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
