import "dotenv/config";
import { sendWeeklyDigests } from "./server/emailDigest.ts";

console.log("[SendDigest] Triggering Monday digest for all users...");

try {
  const result = await sendWeeklyDigests(true);
  console.log("[SendDigest] Done!", JSON.stringify(result, null, 2));
} catch (err) {
  console.error("[SendDigest] Failed:", err);
}

process.exit(0);
