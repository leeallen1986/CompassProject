/**
 * Trigger W18 catch-up Monday digest for all 7 recipients.
 * Uses force=true to bypass the freshness gate.
 * dryRun=false → real send.
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

// Pre-send safety checks via raw SQL
const conn = await createConnection(process.env.DATABASE_URL!);

const TARGET_EMAILS = [
  "leo.williams@atlascopco.com",
  "ryan.pemberton@atlascopco.com",
  "daniel.zec@atlascopco.com",
  "dan.day@atlascopco.com",
  "amit.bhargava@atlascopco.com",
  "egor.ivanov@atlascopco.com",
  "brett.hansen@sykesgroup.com",
];

console.log("═".repeat(80));
console.log("W18 CATCH-UP MONDAY DIGEST — PRE-SEND SAFETY CHECKS");
console.log("═".repeat(80));

// 1. Find all 7 users
const placeholders = TARGET_EMAILS.map(() => "?").join(",");
const [userRows] = await conn.execute(
  `SELECT id, name, email FROM users WHERE email IN (${placeholders})`,
  TARGET_EMAILS
) as any[];

console.log(`\nFound ${userRows.length}/7 recipients:`);
userRows.forEach((u: any) => console.log(`  ${u.id} — ${u.name} <${u.email}>`));

if (userRows.length < 7) {
  const found = userRows.map((u: any) => u.email);
  const missing = TARGET_EMAILS.filter(e => !found.includes(e));
  console.log(`\n⚠ Missing: ${missing.join(", ")}`);
}

const userIds = userRows.map((u: any) => u.id);

// 2. Check W18 dedup
const idPlaceholders = userIds.map(() => "?").join(",");
const [w18Sends] = await conn.execute(
  `SELECT userId, status FROM userEmailSendLog
   WHERE userId IN (${idPlaceholders})
     AND weekKey = '2026W18'
     AND digestType = 'monday'
     AND dryRun = 0`,
  userIds
) as any[];

if (w18Sends.length > 0) {
  console.log(`\n🚫 W18 Monday already sent to ${w18Sends.length} user(s) — ABORTING`);
  w18Sends.forEach((s: any) => console.log(`  userId=${s.userId} status=${s.status}`));
  await conn.end();
  process.exit(1);
}
console.log("\n✓ W18 Monday dedup: CLEAR — safe to send");

// 3. Check unique constraint
const [constraints] = await conn.execute(
  `SELECT INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'userEmailSendLog'
     AND INDEX_NAME = 'uq_user_type_date'
   LIMIT 1`
) as any[];

if (constraints.length === 0) {
  console.log("\n🚫 UNIQUE CONSTRAINT MISSING — ABORTING");
  await conn.end();
  process.exit(1);
}
console.log(`✓ Unique constraint uq_user_type_date: PRESENT`);
await conn.end();

// 4. Trigger the digest
console.log("\n═".repeat(80));
console.log("TRIGGERING SEND — force=true, dryRun=false");
console.log("═".repeat(80));

const { sendWeeklyDigests } = await import("../server/emailDigest.js");
const result = await sendWeeklyDigests(true, false);

console.log("\n── SEND RESULTS ──────────────────────────────────────────────────────────────");
console.log(`  Sent:         ${result.sent}`);
console.log(`  Failed:       ${result.failed}`);
console.log(`  Skipped:      ${result.skipped}`);
console.log(`  Already sent: ${result.alreadySent}`);

// 5. Post-send: verify W18 send log entries
const conn2 = await createConnection(process.env.DATABASE_URL!);
const [postSends] = await conn2.execute(
  `SELECT l.userId, u.name, l.status, l.sentAt
   FROM userEmailSendLog l
   JOIN users u ON u.id = l.userId
   WHERE l.userId IN (${userIds.map(() => "?").join(",")})
     AND l.weekKey = '2026W18'
     AND l.digestType = 'monday'
     AND l.dryRun = 0`,
  userIds
) as any[];

console.log(`\n── POST-SEND LOG (${postSends.length} entries written) ─────────────────────────────`);
postSends.forEach((s: any) => {
  const ts = s.sentAt ? new Date(s.sentAt).toISOString() : "—";
  console.log(`  ${s.name}: ${s.status} at ${ts}`);
});

if (postSends.length === userRows.length) {
  console.log(`\n✓ All ${userRows.length} send log entries confirmed`);
} else {
  console.log(`\n⚠ Only ${postSends.length}/${userRows.length} log entries found — check for failures`);
}

await conn2.end();
process.exit(0);
