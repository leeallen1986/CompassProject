import 'dotenv/config';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: false } });

// Check Leo's campaigns
const [campaigns] = await conn.execute("SELECT id, name, collateralId, collateralName, status, totalContacts FROM campaigns WHERE createdBy = 840008 ORDER BY id DESC");
console.log("Leo's campaigns:", JSON.stringify(campaigns, null, 2));

// Check collateral items
if (campaigns.length > 0) {
  const collId = campaigns[0].collateralId;
  if (collId) {
    const [coll] = await conn.execute("SELECT id, name, description, category FROM collateral_items WHERE id = ?", [collId]);
    console.log("Collateral:", JSON.stringify(coll, null, 2));
  }
}

// Check duplicate contacts in the campaign
if (campaigns.length > 0) {
  const campId = campaigns[0].id;
  const [dupes] = await conn.execute(`
    SELECT email, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
    FROM campaign_contacts 
    WHERE campaign_id = ? AND email IS NOT NULL AND email != ''
    GROUP BY email 
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 20
  `, [campId]);
  console.log("\nDuplicate emails:", JSON.stringify(dupes, null, 2));
  
  // Also check name-based duplicates
  const [nameDupes] = await conn.execute(`
    SELECT CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,'')) as full_name, 
           company, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
    FROM campaign_contacts 
    WHERE campaign_id = ?
    GROUP BY CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,'')), company
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 20
  `, [campId]);
  console.log("\nDuplicate names (same company):", JSON.stringify(nameDupes, null, 2));
  
  // Total contacts
  const [total] = await conn.execute("SELECT COUNT(*) as cnt FROM campaign_contacts WHERE campaign_id = ?", [campId]);
  console.log("\nTotal contacts:", total[0].cnt);
}

await conn.end();
