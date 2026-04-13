import 'dotenv/config';
import mysql from 'mysql2/promise';
const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Check outreachEmails table for this campaign
const [emails] = await conn.execute("SELECT * FROM outreachEmails WHERE campaignId = 210001 LIMIT 10");
console.log("Outreach emails for campaign 210001:", emails.length);
for (const e of emails) {
  console.log(`  ID: ${e.id}, contactId: ${e.contactId}, subject: ${e.subject?.substring(0, 80)}, status: ${e.status}`);
}

// Check if Jamie Detata's contact has any special status
const [jamie] = await conn.execute("SELECT id, firstName, lastName, email, outreachStatus, draftSubject FROM campaignContacts WHERE campaignId = 210001 AND email = 'jdetata@orh.net.au'");
console.log("\nJamie Detata contact:", JSON.stringify(jamie[0], null, 2));

// Check contacts with non-not_started outreach status
const [active] = await conn.execute("SELECT id, firstName, lastName, email, outreachStatus, draftSubject FROM campaignContacts WHERE campaignId = 210001 AND outreachStatus != 'not_started'");
console.log("\nContacts with active outreach:", active.length);
for (const a of active) {
  console.log(`  ${a.firstName} ${a.lastName}: ${a.outreachStatus}, subject: ${a.draftSubject?.substring(0, 60) || 'none'}`);
}

await conn.end();
