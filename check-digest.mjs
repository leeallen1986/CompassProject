import 'dotenv/config';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_URL"); process.exit(1); }

const conn = await mysql.createConnection(url);

// Check email digest preferences
const [prefs] = await conn.execute(`
  SELECT edp.id, edp.userId, edp.enabled, edp.frequency, 
         edp.includeHotOnly, edp.includeContacts, edp.includePipelineUpdates,
         edp.lastSentAt, u.name, u.email, u.role
  FROM emailDigestPrefs edp 
  LEFT JOIN users u ON edp.userId = u.id
`);
console.log("\n=== Email Digest Preferences ===");
console.table(prefs);

// Check user profiles (territories, industries)
const [profiles] = await conn.execute(`
  SELECT up.userId, u.name, up.territories, up.industries, up.offerCategories
  FROM userProfiles up
  LEFT JOIN users u ON up.userId = u.id
`);
console.log("\n=== User Profiles ===");
console.table(profiles);

// Check all users
const [users] = await conn.execute(`SELECT id, name, email, role, createdAt FROM users ORDER BY id`);
console.log("\n=== All Users ===");
console.table(users);

// Check latest report
const [reports] = await conn.execute(`SELECT id, weekEnding, createdAt FROM reports ORDER BY id DESC LIMIT 3`);
console.log("\n=== Latest Reports ===");
console.table(reports);

await conn.end();
