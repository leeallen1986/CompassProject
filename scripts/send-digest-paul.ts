/**
 * Send the Monday digest to Paul Lueth only.
 * Uses sendWeeklyDigestToUser with forceOverride=true to bypass the
 * per-user weekly dedup guard (since this week's digest wasn't logged as sent for him).
 */
import { sendWeeklyDigestToUser } from "../server/emailDigest";

// Paul Lueth's user ID — confirmed from DB
const PAUL_USER_ID = 7; // will be resolved dynamically below

import { getDb } from "../server/db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const db = await getDb();
if (!db) {
  console.error("❌ Could not connect to database");
  process.exit(1);
}

const paul = await db.select().from(users).where(eq(users.email, "paul.lueth@atlascopco.com")).limit(1);

if (!paul.length) {
  console.error("❌ Paul Lueth not found in users table");
  process.exit(1);
}

const paulId = paul[0].id;
console.log(`\n🚀 Sending Monday digest to Paul Lueth (userId=${paulId})...`);
console.log(`   Email: ${paul[0].email}`);
console.log(`   Time: ${new Date().toISOString()}\n`);

try {
  // forceOverride=true bypasses the per-user weekly dedup guard
  const result = await sendWeeklyDigestToUser(paulId, true);
  console.log("\n✅ Result:", JSON.stringify(result, null, 2));
  process.exit(0);
} catch (err) {
  console.error("\n❌ Failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
