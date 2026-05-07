/**
 * runQueueUntilEmpty.ts
 * Runs the discovery queue in batches until no projects remain queued.
 * Resets stuck projects between batches.
 * Run via: npx tsx server/scripts/runQueueUntilEmpty.ts
 */
import { processDiscoveryQueue } from "../discoveryQueue";
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

async function getStats() {
  const raw = await mysql.createConnection(process.env.DATABASE_URL!);
  const [[c]] = await raw.execute(
    'SELECT SUM(contactTrustTier="send_ready") as sr FROM contacts WHERE crmOrphan=0 OR crmOrphan IS NULL'
  ) as any;
  const [[p]] = await raw.execute(
    'SELECT SUM(discoveryStatus="send_ready_contact") as srp, SUM(discoveryStatus="discovery_queued") as q, SUM(discoveryStatus="discovery_running") as r FROM projects WHERE lifecycleStatus="active" OR lifecycleStatus IS NULL'
  ) as any;
  await raw.end();
  return { sr: Number(c.sr), srp: Number(p.srp), q: Number(p.q), r: Number(p.r) };
}

async function resetStuck() {
  const raw = await mysql.createConnection(process.env.DATABASE_URL!);
  const [result] = await raw.execute(
    'UPDATE projects SET discoveryStatus="discovery_queued", lastDiscoveryAt=NULL WHERE discoveryStatus="discovery_running"'
  ) as any;
  await raw.end();
  return result.affectedRows ?? 0;
}

async function main() {
  let batchNum = 0;
  const startTime = Date.now();
  const startStats = await getStats();
  console.log(`\n=== QUEUE RUNNER START ===`);
  console.log(`Initial: queued=${startStats.q}, send_ready=${startStats.sr}`);

  while (true) {
    batchNum++;

    const stuck = await resetStuck();
    if (stuck > 0) console.log(`[Batch ${batchNum}] Reset ${stuck} stuck projects`);

    const before = await getStats();
    console.log(`\n[Batch ${batchNum}] START — queued: ${before.q}, send_ready: ${before.sr}`);

    if (before.q === 0) {
      console.log(`[Batch ${batchNum}] Queue empty — done!`);
      break;
    }

    try {
      const result = await processDiscoveryQueue({ maxBatch: 10 });
      console.log(
        `[Batch ${batchNum}] DONE — processed: ${result.processed}, newSendReady: ${result.newSendReady}, failed: ${result.failed}`
      );
    } catch (err) {
      console.error(`[Batch ${batchNum}] ERROR:`, (err as Error).message);
    }

    const after = await getStats();
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(
      `[Batch ${batchNum}] AFTER — queued: ${after.q}, send_ready: ${after.sr} (+${after.sr - before.sr}), elapsed: ${elapsed}s`
    );

    // Exit after one batch — shell script handles the loop with hard timeout per run
    break;
  }

  const final = await getStats();
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n=== FINAL RESULTS ===`);
  console.log(`send_ready contacts: ${final.sr} (was ${startStats.sr}, +${final.sr - startStats.sr})`);
  console.log(`send_ready projects: ${final.srp}`);
  console.log(`queued remaining: ${final.q}`);
  console.log(`total elapsed: ${elapsed}s`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
