import mysql2 from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql2.createConnection(process.env.DATABASE_URL);

// Find the X1350 campaign
const [campaigns] = await conn.query(`SELECT id, name, status, collateral, createdAt FROM campaigns WHERE name LIKE '%X1350%' OR collateral LIKE '%X1350%'`);
console.log('=== X1350 Campaigns ===');
console.log(JSON.stringify(campaigns, null, 2));

if (campaigns.length > 0) {
  const cid = campaigns[0].id;
  // Count contacts
  const [counts] = await conn.query(`SELECT COUNT(*) as total, enrichmentStatus, nameCheckStatus FROM campaign_contacts WHERE campaignId = ? GROUP BY enrichmentStatus, nameCheckStatus`, [cid]);
  console.log('\n=== Contact Counts by Status ===');
  console.log(JSON.stringify(counts, null, 2));
  
  // Sample contacts
  const [samples] = await conn.query(`SELECT id, firstName, lastName, email, company, title, enrichmentStatus, reviewNotes FROM campaign_contacts WHERE campaignId = ? LIMIT 10`, [cid]);
  console.log('\n=== Sample Contacts ===');
  console.log(JSON.stringify(samples, null, 2));
}

// Also check all campaigns
const [allCampaigns] = await conn.query(`SELECT id, name, status, collateral, createdAt FROM campaigns ORDER BY createdAt DESC`);
console.log('\n=== All Campaigns ===');
console.log(JSON.stringify(allCampaigns, null, 2));

await conn.end();
