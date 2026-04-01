import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Move irrelevant corporate decision maker titles to Warm
  const [r1] = await conn.execute(`
    UPDATE campaignContacts 
    SET tier = 'tier2_warm'
    WHERE tier = 'tier1_hot' 
      AND enrichmentSource_cc = 'hunter'
      AND sourceRow IS NULL
      AND titleRelevance = 'decision_maker'
      AND (
        title LIKE '%Finance%' OR title LIKE '%HR %' OR title LIKE '%Human Resource%'
        OR title LIKE '%Marketing%' OR title LIKE '%Communications%' OR title LIKE '%Legal%'
        OR title LIKE '%Tax%' OR title LIKE '%Public Affairs%' OR title LIKE '%Non-Executive%'
        OR title LIKE '%Training%' OR title LIKE '%Payroll%' OR title LIKE '%Accounting%'
        OR title LIKE '%Research and Development%' OR title LIKE '%Customer Experience%'
        OR title LIKE '%Digital%' OR title LIKE 'IT %' OR title LIKE '%Information Technology%'
        OR title LIKE '%Compliance%' OR title LIKE '%Audit%' OR title LIKE '%Risk%'
        OR title LIKE '%Logistics%' OR title LIKE '%HSEQ%'
      )
  `);
  console.log('Moved irrelevant corporate roles to Warm:', r1.affectedRows);

  // Final stats
  const [hotStats] = await conn.execute(`
    SELECT titleRelevance, COUNT(*) as cnt 
    FROM campaignContacts WHERE tier = 'tier1_hot'
    GROUP BY titleRelevance ORDER BY cnt DESC
  `);
  console.log('\nFinal Hot tier by role:');
  for (const r of hotStats) console.log('  ' + r.titleRelevance + ': ' + r.cnt);

  const [totalHot] = await conn.execute('SELECT COUNT(*) as cnt FROM campaignContacts WHERE tier = "tier1_hot"');
  const [totalWarm] = await conn.execute('SELECT COUNT(*) as cnt FROM campaignContacts WHERE tier = "tier2_warm"');
  const [totalAll] = await conn.execute('SELECT COUNT(*) as cnt FROM campaignContacts WHERE campaignId = 1');
  console.log('\nTotal Hot:', totalHot[0].cnt);
  console.log('Total Warm:', totalWarm[0].cnt);
  console.log('Total All:', totalAll[0].cnt);

  // Show remaining Hot decision maker titles
  const [remaining] = await conn.execute(`
    SELECT title, COUNT(*) as cnt 
    FROM campaignContacts 
    WHERE tier = 'tier1_hot' AND enrichmentSource_cc = 'hunter' AND titleRelevance = 'decision_maker'
    GROUP BY title ORDER BY cnt DESC LIMIT 15
  `);
  console.log('\nRemaining Hot decision maker titles:');
  for (const r of remaining) console.log('  ' + (r.title || 'NULL') + ': ' + r.cnt);

  // Enrichment summary
  const [enrichStats] = await conn.execute(`
    SELECT enrichmentSource_cc, hunterVerificationStatus, COUNT(*) as cnt
    FROM campaignContacts WHERE tier = 'tier1_hot' AND enrichmentStatus = 'enriched'
    GROUP BY enrichmentSource_cc, hunterVerificationStatus ORDER BY cnt DESC
  `);
  console.log('\nHot enrichment breakdown:');
  for (const r of enrichStats) console.log('  ' + (r.enrichmentSource_cc||'none') + ' / ' + (r.hunterVerificationStatus||'n/a') + ': ' + r.cnt);

  await conn.end();
  console.log('\nDone!');
}
main().catch(console.error);
