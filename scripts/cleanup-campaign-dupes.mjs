/**
 * Clean up duplicate contacts in Leo's CP Truck Air campaign (ID: 210001)
 * and reset the one bad XAVS1800 draft email.
 * 
 * Strategy: For each duplicate email group, keep the row with the lowest ID
 * (first imported) and delete the rest.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: false } });

const campId = 210001;

console.log("=== CP Truck Air Campaign Cleanup ===\n");

// 1. Find email-based duplicates
const [dupes] = await conn.execute(`
  SELECT email, MIN(id) as keepId, GROUP_CONCAT(id ORDER BY id) as allIds, COUNT(*) as cnt
  FROM campaignContacts 
  WHERE campaignId = ? AND email IS NOT NULL AND email != ''
  GROUP BY email 
  HAVING COUNT(*) > 1
`, [campId]);

let totalToDelete = 0;
const idsToDelete = [];

for (const d of dupes) {
  const allIds = d.allIds.split(',').map(Number);
  const keepId = d.keepId;
  const deleteIds = allIds.filter(id => id !== keepId);
  idsToDelete.push(...deleteIds);
  totalToDelete += deleteIds.length;
  console.log(`  ${d.email}: keeping #${keepId}, deleting ${deleteIds.length} dupes (${deleteIds.join(', ')})`);
}

console.log(`\nTotal duplicate rows to delete: ${totalToDelete}`);

// 2. Delete duplicates in batches
if (idsToDelete.length > 0) {
  const placeholders = idsToDelete.map(() => '?').join(',');
  const [result] = await conn.execute(
    `DELETE FROM campaignContacts WHERE id IN (${placeholders})`,
    idsToDelete
  );
  console.log(`Deleted ${result.affectedRows} duplicate rows`);
}

// 3. Reset the bad XAVS1800 draft email (Jamie Detata)
const [resetResult] = await conn.execute(`
  UPDATE campaignContacts 
  SET draftSubject = NULL, draftBody = NULL, draftKeyPoints = NULL, 
      draftTone = NULL, draftGeneratedAt = NULL, outreachStatus = 'not_started'
  WHERE campaignId = ? AND draftBody IS NOT NULL
`, [campId]);
console.log(`\nReset ${resetResult.affectedRows} bad draft email(s)`);

// 4. Update campaign stats
const [countResult] = await conn.execute(
  "SELECT COUNT(*) as cnt FROM campaignContacts WHERE campaignId = ?",
  [campId]
);
const newTotal = countResult[0].cnt;

await conn.execute(
  "UPDATE campaigns SET totalContacts = ? WHERE id = ?",
  [newTotal, campId]
);
console.log(`\nUpdated campaign totalContacts: ${newTotal}`);

// 5. Verify no more duplicates
const [verify] = await conn.execute(`
  SELECT email, COUNT(*) as cnt
  FROM campaignContacts 
  WHERE campaignId = ? AND email IS NOT NULL AND email != ''
  GROUP BY email 
  HAVING COUNT(*) > 1
`, [campId]);
console.log(`\nRemaining duplicate groups: ${verify.length}`);

console.log("\n=== Cleanup Complete ===");

await conn.end();
