/**
 * Diagnostic script: test each RSS feed URL and report the exact error
 */

const feeds = [
  // Feeds showing "Never" fetched with errors in the screenshot
  { name: "Australian Defence Magazine", url: "https://www.australiandefence.com.au/feed/" },
  { name: "Australian Financial Review", url: "https://www.afr.com/rss/companies" },
  { name: "Australian Water Association", url: "https://www.awa.asn.au/feed/" },
  { name: "Clean Energy Council", url: "https://www.cleanenergycouncil.org.au/news/feed" },
  { name: "Construction World", url: "https://www.constructionworld.org/feed/" },
  { name: "Defence Connect", url: "https://www.defenceconnect.com.au/feed" },
  { name: "Drill & Blast", url: "https://www.drillandblast.com/feed/" },
  { name: "Energy News Australia", url: "https://www.energynewsaustralia.com/feed/" },
  { name: "Energy News Bulletin", url: "https://www.energynewsbulletin.net/feed/" },
  
  // Also test some that are working for comparison
  { name: "Australian Mining (working)", url: "https://www.australianmining.com.au/feed/" },
  { name: "Energy Storage News (working)", url: "https://www.energy-storage.news/feed/" },
  
  // New feeds we added
  { name: "ASPI Strategist", url: "https://www.aspistrategist.org.au/feed/" },
  { name: "Inside Construction", url: "https://insideconstruction.com.au/feed/" },
  { name: "Build Australia", url: "https://buildaustralia.com.au/feed/" },
  { name: "Sourceable", url: "https://sourceable.net/feed/" },
  { name: "The Urban Developer", url: "https://theurbandeveloper.com/feed" },
  { name: "Quarry Magazine", url: "https://www.quarrymagazine.com/feed/" },
  { name: "Rigzone", url: "https://www.rigzone.com/news/rss/" },
  { name: "Offshore Magazine", url: "https://www.offshore-mag.com/rss" },
  { name: "Petroleum Australia", url: "https://www.petroleumaustralia.com.au/feed/" },
  { name: "Oil & Gas Australia", url: "https://www.oilandgasaustralia.com.au/feed/" },
  { name: "Energy Voice Asia-Pacific", url: "https://www.energyvoice.com/region/asia-australasia/feed/" },
  { name: "PV Magazine Australia", url: "https://www.pv-magazine-australia.com/feed/" },
  { name: "Geo Drilling International", url: "https://www.geodrillinginternational.com/rss" },
  { name: "The Driller", url: "https://www.thedriller.com/rss" },
  { name: "Mirage News - Mining", url: "https://www.miragenews.com/tag/mining/feed/" },
  { name: "Mirage News - Construction", url: "https://www.miragenews.com/tag/construction/feed/" },
  { name: "Mining Weekly", url: "https://www.miningweekly.com/page/rss" },
  { name: "Mining Monthly", url: "https://www.miningmonthly.com/feed/" },
  
  // Other feeds from seed data that might be failing
  { name: "Mining Magazine", url: "https://www.miningmagazine.com/feed/" },
  { name: "World Pumps", url: "https://www.worldpumps.com/rss/" },
  { name: "Pump Engineer", url: "https://www.pumpengineer.net/feed/" },
  { name: "Water Source", url: "https://watersource.awa.asn.au/feed/" },
  { name: "Proactive Investors AU", url: "https://www.proactiveinvestors.com.au/pages/rss" },
  { name: "Small Caps", url: "https://smallcaps.com.au/feed/" },
  { name: "Stockhead", url: "https://stockhead.com.au/feed/" },
  { name: "WA Government Media", url: "https://www.mediastatements.wa.gov.au/RSS" },
  { name: "QLD Government News", url: "https://statements.qld.gov.au/feed" },
  { name: "Projectory Australia", url: "https://www.projectory.com.au/rss.xml" },
  { name: "Diesel Progress", url: "https://dieselnet.com/rss.xml" },
  { name: "PM Magazine - Pumps", url: "https://www.pmmag.com/rss/topic/4293-pumps" },
  { name: "Fluid Handling Magazine", url: "https://fluidhandlingmag.com/feed/" },
  { name: "Roads & Infrastructure", url: "https://roadsonline.com.au/feed/" },
  { name: "Renew Economy", url: "https://reneweconomy.com.au/feed/" },
  { name: "Pump Industry Australia", url: "https://www.pumpindustry.com.au/feed/" },
  { name: "Water & Wastes Digest", url: "https://www.wwdmag.com/rss.xml" },
  { name: "Utility Magazine", url: "https://utilitymagazine.com.au/feed/" },
  { name: "Renewables Now", url: "https://renewablesnow.com/feed/" },
  { name: "Construction Equipment Guide", url: "https://www.constructionequipmentguide.com/rss/news.xml" },
  { name: "International Mining", url: "https://im-mining.com/feed/" },
  { name: "Mining.com", url: "https://www.mining.com/feed/" },
  { name: "Mining Technology", url: "https://www.mining-technology.com/feed/" },
  { name: "Infrastructure Magazine", url: "https://infrastructuremagazine.com.au/feed/" },
  { name: "Energy Magazine", url: "https://www.energymagazine.com.au/feed/" },
];

async function testFeed(feed) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AtlasCopcoIntelligence/1.0 (RSS Aggregator)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    
    const elapsed = Date.now() - start;
    const contentType = response.headers.get("content-type") || "unknown";
    
    if (!response.ok) {
      return { name: feed.name, url: feed.url, status: "FAIL", code: response.status, statusText: response.statusText, contentType, elapsed, items: 0 };
    }
    
    const text = await response.text();
    const size = text.length;
    
    // Count items
    const rssItems = (text.match(/<item[\s>]/gi) || []).length;
    const atomEntries = (text.match(/<entry[\s>]/gi) || []).length;
    const items = rssItems || atomEntries;
    
    // Check if it's actually XML
    const isXml = text.trim().startsWith("<?xml") || text.trim().startsWith("<rss") || text.trim().startsWith("<feed") || text.includes("<channel>");
    
    return { 
      name: feed.name, url: feed.url, status: "OK", code: 200, 
      contentType, elapsed, items, size, isXml,
      preview: text.slice(0, 200).replace(/\n/g, " ")
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { name: feed.name, url: feed.url, status: "ERROR", error: err.message, elapsed };
  }
}

console.log("Testing all RSS feeds...\n");
console.log("=" .repeat(120));

const results = [];
for (const feed of feeds) {
  const result = await testFeed(feed);
  results.push(result);
  
  const statusIcon = result.status === "OK" ? "✓" : "✗";
  const statusColor = result.status === "OK" ? "" : " <<<";
  
  if (result.status === "OK") {
    console.log(`${statusIcon} ${result.name.padEnd(35)} ${result.code} | ${result.items} items | ${result.elapsed}ms | ${result.contentType.slice(0, 30)} | xml:${result.isXml}`);
  } else if (result.status === "FAIL") {
    console.log(`${statusIcon} ${result.name.padEnd(35)} HTTP ${result.code} ${result.statusText} | ${result.elapsed}ms | ${result.contentType}${statusColor}`);
  } else {
    console.log(`${statusIcon} ${result.name.padEnd(35)} ${result.error} | ${result.elapsed}ms${statusColor}`);
  }
}

console.log("\n" + "=" .repeat(120));
console.log("\nSUMMARY:");
const ok = results.filter(r => r.status === "OK");
const fail = results.filter(r => r.status !== "OK");
console.log(`  Working: ${ok.length}/${results.length}`);
console.log(`  Failed:  ${fail.length}/${results.length}`);

if (fail.length > 0) {
  console.log("\nFAILED FEEDS:");
  for (const f of fail) {
    console.log(`  - ${f.name}: ${f.url}`);
    console.log(`    Error: ${f.code ? `HTTP ${f.code} ${f.statusText}` : f.error}`);
  }
}

// Also check for feeds that return OK but have 0 items (bad XML)
const emptyOk = ok.filter(r => r.items === 0);
if (emptyOk.length > 0) {
  console.log("\nOK BUT EMPTY (0 items — possibly not valid RSS):");
  for (const f of emptyOk) {
    console.log(`  - ${f.name}: ${f.url}`);
    console.log(`    Content-Type: ${f.contentType} | isXml: ${f.isXml} | Size: ${f.size}`);
    console.log(`    Preview: ${f.preview?.slice(0, 100)}`);
  }
}
