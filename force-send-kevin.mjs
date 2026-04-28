/**
 * Force-send the Monday digest to Kevin Arnandes only.
 * Uses the deployed site's admin API to trigger a single-user digest send.
 * Kevin's userId = 11580001, email = kevinarnandes@gmail.com
 * Profile: NATIONAL territory, BESS + Portable Air business lines
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const KEVIN_USER_ID = 11580001;

// Step 1: Delete any existing W18 send log for Kevin so the digest can be sent
// (there are none, but being safe)
const currentWeekKey = (() => {
  const now = new Date();
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((now - startOfYear) / 86400000);
  const weekNum = Math.ceil((dayOfYear + startOfYear.getUTCDay() + 1) / 7);
  return `${now.getUTCFullYear()}W${String(weekNum).padStart(2, "0")}`;
})();
console.log(`Current week key: ${currentWeekKey}`);

// Step 2: Check Kevin's profile is correct
const [profiles] = await conn.execute(
  "SELECT * FROM userProfiles WHERE userId = ?",
  [KEVIN_USER_ID]
);
if (!profiles.length) {
  console.log("ERROR: Kevin has no profile");
  await conn.end();
  process.exit(1);
}
const profile = profiles[0];
console.log(`Kevin's profile: territories=${profile.territories}, businessLines=${profile.assignedBusinessLines}`);

// Step 3: Check if email digest is enabled for Kevin
const [users] = await conn.execute(
  "SELECT * FROM users WHERE id = ?",
  [KEVIN_USER_ID]
);
const kevin = users[0];
console.log(`Kevin: name=${kevin.name}, email=${kevin.email}, role=${kevin.role}`);

// Step 4: Check digestPreferences
const [prefs] = await conn.execute(
  "SELECT * FROM digestPreferences WHERE userId = ?",
  [KEVIN_USER_ID]
);
if (prefs.length) {
  console.log(`Digest prefs: enabled=${prefs[0].enabled}, frequency=${prefs[0].frequency}`);
} else {
  console.log("No digest preferences found — will use defaults (enabled=true)");
}

// Step 5: Check existing send log
const [existingLog] = await conn.execute(
  "SELECT * FROM userEmailSendLog WHERE userId = ? ORDER BY sentAt DESC LIMIT 5",
  [KEVIN_USER_ID]
);
console.log(`Existing send log entries: ${existingLog.length}`);

await conn.end();

// Step 6: Call the admin API to trigger a single-user digest
// The admin trigger endpoint accepts a userId parameter to send to just one user
console.log("\nTriggering digest send via admin API...");
const response = await fetch("https://compasspt.manus.space/api/trpc/digest.sendNow", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Cookie": `app_session_id=${process.env.ADMIN_SESSION_COOKIE || ""}`,
  },
  body: JSON.stringify({
    json: { userId: KEVIN_USER_ID, force: true }
  }),
});

const text = await response.text();
console.log(`Response status: ${response.status}`);
console.log(`Response: ${text.substring(0, 500)}`);
process.exit(0);
