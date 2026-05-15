/**
 * One-off script: force-send Thursday reminder to Ryan Pemberton (id=2340043)
 * Run from project root: pnpm tsx scripts/force_send_ryan.mts
 */
import "dotenv/config";
import { sendThursdayReminderActualToUser } from "../server/emailDigest";

console.log("Triggering force re-send for Ryan Pemberton (id=2340043)...");
const result = await sendThursdayReminderActualToUser(2340043);
console.log("Result:", JSON.stringify(result, null, 2));
process.exit(result.sent === 1 ? 0 : 1);
