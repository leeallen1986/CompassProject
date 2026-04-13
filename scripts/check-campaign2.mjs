import 'dotenv/config';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: false } });

// Find the correct collateral table name
const [tables] = await conn.execute("SHOW TABLES LIKE '%collateral%'");
console.log("Collateral tables:", tables);

// Check duplicate contacts in Leo's campaign (id=210001)
const campId = 210001;

const [dupes] = await conn.execute(`
  SELECT email, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
  FROM campaign_contacts 
  WHERE campaign_id = ? AND email IS NOT NULL AND email != ''
  GROUP BY email 
  HAVING COUNT(*) > 1
  ORDER BY cnt DESC
  LIMIT 30
`, [campId]);
console.log("\nDuplicate emails (top 30):", JSON.stringify(dupes, null, 2));
console.log("Total duplicate email groups:", dupes.length);

// Name-based duplicates
const [nameDupes] = await conn.execute(`
  SELECT CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,'')) as full_name, 
         company, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
  FROM campaign_contacts 
  WHERE campaign_id = ?
  GROUP BY CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,'')), company
  HAVING COUNT(*) > 1
  ORDER BY cnt DESC
  LIMIT 30
`, [campId]);
console.log("\nDuplicate names (same company, top 30):", JSON.stringify(nameDupes, null, 2));
console.log("Total name duplicate groups:", nameDupes.length);

// Total contacts
const [total] = await conn.execute("SELECT COUNT(*) as cnt FROM campaign_contacts WHERE campaign_id = ?", [campId]);
console.log("\nTotal contacts:", total[0].cnt);

// Check a sample outreach email to see what product it references
const [emails] = await conn.execute(`
  SELECT cc.id, cc.first_name, cc.last_name, cc.company, cc.outreach_status, cc.generated_subject, cc.generated_email
  FROM campaign_contacts cc
  WHERE cc.campaign_id = ? AND cc.generated_email IS NOT NULL
  LIMIT 3
`, [campId]);
console.log("\nSample generated emails:", JSON.stringify(emails.map(e => ({
  id: e.id,
  name: `${e.first_name} ${e.last_name}`,
  company: e.company,
  subject: e.generated_subject,
  emailPreview: e.generated_email ? e.generated_email.substring(0, 300) : null
})), null, 2));

await conn.end();
