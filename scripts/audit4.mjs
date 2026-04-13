import 'dotenv/config';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: false } });

// Sample draft emails
const [emails] = await conn.execute(`
  SELECT id, firstName, lastName, company, outreachStatus, draftSubject, 
         SUBSTRING(draftBody, 1, 500) as bodyPreview
  FROM campaignContacts
  WHERE campaignId = 210001 AND draftBody IS NOT NULL
  LIMIT 3
`);
console.log("Sample draft emails:");
for (const e of emails) {
  console.log(`\n--- ${e.firstName} ${e.lastName} (${e.company}) [${e.outreachStatus}] ---`);
  console.log(`Subject: ${e.draftSubject}`);
  console.log(`Body: ${e.bodyPreview}`);
}

// Count with drafts
const [draftCount] = await conn.execute(`
  SELECT COUNT(*) as cnt FROM campaignContacts 
  WHERE campaignId = 210001 AND draftBody IS NOT NULL
`);
console.log("\nContacts with draft emails:", draftCount[0].cnt);

// Check outreach emails table too
const [oeCount] = await conn.execute(`
  SELECT COUNT(*) as cnt FROM outreachEmails
  WHERE campaignContactId IN (SELECT id FROM campaignContacts WHERE campaignId = 210001)
`);
console.log("Outreach emails in outreachEmails table:", oeCount[0].cnt);

// Sample from outreachEmails
const [oeEmails] = await conn.execute(`
  SELECT oe.id, oe.subject, SUBSTRING(oe.body, 1, 500) as bodyPreview, 
         cc.firstName, cc.lastName, cc.company
  FROM outreachEmails oe
  JOIN campaignContacts cc ON oe.campaignContactId = cc.id
  WHERE cc.campaignId = 210001
  LIMIT 3
`);
console.log("\nSample outreach emails:");
for (const e of oeEmails) {
  console.log(`\n--- ${e.firstName} ${e.lastName} (${e.company}) ---`);
  console.log(`Subject: ${e.subject}`);
  console.log(`Body: ${e.bodyPreview}`);
}

await conn.end();
