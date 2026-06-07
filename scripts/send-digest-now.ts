/**
 * Manually trigger the Monday digest.
 * Run with: npx tsx scripts/send-digest-now.ts
 *
 * This bypasses the tRPC layer and calls sendWeeklyDigests directly.
 * The freshness gate still applies (unless force=true is passed).
 */
import { sendWeeklyDigests } from "../server/emailDigest";

const force = process.argv.includes("--force");

console.log(`\n🚀 Triggering Monday digest (force=${force})...`);
console.log(`   Time: ${new Date().toISOString()}\n`);

try {
  const result = await sendWeeklyDigests(force, false);

  if ((result as any).skipped === -1) {
    console.error("❌ Digest BLOCKED by freshness gate — pipeline data is too stale.");
    console.error("   Run with --force to bypass, or fix the pipeline first.");
    process.exit(1);
  }

  console.log("\n✅ Digest triggered successfully:");
  console.log(`   Sent:    ${result.sent ?? 0}`);
  console.log(`   Skipped: ${result.skipped ?? 0}`);
  console.log(`   Failed:  ${result.failed ?? 0}`);
  process.exit(0);
} catch (err) {
  console.error("\n❌ Digest failed with error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
