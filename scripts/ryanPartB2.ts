import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  // Get all active RSS sources with stats
  const [sources]: any = await conn.query(`
    SELECT id, name, feedUrl, category, lastFetchedAt, totalArticles, successCount, lastSuccessAt
    FROM rssSources 
    WHERE isActive = 1 
    ORDER BY totalArticles DESC
  `);
  console.log(`=== ACTIVE RSS SOURCES (${sources.length}) ===\n`);
  console.log('ID  | NAME                                    | CATEGORY    | ARTICLES | LAST FETCH');
  console.log('----|----------------------------------------|-------------|----------|----------');
  for (const s of sources) {
    const name = (s.name || '').padEnd(40).slice(0, 40);
    const cat = (s.category || '').padEnd(11).slice(0, 11);
    const lastFetch = s.lastFetchedAt ? new Date(s.lastFetchedAt).toISOString().slice(0, 10) : 'never';
    console.log(`${String(s.id).padStart(3)} | ${name}| ${cat} | ${String(s.totalArticles || 0).padStart(8)} | ${lastFetch}`);
  }

  // Check rawArticles table columns
  const [raCols]: any = await conn.query('SHOW COLUMNS FROM rawArticles');
  console.log('\n=== rawArticles COLUMNS ===');
  for (const c of raCols) console.log(c.Field);

  // Count articles by source that produced WA projects
  const [articleStats]: any = await conn.query(`
    SELECT 
      rs.name as sourceName,
      rs.totalArticles,
      COUNT(DISTINCT ra.id) as recentArticles
    FROM rssSources rs
    LEFT JOIN rawArticles ra ON ra.sourceId = rs.id AND ra.createdAt > DATE_SUB(NOW(), INTERVAL 30 DAY)
    WHERE rs.isActive = 1
    GROUP BY rs.id, rs.name, rs.totalArticles
    ORDER BY recentArticles DESC
  `);
  console.log('\n=== RSS SOURCE ARTICLE PRODUCTION (last 30 days) ===\n');
  console.log('SOURCE                                    | TOTAL | LAST 30D');
  console.log('------------------------------------------|-------|--------');
  for (const s of articleStats) {
    const name = (s.sourceName || '').padEnd(42).slice(0, 42);
    console.log(`${name}| ${String(s.totalArticles || 0).padStart(5)} | ${String(s.recentArticles).padStart(7)}`);
  }

  // Check rawArticles extraction status
  const [extractionStats]: any = await conn.query(`
    SELECT 
      extractionStatus,
      COUNT(*) as cnt
    FROM rawArticles
    GROUP BY extractionStatus
  `);
  console.log('\n=== ARTICLE EXTRACTION STATUS ===');
  for (const s of extractionStats) {
    console.log(`  ${s.extractionStatus || 'null'}: ${s.cnt}`);
  }

  // Check how many queued articles exist
  const [queued]: any = await conn.query(`
    SELECT COUNT(*) as cnt FROM rawArticles WHERE extractionStatus = 'queued'
  `);
  console.log(`\nQueued for extraction: ${queued[0].cnt}`);

  // Check rawArticles that match specialty-air keywords
  const [specialtyArticles]: any = await conn.query(`
    SELECT COUNT(*) as cnt FROM rawArticles 
    WHERE (LOWER(title) LIKE '%nitrogen%' OR LOWER(title) LIKE '%purging%' OR LOWER(title) LIKE '%inerting%'
      OR LOWER(title) LIKE '%pipeline test%' OR LOWER(title) LIKE '%commissioning%' OR LOWER(title) LIKE '%lng%'
      OR LOWER(title) LIKE '%fpso%' OR LOWER(title) LIKE '%booster%' OR LOWER(title) LIKE '%pre-commission%')
  `);
  console.log(`\nSpecialty-air keyword articles (all time): ${specialtyArticles[0].cnt}`);

  // Check which new O&G feeds have produced articles
  const [newFeeds]: any = await conn.query(`
    SELECT rs.name, rs.totalArticles, rs.lastSuccessAt,
      (SELECT COUNT(*) FROM rawArticles ra WHERE ra.sourceId = rs.id AND ra.createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY)) as last7d
    FROM rssSources rs
    WHERE rs.name IN ('Offshore Technology', 'OilPrice.com', 'LNG Prime', 'Drilling Contractor', 'NS Energy Business', 'Hydrocarbons Technology', 'Gas Today Australia', 'Energy News Bulletin')
    ORDER BY rs.totalArticles DESC
  `);
  console.log('\n=== NEW O&G FEED PERFORMANCE ===');
  for (const f of newFeeds) {
    console.log(`  ${f.name}: total=${f.totalArticles}, last7d=${f.last7d}, lastSuccess=${f.lastSuccessAt ? new Date(f.lastSuccessAt).toISOString().slice(0, 10) : 'never'}`);
  }

  await conn.end();
}
main().catch(e => { console.error(e); process.exit(1); });
