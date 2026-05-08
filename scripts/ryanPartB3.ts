import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  // Check article status column
  const [statusStats]: any = await conn.query(`
    SELECT status, COUNT(*) as cnt FROM rawArticles GROUP BY status
  `);
  console.log('=== ARTICLE STATUS BREAKDOWN ===');
  for (const s of statusStats) {
    console.log(`  ${s.status || 'null'}: ${s.cnt}`);
  }

  // Check how many queued articles exist
  const [queued]: any = await conn.query(`
    SELECT COUNT(*) as cnt FROM rawArticles WHERE status = 'queued'
  `);
  console.log(`\nQueued for extraction: ${queued[0].cnt}`);

  // Specialty-air keyword articles
  const [specialtyArticles]: any = await conn.query(`
    SELECT COUNT(*) as cnt FROM rawArticles 
    WHERE (LOWER(title) LIKE '%nitrogen%' OR LOWER(title) LIKE '%purging%' OR LOWER(title) LIKE '%inerting%'
      OR LOWER(title) LIKE '%pipeline test%' OR LOWER(title) LIKE '%commissioning%' OR LOWER(title) LIKE '%lng%'
      OR LOWER(title) LIKE '%fpso%' OR LOWER(title) LIKE '%booster%' OR LOWER(title) LIKE '%pre-commission%'
      OR LOWER(title) LIKE '%barossa%' OR LOWER(title) LIKE '%scarborough%' OR LOWER(title) LIKE '%ichthys%'
      OR LOWER(title) LIKE '%pluto%' OR LOWER(title) LIKE '%gorgon%' OR LOWER(title) LIKE '%prelude%')
  `);
  console.log(`\nSpecialty-air/LNG keyword articles (all time): ${specialtyArticles[0].cnt}`);

  // Show sample specialty articles
  const [samples]: any = await conn.query(`
    SELECT id, title, status, sourceId, createdAt FROM rawArticles 
    WHERE (LOWER(title) LIKE '%nitrogen%' OR LOWER(title) LIKE '%purging%' OR LOWER(title) LIKE '%inerting%'
      OR LOWER(title) LIKE '%pipeline test%' OR LOWER(title) LIKE '%lng%'
      OR LOWER(title) LIKE '%fpso%' OR LOWER(title) LIKE '%barossa%' OR LOWER(title) LIKE '%scarborough%'
      OR LOWER(title) LIKE '%pluto%' OR LOWER(title) LIKE '%gorgon%' OR LOWER(title) LIKE '%prelude%')
    ORDER BY createdAt DESC
    LIMIT 20
  `);
  console.log('\n=== RECENT SPECIALTY-AIR ARTICLES ===');
  for (const a of samples) {
    console.log(`  [${a.id}] ${a.status} | ${a.title.slice(0, 80)}`);
  }

  // Check Energy News Bulletin status
  const [enb]: any = await conn.query(`
    SELECT id, name, isActive, totalArticles, lastSuccessAt FROM rssSources WHERE name LIKE '%Energy News%'
  `);
  console.log('\n=== ENERGY NEWS BULLETIN STATUS ===');
  for (const e of enb) {
    console.log(`  id=${e.id}, active=${e.isActive}, articles=${e.totalArticles}, lastSuccess=${e.lastSuccessAt}`);
  }

  // Check tender-related tables
  const [tenderTables]: any = await conn.query("SHOW TABLES LIKE '%tender%'");
  console.log('\n=== TENDER-RELATED TABLES ===');
  for (const t of tenderTables) console.log(`  ${Object.values(t)[0]}`);

  // Check if projects have sourcePurpose = 'tender'
  const [tenderProjects]: any = await conn.query(`
    SELECT sourcePurpose, COUNT(*) as cnt FROM projects 
    WHERE projectState IN ('WA', 'OFFSHORE_AU')
      AND (suppressed IS NULL OR suppressed = 0 OR suppressed = '')
      AND lifecycleStatus != 'dead'
    GROUP BY sourcePurpose
  `);
  console.log('\n=== WA PROJECTS BY sourcePurpose ===');
  for (const t of tenderProjects) {
    console.log(`  ${t.sourcePurpose || 'null'}: ${t.cnt}`);
  }

  // Check tenderNumber presence
  const [tenderNum]: any = await conn.query(`
    SELECT COUNT(*) as cnt FROM projects 
    WHERE projectState IN ('WA', 'OFFSHORE_AU')
      AND (suppressed IS NULL OR suppressed = 0 OR suppressed = '')
      AND lifecycleStatus != 'dead'
      AND tenderNumber IS NOT NULL AND tenderNumber != ''
  `);
  console.log(`\nWA projects with tenderNumber: ${tenderNum[0].cnt}`);

  // Show sample tender projects
  const [tenderSamples]: any = await conn.query(`
    SELECT id, name, tenderNumber, tenderCloseDate, sourcePurpose FROM projects 
    WHERE projectState IN ('WA', 'OFFSHORE_AU')
      AND (suppressed IS NULL OR suppressed = 0 OR suppressed = '')
      AND lifecycleStatus != 'dead'
      AND (tenderNumber IS NOT NULL AND tenderNumber != '')
    ORDER BY tenderCloseDate DESC
    LIMIT 15
  `);
  console.log('\n=== SAMPLE TENDER PROJECTS (WA) ===');
  for (const t of tenderSamples) {
    console.log(`  [${t.id}] ${t.name.slice(0, 60)} | tender#: ${t.tenderNumber} | close: ${t.tenderCloseDate || 'n/a'}`);
  }

  await conn.end();
}
main().catch(e => { console.error(e); process.exit(1); });
