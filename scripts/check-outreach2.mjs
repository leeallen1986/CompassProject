import 'dotenv/config';
import mysql from 'mysql2/promise';
const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Check outreachEmails columns
const [cols] = await conn.execute("DESCRIBE outreachEmails");
console.log("outreachEmails columns:");
for (const c of cols) console.log(`  ${c.Field} (${c.Type})`);

// Find emails for Jamie's contact ID (150001)
const [emails] = await conn.execute("SELECT * FROM outreachEmails WHERE contactId = 150001 LIMIT 5");
console.log("\nOutreach emails for Jamie (contactId 150001):", emails.length);
for (const e of emails) {
  console.log(`  ID: ${e.id}, subject: ${e.subject?.substring(0, 80)}, status: ${e.status}`);
  if (e.body) console.log(`  Body preview: ${e.body.substring(0, 200)}...`);
}

// Check Jamie's contact status
const [jamie] = await conn.execute("SELECT id, firstName, lastName, email, outreachStatus, draftSubject FROM campaignContacts WHERE id = 150001");
console.log("\nJamie contact:", JSON.stringify(jamie[0], null, 2));

// Check all contacts with pending_approval status
const [pending] = await conn.execute("SELECT id, firstName, lastName, email, outreachStatus FROM campaignContacts WHERE campaignId = 210001 AND outreachStatus = 'pending_approval'");
console.log("\nPending approval contacts:", pending.length);
for (const p of pending) console.log(`  ${p.firstName} ${p.lastName} (${p.email}): ${p.outreachStatus}`);

await conn.end();
