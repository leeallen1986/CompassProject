/**
 * runQueueBatch.ts
 * Run via: npx tsx server/scripts/runQueueBatch.ts
 * Runs one batch of 50 projects through the discovery queue and prints results.
 */
import { processDiscoveryQueue } from "../discoveryQueue";
import { getDb } from "../db";

async function getStats() {
  const db = await getDb();
  if (!db) return null;
  const [[contacts]] = await db.execute(`
    SELECT
      SUM(contactTrustTier = 'send_ready') as send_ready,
      SUM(contactTrustTier = 'named_unverified') as named_unverified,
      SUM(contactTrustTier = 'named_unverified' AND email IS NOT NULL AND (crmOrphan = 0 OR crmOrphan IS NULL)) as unverified_with_email
    FROM contacts
    WHERE crmOrphan = 0 OR crmOrphan IS NULL
  `) as any;
  const [[projects]] = await db.execute(`
    SELECT
      SUM(discoveryStatus = 'discovery_queued') as queued,
      SUM(discoveryStatus = 'send_ready_contact') as send_ready_projects,
      SUM(discoveryStatus = 'named_contact_no_email') as named_no_email_projects,
      SUM(discoveryStatus = 'discovery_running') as running
    FROM projects
    WHERE lifecycleStatus = 'active' OR lifecycleStatus IS NULL
  `) as any;
  return { contacts, projects };
}

(async () => {
  console.log("=== DISCOVERY QUEUE BATCH ===");
  
  const before = await getStats();
  console.log("\n[BEFORE]");
  console.log(`  send_ready contacts: ${before?.contacts.send_ready}`);
  console.log(`  named_unverified with email: ${before?.contacts.unverified_with_email}`);
  console.log(`  queued projects: ${before?.projects.queued}`);
  console.log(`  send_ready projects: ${before?.projects.send_ready_projects}`);

  console.log("\n[RUNNING] Processing up to 50 projects...");
  const start = Date.now();
  const result = await processDiscoveryQueue({ maxBatch: 50 });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n[BATCH RESULT] ${elapsed}s`);
  console.log(`  Processed: ${result.processed}`);
  console.log(`  Priority A: ${result.priorityA} | B: ${result.priorityB} | C: ${result.priorityC}`);
  console.log(`  → send_ready: +${result.newSendReady}`);
  console.log(`  → named_no_email: +${result.newNamedNoEmail}`);
  console.log(`  → role_only: +${result.newRoleOnly}`);
  console.log(`  → blocked: ${result.blocked}`);
  console.log(`  → failed: ${result.failed}`);

  const after = await getStats();
  console.log("\n[AFTER]");
  console.log(`  send_ready contacts: ${before?.contacts.send_ready} → ${after?.contacts.send_ready} (+${Number(after?.contacts.send_ready) - Number(before?.contacts.send_ready)})`);
  console.log(`  named_unverified with email: ${before?.contacts.unverified_with_email} → ${after?.contacts.unverified_with_email}`);
  console.log(`  queued projects: ${before?.projects.queued} → ${after?.projects.queued}`);
  console.log(`  send_ready projects: ${before?.projects.send_ready_projects} → ${after?.projects.send_ready_projects} (+${Number(after?.projects.send_ready_projects) - Number(before?.projects.send_ready_projects)})`);

  process.exit(0);
})().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
