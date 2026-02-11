/**
 * Add new RSS feeds to scale project discovery toward 500+
 * Checks existing feeds first, then adds new ones that aren't duplicates
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';

const pool = mysql.createPool(process.env.DATABASE_URL);
const db = drizzle(pool);

// First check what we already have
const [existingSources] = await db.execute(sql`SELECT id, name, feedUrl, category FROM rssSources ORDER BY category, name`);
const [existingBL] = await db.execute(sql`SELECT id, name, keywords FROM businessLines WHERE isActive = true`);

console.log(`\n=== EXISTING RSS SOURCES (${existingSources.length}) ===`);
for (const s of existingSources) {
  console.log(`  [${s.category}] ${s.name}: ${s.feedUrl}`);
}

console.log(`\n=== BUSINESS LINES ===`);
for (const bl of existingBL) {
  const kw = JSON.parse(typeof bl.keywords === 'string' ? bl.keywords : JSON.stringify(bl.keywords));
  console.log(`  ${bl.id}: ${bl.name} (${kw?.length || 0} keywords)`);
}

// New feeds to add — focused on Australian mining, infrastructure, energy, drilling, construction
const newFeeds = [
  // Mining & Resources
  { name: "Mining Weekly SA", feedUrl: "https://www.miningweekly.com/page/rss", category: "mining" },
  { name: "Mining Journal", feedUrl: "https://www.mining-journal.com/feed", category: "mining" },
  { name: "Mining Magazine", feedUrl: "https://www.miningmagazine.com/feed", category: "mining" },
  { name: "Mining Global", feedUrl: "https://miningglobal.com/rss/articles", category: "mining" },
  { name: "International Mining", feedUrl: "https://im-mining.com/feed/", category: "mining" },
  { name: "Mining News Net", feedUrl: "https://www.miningnewsnet.com/feed/", category: "mining" },
  { name: "Proactive Investors AU Mining", feedUrl: "https://www.proactiveinvestors.com.au/companies/rss/mining", category: "mining" },
  
  // Drilling & Exploration
  { name: "Geo Drilling International", feedUrl: "https://www.geodrillinginternational.com/rss", category: "drilling" },
  { name: "The Driller", feedUrl: "https://www.thedriller.com/rss", category: "drilling" },
  { name: "Drill & Blast", feedUrl: "https://www.drillandblast.com/feed/", category: "drilling" },
  
  // Oil & Gas
  { name: "Rigzone News", feedUrl: "https://www.rigzone.com/news/rss/", category: "oil_gas" },
  { name: "Offshore Magazine", feedUrl: "https://www.offshore-mag.com/rss", category: "oil_gas" },
  { name: "Energy Voice Asia-Australasia", feedUrl: "https://www.energyvoice.com/region/asia-australasia/feed/", category: "oil_gas" },
  { name: "Petroleum Australia", feedUrl: "https://www.petroleumaustralia.com.au/feed/", category: "oil_gas" },
  { name: "Oil & Gas Australia", feedUrl: "https://www.oilandgasaustralia.com.au/feed/", category: "oil_gas" },
  { name: "LNG Industry", feedUrl: "https://www.lngindustry.com/rss", category: "oil_gas" },
  
  // Infrastructure & Construction
  { name: "Inside Construction", feedUrl: "https://insideconstruction.com.au/feed/", category: "infrastructure" },
  { name: "Infrastructure Magazine", feedUrl: "https://infrastructuremagazine.com.au/feed/", category: "infrastructure" },
  { name: "Build Australia", feedUrl: "https://buildaustralia.com.au/feed/", category: "infrastructure" },
  { name: "Sourceable", feedUrl: "https://sourceable.net/feed/", category: "infrastructure" },
  { name: "The Urban Developer", feedUrl: "https://theurbandeveloper.com/feed", category: "infrastructure" },
  { name: "Roads & Infrastructure AU", feedUrl: "https://roadsonline.com.au/feed/", category: "infrastructure" },
  { name: "Construction World", feedUrl: "https://www.constructionworld.org/feed/", category: "infrastructure" },
  
  // Energy & BESS
  { name: "RenewEconomy", feedUrl: "https://reneweconomy.com.au/feed/", category: "energy" },
  { name: "One Step Off The Grid", feedUrl: "https://onestepoffthegrid.com.au/feed/", category: "energy" },
  { name: "Energy Magazine AU", feedUrl: "https://www.energymagazine.com.au/feed/", category: "energy" },
  { name: "PV Magazine Australia", feedUrl: "https://www.pv-magazine-australia.com/feed/", category: "energy" },
  { name: "Clean Energy Council", feedUrl: "https://www.cleanenergycouncil.org.au/news/feed", category: "energy" },
  
  // Quarry & Aggregates
  { name: "Quarry Magazine", feedUrl: "https://www.quarrymagazine.com/feed/", category: "quarry" },
  
  // Utility & Water
  { name: "Utility Magazine", feedUrl: "https://utilitymagazine.com.au/feed/", category: "utility" },
  
  // General News (Mining/Construction tags)
  { name: "Mirage News Mining", feedUrl: "https://www.miragenews.com/tag/mining/feed/", category: "news" },
  { name: "Mirage News Construction", feedUrl: "https://www.miragenews.com/tag/construction/feed/", category: "news" },
  { name: "Mirage News Infrastructure", feedUrl: "https://www.miragenews.com/tag/infrastructure/feed/", category: "news" },
  { name: "Mirage News Energy", feedUrl: "https://www.miragenews.com/tag/energy/feed/", category: "news" },
  
  // ASX / Investor News
  { name: "Hot Copper Mining", feedUrl: "https://hotcopper.com.au/rss/mining", category: "asx" },
  { name: "Small Caps Mining", feedUrl: "https://smallcaps.com.au/feed/", category: "asx" },
  
  // Defence
  { name: "Australian Defence Magazine", feedUrl: "https://www.australiandefence.com.au/feed", category: "defence" },
  { name: "Defence Connect", feedUrl: "https://www.defenceconnect.com.au/rss", category: "defence" },
  
  // Water & Pumps
  { name: "Water Source", feedUrl: "https://watersource.awa.asn.au/feed/", category: "water" },
  { name: "Pump Industry", feedUrl: "https://www.pumpindustry.com.au/feed/", category: "water" },
];

// Check which feeds already exist
const existingUrls = new Set(existingSources.map(s => s.feedUrl.toLowerCase().replace(/\/$/, '')));

let added = 0;
let skipped = 0;

for (const feed of newFeeds) {
  const normalizedUrl = feed.feedUrl.toLowerCase().replace(/\/$/, '');
  if (existingUrls.has(normalizedUrl)) {
    console.log(`  SKIP (exists): ${feed.name}`);
    skipped++;
    continue;
  }
  
  try {
    await db.execute(sql`
      INSERT INTO rssSources (name, feedUrl, category, isActive, errorCount)
      VALUES (${feed.name}, ${feed.feedUrl}, ${feed.category}, true, 0)
    `);
    console.log(`  ADDED: ${feed.name} [${feed.category}]`);
    added++;
  } catch (e) {
    console.log(`  ERROR: ${feed.name}: ${e.message}`);
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`Added: ${added} new feeds`);
console.log(`Skipped: ${skipped} (already exist)`);

// Final count
const [finalCount] = await db.execute(sql`SELECT COUNT(*) as cnt FROM rssSources WHERE isActive = true`);
console.log(`Total active RSS sources: ${finalCount[0].cnt}`);

await pool.end();
process.exit(0);
