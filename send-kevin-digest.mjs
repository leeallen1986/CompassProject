import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Find Kevin's user record
const [users] = await conn.execute(
  "SELECT u.id, u.name, u.email, u.role, up.territories, up.assignedBusinessLines FROM users u LEFT JOIN userProfiles up ON u.id = up.userId WHERE u.email = 'kevinarnandes@gmail.com'"
);

if (!users.length) {
  console.log("ERROR: Kevin not found in users table");
  await conn.end();
  process.exit(1);
}

const kevin = users[0];
console.log("Found Kevin:");
console.log(`  ID: ${kevin.id}`);
console.log(`  Name: ${kevin.name}`);
console.log(`  Email: ${kevin.email}`);
console.log(`  Role: ${kevin.role}`);
console.log(`  Territories: ${kevin.territories}`);
console.log(`  Business Lines: ${kevin.assignedBusinessLines}`);

// Check if Kevin already has a W18 send log entry
const [sendLog] = await conn.execute(
  "SELECT * FROM userEmailSendLog WHERE userId = ? AND digestType = 'monday' ORDER BY sentAt DESC LIMIT 5",
  [kevin.id]
);
console.log(`\nExisting send log entries for Kevin: ${sendLog.length}`);
for (const s of sendLog) {
  console.log(`  weekKey=${s.weekKey} | sentAt=${new Date(s.sentAt).toISOString()} | status=${s.status}`);
}

// Check digestScheduleLog for this week
const [schedLog] = await conn.execute(
  "SELECT * FROM digestScheduleLog ORDER BY createdAt DESC LIMIT 5"
);
console.log(`\nDigest schedule log (recent):`);
for (const d of schedLog) {
  console.log(`  type=${d.digestType} | status=${d.status} | created=${new Date(d.createdAt).toISOString()}`);
}

await conn.end();
console.log("\nReady to send. Kevin's ID:", kevin.id);
process.exit(0);
