/**
 * ryanFreshPreview.ts
 * Runs a fresh dry-run preview for Ryan using the LIVE digest assembly path.
 * This shows exactly what his next Monday digest would contain with the new gate.
 *
 * Run: npx tsx scripts/ryanFreshPreview.ts
 */
import "dotenv/config";
import { sendWeeklyDigestsForUser } from "../server/emailDigest";
import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL!);

// Find Ryan's user ID
const [ryanRows] = await conn.execute<any[]>(
  `SELECT u.id, u.name, u.email
   FROM users u
   JOIN userProfiles up ON up.userId = u.id
   WHERE u.name LIKE '%Ryan%' OR u.email LIKE '%ryan%'
   LIMIT 1`
);
const ryan = ryanRows[0];
await conn.end();

if (!ryan) {
  console.error("Ryan not found");
  process.exit(1);
}

console.log(`\n=== Running fresh dry-run preview for Ryan (id=${ryan.id}, email=${ryan.email}) ===\n`);

try {
  const result = await sendWeeklyDigestsForUser(ryan.id);
  console.log("\n=== Preview Result ===");
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error("Preview failed:", err);
  process.exit(1);
}
