import 'dotenv/config';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: false } });

// Collateral columns
const [cols] = await conn.execute("DESCRIBE collateralItems");
console.log("Collateral columns:", cols.map(c => c.Field));

const [coll] = await conn.execute("SELECT * FROM collateralItems WHERE id = 90001");
console.log("\nCollateral 90001:", JSON.stringify(coll, null, 2));

// Sample generated emails
const [emails] = await conn.execute(`
  SELECT id, firstName, lastName, company, outreachStatus, generatedSubject, 
         SUBSTRING(generatedEmail, 1, 500) as emailPreview
  FROM campaignContacts
  WHERE campaignId = 210001 AND generatedEmail IS NOT NULL
  LIMIT 3
`);
console.log("\nSample generated emails:");
for (const e of emails) {
  console.log(`\n--- ${e.firstName} ${e.lastName} (${e.company}) ---`);
  console.log(`Subject: ${e.generatedSubject}`);
  console.log(`Body: ${e.emailPreview}`);
}

// How many have generated emails?
const [genCount] = await conn.execute(`
  SELECT COUNT(*) as cnt FROM campaignContacts 
  WHERE campaignId = 210001 AND generatedEmail IS NOT NULL
`);
console.log("\nContacts with generated emails:", genCount[0].cnt);

await conn.end();
