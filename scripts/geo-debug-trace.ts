/**
 * Deep debug trace — uses actual DB data and traces each classifier decision
 */

import { createConnection } from "mysql2/promise";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

// Inline the AU_SOURCE_DOMAIN_PATTERNS to debug
const AU_SOURCE_DOMAIN_PATTERNS = [
  ".gov.au", "tenders.gov.au", "infrastructureaustralia.gov.au",
  "aemo.com.au", "aer.gov.au",
  "stockhead.com.au", "miningweekly.com.au", "resourcesandgeoscience.nsw.gov.au",
  "dmp.wa.gov.au", "dmirs.wa.gov.au",
  "reneweconomy.com.au", "pv-magazine-australia.com", "energymagazine.com.au",
  "theenergist.com.au",
  "constructionreview.com.au", "infrastructuremagazine.com.au",
  "theurbandeveloper.com", "australianmining.com.au",
  "afr.com", "smh.com.au", "theaustralian.com.au", "abc.net.au",
  "businessnews.com.au", "watoday.com.au",
  "quarrymagazine.com", "miningmonthly.com.au",
];

const AUSTRALIA_CONFIRM_PATTERNS = ["australia", "australian"];

const FOREIGN_LOCATION_ANCHOR_PHRASES = [
  "located in", "location:", "project in", "mine in", "plant in",
  "facility in", "site in", "operations in", "construction in",
  "development in", "deployment in", "installation in",
  "project is in", "project is located", "based in", "situated in",
  "across the middle east", "across europe", "across africa",
  "across asia", "across latin america", "across south america",
  "in ghana", "in nigeria", "in zambia", "in chile", "in peru",
  "in indonesia", "in mongolia", "in philippines",
  "in saudi arabia", "in the uae", "in dubai",
  "in the united states", "in the usa", "in canada",
  "in india", "in china",
  "outside australia",
];

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL!);

  const [rows] = await conn.execute<any[]>(`
    SELECT id, name, location, owner, overview, sources, sector
    FROM projects
    WHERE id IN (30022, 120032, 480047, 570004, 660003)
    ORDER BY id
  `);

  for (const row of rows) {
    let sources: Array<{ label: string; url: string }> | null = null;
    try { sources = row.sources ? JSON.parse(row.sources) : null; } catch { sources = null; }

    const sourceUrls = (sources ?? []).map((s: any) => s.url.toLowerCase()).join(" ");
    const overviewLower = (row.overview ?? "").toLowerCase();
    const projectText = [row.name, row.location, row.overview ?? ""].join(" ").toLowerCase();

    const hasAuSourceDomain = AU_SOURCE_DOMAIN_PATTERNS.some(d => sourceUrls.includes(d));
    const hasAustraliaKeyword = AUSTRALIA_CONFIRM_PATTERNS.some(p => projectText.includes(p));
    const foreignIsAnchored = FOREIGN_LOCATION_ANCHOR_PHRASES.some(p => overviewLower.includes(p));

    console.log(`[${row.id}] ${row.name.slice(0, 55)}`);
    console.log(`  sourceUrls: ${sourceUrls.slice(0, 100)}`);
    console.log(`  hasAuSourceDomain: ${hasAuSourceDomain}`);
    console.log(`  hasAustraliaKeyword: ${hasAustraliaKeyword}`);
    console.log(`  foreignIsAnchored: ${foreignIsAnchored}`);

    // Check which anchor phrase matched
    if (foreignIsAnchored) {
      const matched = FOREIGN_LOCATION_ANCHOR_PHRASES.filter(p => overviewLower.includes(p));
      console.log(`  matched anchor phrases: ${JSON.stringify(matched)}`);
    }
    console.log(``);
  }

  await conn.end();
}

main().catch(console.error);
