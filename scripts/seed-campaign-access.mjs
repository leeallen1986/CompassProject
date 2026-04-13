import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Grant campaign access to:
// 1. ryan.pemberton@atlascopco.com (was in hardcoded list)
// 2. leo.williams@atlascopco.com (was in hardcoded list)
// 3. tim.oneil-shaw@atlascopco.com (newly requested)
// 4. All admins also get campaign access by default
const emails = [
  'ryan.pemberton@atlascopco.com',
  'leo.williams@atlascopco.com',
  'tim.oneil-shaw@atlascopco.com',
];

for (const email of emails) {
  const [result] = await conn.execute(
    "UPDATE users SET campaignAccess = 1 WHERE email = ?",
    [email]
  );
  console.log(`Set campaignAccess=true for ${email}: ${result.affectedRows} row(s) updated`);
}

// Verify
const [rows] = await conn.execute("SELECT id, name, email, role, campaignAccess FROM users ORDER BY id");
console.log("\nAll users after update:");
for (const row of rows) {
  console.log(`  ${row.name} (${row.email}) - role: ${row.role}, campaignAccess: ${row.campaignAccess}`);
}

await conn.end();
