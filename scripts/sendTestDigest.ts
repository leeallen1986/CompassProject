/**
 * One-off script: send Monday digest to specific users for testing.
 * Usage: npx tsx scripts/sendTestDigest.ts
 */
import "dotenv/config";
import { sendWeeklyDigests } from "../server/emailDigest";

const TARGET_USER_IDS = [1, 2340043]; // Lee Allen, Ryan Pemberton

async function main() {
  console.log(`[TestDigest] Sending Monday digest to user IDs: ${TARGET_USER_IDS.join(", ")}`);
  const result = await sendWeeklyDigests(true, TARGET_USER_IDS);
  console.log("[TestDigest] Result:", JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("[TestDigest] Error:", err);
  process.exit(1);
});
