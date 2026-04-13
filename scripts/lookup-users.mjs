import 'dotenv/config';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
console.log("Connecting...");

try {
  const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: false } });
  const [rows] = await conn.execute("SELECT id, name, email, role, campaignAccess FROM users ORDER BY id");
  console.log("All users:", JSON.stringify(rows, null, 2));
  await conn.end();
} catch(e) {
  console.error("Error:", e.message);
}
