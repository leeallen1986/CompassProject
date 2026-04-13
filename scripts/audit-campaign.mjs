import 'dotenv/config';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: false } });

const campId = 210001;

// 1. Duplicate emails
const [dupes] = await conn.execute(`
  SELECT email, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
  FROM campaignContacts 
  WHERE campaignId = ? AND email IS NOT NULL AND email != ''
  GROUP BY email 
  HAVING COUNT(*) > 1
  ORDER BY cnt DESC
  LIMIT 30
`, [campId]);
console.log("Duplicate emails (top 30):", JSON.stringify(dupes, null, 2));
console.log("Total duplicate email groups:", dupes.length);

// 2. Name+company duplicates
const [nameDupes] = await conn.execute(`
  SELECT CONCAT(COALESCE(firstName,''), ' ', COALESCE(lastName,'')) as fullName, 
         company, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
  FROM campaignContacts 
  WHERE campaignId = ?
  GROUP BY CONCAT(COALESCE(firstName,''), ' ', COALESCE(lastName,'')), company
  HAVING COUNT(*) > 1
  ORDER BY cnt DESC
  LIMIT 30
`, [campId]);
console.log("\nDuplicate names (same company, top 30):", JSON.stringify(nameDupes, null, 2));
console.log("Total name duplicate groups:", nameDupes.length);

// 3. Total contacts
const [total] = await conn.execute("SELECT COUNT(*) as cnt FROM campaignContacts WHERE campaignId = ?", [campId]);
console.log("\nTotal contacts:", total[0].cnt);

// 4. Collateral info
const [coll] = await conn.execute("SELECT id, name, description, category FROM collateralItems WHERE id = 90001");
console.log("\nCollateral:", JSON.stringify(coll, null, 2));

// 5. Sample generated emails
const [emails] = await conn.execute(`
  SELECT id, firstName, lastName, company, outreachStatus, generatedSubject, generatedEmail
  FROM campaignContacts
  WHERE campaignId = ? AND generatedEmail IS NOT NULL
  LIMIT 3
`, [campId]);
console.log("\nSample generated emails:");
for (const e of emails) {
  console.log(`  ${e.firstName} ${e.lastName} (${e.company})`);
  console.log(`  Subject: ${e.generatedSubject}`);
  console.log(`  Preview: ${(e.generatedEmail || '').substring(0, 400)}`);
  console.log("---");
}

await conn.end();
