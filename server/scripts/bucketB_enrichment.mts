/**
 * Bucket B Enrichment Pass — 18 May 2026
 *
 * Runs Hunter email verification on all named_unverified contacts
 * for the 20 new hot/warm projects found this week (12–17 May).
 * Origin/APLNG Ironbark Expansion is processed first (Option 3).
 */

import { verifyProjectContactsWithHunter } from "../hunterVerification.js";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Projects with named_unverified contacts — ordered by priority
// Origin/APLNG first (Option 3 priority), then remaining hot, then warm
// Delburn Wind Farm (1350025) excluded — suppressed
const TARGETS = [
  // HOT — Option 3 priority first
  { id: 1350035, name: "Origin/APLNG Ironbark Expansion", priority: "hot", sector: "oil_gas", count: 4 },
  // HOT — remaining
  { id: 1380005, name: "Flemington Racecourse 767 kWdc Commercial Solar Installation", priority: "hot", sector: "energy", count: 3 },
  { id: 1380015, name: "Poatina hydropower station upgrade", priority: "hot", sector: "energy", count: 2 },
  { id: 1350021, name: "EnergyConnect Interconnector", priority: "hot", sector: "energy", count: 1 },
  { id: 1350013, name: "New Secure Government Facility", priority: "hot", sector: "infrastructure", count: 1 },
  // WARM
  { id: 1350022, name: "Nolans Rare Earths Project", priority: "warm", sector: "mining", count: 3 },
  { id: 1350006, name: "Carmichael Mine Road Dispute", priority: "warm", sector: "mining", count: 3 },
  { id: 1350010, name: "TasNetworks North West Transmission Developments (NWTD) Stage 1", priority: "warm", sector: "energy", count: 2 },
  { id: 1380001, name: "Naval Strike Missiles and Joint Strike Missiles Domestic Manufacturing", priority: "warm", sector: "defence", count: 2 },
  { id: 1350007, name: "Bairnsdale Quarries Operations", priority: "warm", sector: "mining", count: 2 },
  { id: 1350015, name: "New Iron Ore Mine Development", priority: "warm", sector: "mining", count: 2 },
  { id: 1380002, name: "Bulli Creek Stage 1 Solar Farm and Battery Energy Storage System", priority: "warm", sector: "energy", count: 2 },
  { id: 1350032, name: "Bulwer Island Fuel Storage Expansion", priority: "warm", sector: "energy", count: 1 },
  { id: 1380028, name: "Queensland Renewable Energy Tender (QRET)", priority: "warm", sector: "energy", count: 1 },
  { id: 1350020, name: "Federal Budget 2026/27 Infrastructure Pipeline", priority: "warm", sector: "infrastructure", count: 1 },
  { id: 1350030, name: "AGL Big Battery", priority: "warm", sector: "energy", count: 1 },
  { id: 1380013, name: "Victorian water infrastructure upgrade", priority: "warm", sector: "infrastructure", count: 1 },
  { id: 1290011, name: "Southern Gold Coast Coastal Residential High-Rise Development", priority: "warm", sector: "infrastructure", count: 1 },
  { id: 1350004, name: "Hyden Gold Project", priority: "warm", sector: "mining", count: 1 },
];

async function main() {
  log("=== BUCKET B ENRICHMENT PASS — 18 MAY 2026 ===");
  log(`Processing ${TARGETS.length} projects | ${TARGETS.reduce((s, t) => s + t.count, 0)} named_unverified contacts total`);
  log("Origin/APLNG Ironbark Expansion processed first (Option 3 priority)\n");

  const results: {
    project: string;
    priority: string;
    processed: number;
    promoted: number;
    emailsFound: number;
    status: string;
  }[] = [];

  let totalProcessed = 0;
  let totalPromoted = 0;
  let totalEmailsFound = 0;

  for (const target of TARGETS) {
    log(`[Hunter] → ${target.name} (ID: ${target.id}, ${target.priority}/${target.sector}, ${target.count} contacts)`);
    try {
      const result = await verifyProjectContactsWithHunter(target.id, 15);
      const icon = result.promoted > 0 ? "✓ PROMOTED" : result.processed === 0 ? "— SKIPPED" : "· verified";
      log(`[Hunter] ${icon}: ${result.processed} processed, ${result.promoted} → send_ready, ${result.emailsFound} emails confirmed`);
      results.push({
        project: target.name,
        priority: target.priority,
        processed: result.processed,
        promoted: result.promoted,
        emailsFound: result.emailsFound,
        status: "ok",
      });
      totalProcessed += result.processed;
      totalPromoted += result.promoted;
      totalEmailsFound += result.emailsFound;
    } catch (err: any) {
      log(`[Hunter] ✗ ERROR: ${err.message}`);
      results.push({
        project: target.name,
        priority: target.priority,
        processed: 0,
        promoted: 0,
        emailsFound: 0,
        status: `error: ${err.message}`,
      });
    }
    await sleep(1500);
  }

  log("\n=== BUCKET B ENRICHMENT SUMMARY ===");
  log(`Total contacts processed : ${totalProcessed}`);
  log(`Total promoted send_ready: ${totalPromoted}`);
  log(`Total emails confirmed   : ${totalEmailsFound}`);
  log("\nPer-project results:");
  for (const r of results) {
    const icon = r.promoted > 0 ? "✓" : r.status !== "ok" ? "✗" : "—";
    log(`  ${icon} [${r.priority}] ${r.project}: ${r.promoted} promoted, ${r.emailsFound} emails — ${r.status}`);
  }
  log(`\nCompleted: ${new Date().toISOString()}`);
}

main().catch(err => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
