/**
 * WA Digest Dry-Run
 * Calls sendWeeklyDigests(force=false, dryRun=true) to preview digest content
 * without sending any emails. Reports threshold pass/fail per user.
 */
import { sendWeeklyDigests } from './server/emailDigest';
import { checkTerritoryThreshold } from './server/emailDigest';
import { getDb } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('===== WA DIGEST DRY-RUN =====');
  console.log('Running sendWeeklyDigests(force=false, dryRun=true)...\n');

  const results = await sendWeeklyDigests(false, true);

  console.log('\n===== DRY-RUN RESULTS =====');
  console.log(`Total users processed: ${results.total}`);
  console.log(`Sent (dry-run): ${results.sent}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log(`Errors: ${results.errors}`);

  if (results.details && results.details.length > 0) {
    console.log('\n--- Per-User Details ---');
    for (const d of results.details) {
      console.log(`\nUser: ${d.userName || d.userId}`);
      console.log(`  Status: ${d.status}`);
      if (d.reason) console.log(`  Reason: ${d.reason}`);
      if (d.subject) console.log(`  Subject: ${d.subject}`);
      if (d.contentLength) console.log(`  Content length: ${d.contentLength} chars`);
      if (d.projectCount !== undefined) console.log(`  Projects in digest: ${d.projectCount}`);
      if (d.thresholdResult) {
        console.log(`  Threshold: ${d.thresholdResult.passes ? 'PASSED' : 'FAILED'} — ${d.thresholdResult.reason}`);
        console.log(`  Qualifying count: ${d.thresholdResult.qualifyingCount}`);
        console.log(`  Digest-safe project IDs: ${d.thresholdResult.digestSafeProjectIds?.join(', ')}`);
      }
    }
  }

  // Also check current gate summary
  const db = await getDb();
  if (db) {
    console.log('\n===== GATE SUMMARY =====');
    const gateRows = await db.execute(sql`
      SELECT pvg.projectId, pvg.digestSafe, pvg.primaryAcceptable, p.name, p.projectState, p.location,
             (SELECT COUNT(*) FROM contacts c JOIN contactProjects cp ON cp.contactId = c.id
              WHERE cp.projectId = p.id AND c.contactTrustTier = 'send_ready') as sendReadyCount
      FROM projectValidationGates pvg
      JOIN projects p ON p.id = pvg.projectId
      WHERE pvg.digestSafe = 1
      ORDER BY pvg.gateSetAt DESC
    `);
    const gates = (gateRows as any)[0] as any[];
    console.log(`Digest-safe projects: ${gates.length}`);
    for (const g of gates) {
      console.log(`  [${g.projectId}] ${g.name} | ${g.projectState} | ${g.location} | send_ready: ${g.sendReadyCount}`);
    }
    console.log(`\nThreshold (3 required): ${gates.length >= 3 ? 'MET ✓' : 'NOT MET ✗'}`);
  }

  process.exit(0);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
