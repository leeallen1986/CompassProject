import { sendWeeklyDigests } from "../emailDigest.js";

async function main() {
  console.log(`[${new Date().toISOString()}] Triggering Monday digest send (admin approved)...`);
  const result = await sendWeeklyDigests(false, false);
  console.log(`[${new Date().toISOString()}] DONE — sent: ${result.sent}, failed: ${result.failed}, skipped: ${result.skipped}, alreadySent: ${result.alreadySent}`);
  process.exit(0);
}

main().catch(err => {
  console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
