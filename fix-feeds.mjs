/**
 * Fix broken RSS feed URLs in the database.
 * Run with: node fix-feeds.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;

// Feeds to UPDATE with correct URLs
const urlFixes = [
  { oldUrl: '%defenceconnect.com.au/rss%', newUrl: 'https://www.defenceconnect.com.au/news?format=feed&type=rss' },
  { oldUrl: '%defenceconnect.com.au/feed%', newUrl: 'https://www.defenceconnect.com.au/news?format=feed&type=rss' },
  { oldUrl: '%energynewsbulletin.net/feed/%', newUrl: 'https://www.energynewsbulletin.net/feed/rss' },
  { oldUrl: '%rigzone.com/news/rss/%', newUrl: 'https://www.rigzone.com/news/rss/rigzone_latest.aspx' },
  { oldUrl: '%miningweekly.com/page/rss%', newUrl: 'https://www.miningweekly.com/page/home/feed' },
  { oldUrl: '%renewablesnow.com/feed/%', newUrl: 'https://renewablesnow.com/news/news_feed/?source=solar' },
  { oldUrl: '%mining.com/feed/%', newUrl: 'https://www.mining.com/feed/' },
  { oldUrl: '%constructionequipmentguide.com/rss%', newUrl: 'https://feeds.feedburner.com/ceg' },
];

// Feeds to DEACTIVATE (no RSS available)
const deactivatePatterns = [
  '%australiandefence.com.au%',      // No RSS feed
  '%awa.asn.au/feed%',               // No RSS feed
  '%cleanenergycouncil.org.au%',     // No RSS feed
  '%drillandblast.com%',             // Domain issues / no RSS
  '%constructionworld.org%',         // Domain doesn't exist
  '%energynewsaustralia.com%',       // Domain doesn't exist
  '%theurbandeveloper.com/feed%',    // No RSS feed
  '%offshore-mag.com/rss%',          // Captcha protected, no RSS
  '%miningmonthly.com%',             // No RSS feed
  '%miningmagazine.com%',            // No RSS feed
  '%miragenews.com%',                // No RSS (returns HTML)
  '%mediastatements.wa.gov.au%',     // No RSS (returns HTML)
  '%petroleumaustralia.com.au%',     // Domain issues
  '%oilandgasaustralia.com.au%',     // Domain issues
  '%geodrillinginternational.com%',  // No RSS
  '%thedriller.com%',                // 403 blocked
  '%worldpumps.com%',                // No RSS
  '%pumpengineer.net%',              // Domain issues
  '%watersource.awa.asn.au%',        // No RSS
  '%proactiveinvestors.com.au%',     // No RSS
  '%statements.qld.gov.au%',         // No RSS
  '%pmmag.com%',                     // 403 blocked
  '%wwdmag.com%',                    // No RSS
  '%afr.com/rss%',                   // No RSS (paywalled)
  '%energyvoice.com%',               // 403 blocked
];

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);
  
  console.log('=== Fixing RSS Feed URLs ===\n');
  
  // 1. Fix URLs
  for (const fix of urlFixes) {
    const [result] = await conn.execute(
      'UPDATE rssSources SET feedUrl = ?, errorCount = 0 WHERE feedUrl LIKE ?',
      [fix.newUrl, fix.oldUrl]
    );
    console.log(`URL fix: ${fix.oldUrl} → ${fix.newUrl} (${result.affectedRows} rows)`);
  }
  
  console.log('\n=== Deactivating Feeds Without RSS ===\n');
  
  // 2. Deactivate feeds with no RSS
  for (const pattern of deactivatePatterns) {
    const [result] = await conn.execute(
      'UPDATE rssSources SET isActive = 0 WHERE feedUrl LIKE ? AND isActive = 1',
      [pattern]
    );
    if (result.affectedRows > 0) {
      console.log(`Deactivated: ${pattern} (${result.affectedRows} rows)`);
    }
  }
  
  console.log('\n=== Current Feed Status ===\n');
  
  // 3. Show summary
  const [active] = await conn.execute('SELECT COUNT(*) as cnt FROM rssSources WHERE isActive = 1');
  const [inactive] = await conn.execute('SELECT COUNT(*) as cnt FROM rssSources WHERE isActive = 0');
  const [withErrors] = await conn.execute('SELECT COUNT(*) as cnt FROM rssSources WHERE isActive = 1 AND errorCount > 0');
  const [neverFetched] = await conn.execute('SELECT COUNT(*) as cnt FROM rssSources WHERE isActive = 1 AND lastFetchedAt IS NULL');
  
  console.log(`Active feeds:       ${active[0].cnt}`);
  console.log(`Inactive feeds:     ${inactive[0].cnt}`);
  console.log(`Active with errors: ${withErrors[0].cnt}`);
  console.log(`Active never fetched: ${neverFetched[0].cnt}`);
  
  console.log('\n=== Active Feeds List ===\n');
  const [feeds] = await conn.execute(
    'SELECT name, feedUrl, errorCount, lastFetchedAt FROM rssSources WHERE isActive = 1 ORDER BY name'
  );
  for (const f of feeds) {
    const status = f.lastFetchedAt ? '✓' : '○';
    const errors = f.errorCount > 0 ? ` (${f.errorCount} errors)` : '';
    console.log(`  ${status} ${f.name}${errors}`);
    console.log(`    ${f.feedUrl}`);
  }
  
  await conn.end();
}

main().catch(console.error);
