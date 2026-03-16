import 'dotenv/config';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_URL"); process.exit(1); }

const conn = await mysql.createConnection(url);

// Check email digest preferences
const [prefs] = await conn.execute(`
  SELECT edp.id, edp.userId, edp.enabled, edp.frequency, 
         edp.includeHotOnly, edp.includeContacts, edp.includePipelineUpdates,
         edp.lastSentAt, u.name, u.email
  FROM emailDigestPrefs edp 
  LEFT JOIN users u ON edp.userId = u.id
`);
console.log("=== EMAIL DIGEST PREFS ===");
for (const p of prefs) {
  console.log(JSON.stringify(p));
}

// Count users with profiles but no digest prefs
const [noPrefs] = await conn.execute(`
  SELECT u.id, u.name, u.email 
  FROM users u 
  LEFT JOIN emailDigestPrefs edp ON u.id = edp.userId 
  WHERE edp.id IS NULL
`);
console.log("\n=== USERS WITHOUT DIGEST PREFS ===");
for (const u of noPrefs) {
  console.log(JSON.stringify(u));
}

// Count users with profiles
const [profileCount] = await conn.execute(`SELECT COUNT(*) as cnt FROM userProfiles`);
console.log("\n=== PROFILE COUNT ===");
console.log(JSON.stringify(profileCount[0]));

await conn.end();
