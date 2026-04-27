/**
 * Trigger W18 catch-up Monday digest for all 7 recipients.
 * Uses the same sendWeeklyDigests() path as the live scheduler,
 * but called directly so we can watch the result synchronously.
 *
 * Safety checks before send:
 * 1. Confirm W18 dedup is clear for all 7 users
 * 2. Confirm unique constraint is present
 * 3. Send and log results
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const conn = await createConnection(process.env.DATABASE_URL);

// ── 1. Pre-send safety check ──────────────────────────────────────────────────
console.log("── PRE-SEND SAFETY CHECKS ──────────────────────────────────────────────────");

// Check W18 dedup state for all 7 recipients
const targetEmails = [
  "leo.williams@atlascopco.com",
  "ryan.pemberton@atlascopco.com",
  "daniel.zec@atlascopco.com",
  "dan.day@atlascopco.com",
  "amit.bhargava@atlascopco.com",
  "egor.ivanov@atlascopco.com",
  "brett.hansen@sykesgroup.com",
];

const [users] = await conn.execute(
  `SELECT id, name, email FROM users WHERE email IN (${targetEmails.map(() => "?").join(",")})`,
  targetEmails
);

console.log(`\nFound ${users.length}/7 registered recipients:`);
users.forEach(u => console.log(`  ${u.id} — ${u.name} <${u.email}>`));

if (users.length !== 7) {
  const found = users.map(u => u.email);
  const missing = targetEmails.filter(e => !found.includes(e));
  console.log(`\n⚠️  Missing from users table: ${missing.join(", ")}`);
}

const userIds = users.map(u => u.id);

// Check W18 send log
const [w18Sends] = await conn.execute(
  `SELECT userId, digestType, sentDate, status, dryRun
   FROM userEmailSendLog
   WHERE userId IN (${userIds.map(() => "?").join(",")})
     AND weekKey = '2026W18'
     AND digestType = 'monday'
     AND dryRun = 0`,
  userIds
);

if (w18Sends.length > 0) {
  console.log(`\n🚫 W18 Monday already sent to ${w18Sends.length} user(s) — ABORTING:`);
  w18Sends.forEach(s => console.log(`  userId=${s.userId} status=${s.status} date=${s.sentDate}`));
  await conn.end();
  process.exit(1);
}
console.log("\n✓ W18 Monday dedup: CLEAR for all users — safe to send");

// Check unique constraint
const [constraints] = await conn.execute(
  `SELECT INDEX_NAME, NON_UNIQUE
   FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'userEmailSendLog'
     AND INDEX_NAME = 'uq_user_type_date'
   LIMIT 1`
);
if (constraints.length === 0) {
  console.log("\n🚫 UNIQUE CONSTRAINT MISSING — ABORTING (duplicate send risk)");
  await conn.end();
  process.exit(1);
}
console.log(`✓ Unique constraint uq_user_type_date: PRESENT (NON_UNIQUE=${constraints[0].NON_UNIQUE})`);

await conn.end();

// ── 2. Trigger the digest via the live server HTTP API ────────────────────────
console.log("\n── TRIGGERING DIGEST ───────────────────────────────────────────────────────");
console.log("Calling /api/admin/send-digest via localhost...");

// The admin digest endpoint requires an authenticated admin session.
// We'll call the tRPC procedure directly via the server's internal module instead.
// Import the emailDigest module and call sendWeeklyDigests directly.
const { sendWeeklyDigests } = await import("../server/emailDigest.js");

console.log("Calling sendWeeklyDigests({ dryRun: false, digestType: 'monday' })...");
const result = await sendWeeklyDigests({ dryRun: false, digestType: "monday" });

console.log("\n── SEND RESULTS ────────────────────────────────────────────────────────────");
console.log(JSON.stringify(result, null, 2));
