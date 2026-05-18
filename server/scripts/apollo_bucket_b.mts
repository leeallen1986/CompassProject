/**
 * Apollo Enrichment Pass — Bucket B Rescue
 * 18 May 2026
 *
 * Runs Apollo enrichProjectContacts on the 17 projects where
 * Hunter could not verify emails. Apollo searches by company domain
 * and can find emails that Hunter doesn't have indexed.
 *
 * Projects are ordered: hot first, then warm by named_unverified count desc.
 * Phone numbers are excluded per policy.
 */

import { enrichProjectContacts } from "../apolloEnrichment.js";

const REPORT_ID = 990001; // Latest report — week ending 2026-05-17
const DELAY_MS = 3000;    // 3s between projects — polite rate limiting

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// 17 projects that Hunter couldn't verify — hot first, then warm
const TARGETS = [
  // HOT
  { id: 1380005, name: "Flemington Racecourse 767 kWdc Commercial Solar Installation", priority: "hot", sector: "energy", unverified: 3 },
  { id: 1380015, name: "Poatina hydropower station upgrade", priority: "hot", sector: "energy", unverified: 2 },
  { id: 1350013, name: "New Secure Government Facility", priority: "hot", sector: "infrastructure", unverified: 1 },
  // WARM — mining first (most relevant for reps)
  { id: 1350022, name: "Nolans Rare Earths Project", priority: "warm", sector: "mining", unverified: 3 },
  { id: 1350006, name: "Carmichael Mine Road Dispute", priority: "warm", sector: "mining", unverified: 3 },
  { id: 1350007, name: "Bairnsdale Quarries Operations", priority: "warm", sector: "mining", unverified: 2 },
  { id: 1350015, name: "New Iron Ore Mine Development", priority: "warm", sector: "mining", unverified: 2 },
  { id: 1350004, name: "Hyden Gold Project", priority: "warm", sector: "mining", unverified: 0 }, // already 1 SR but run Apollo for more
  // WARM — energy/infrastructure
  { id: 1350010, name: "TasNetworks North West Transmission Developments (NWTD) Stage 1", priority: "warm", sector: "energy", unverified: 2 },
  { id: 1380001, name: "Naval Strike Missiles and Joint Strike Missiles Domestic Manufacturing", priority: "warm", sector: "defence", unverified: 2 },
  { id: 1380002, name: "Bulli Creek Stage 1 Solar Farm and Battery Energy Storage System", priority: "warm", sector: "energy", unverified: 2 },
  { id: 1350032, name: "Bulwer Island Fuel Storage Expansion", priority: "warm", sector: "energy", unverified: 1 },
  { id: 1380028, name: "Queensland Renewable Energy Tender (QRET)", priority: "warm", sector: "energy", unverified: 1 },
  { id: 1350020, name: "Federal Budget 2026/27 Infrastructure Pipeline", priority: "warm", sector: "infrastructure", unverified: 1 },
  { id: 1350030, name: "AGL Big Battery", priority: "warm", sector: "energy", unverified: 1 },
  { id: 1380013, name: "Victorian water infrastructure upgrade", priority: "warm", sector: "infrastructure", unverified: 1 },
  { id: 1290011, name: "Southern Gold Coast Coastal Residential High-Rise Development", priority: "warm", sector: "infrastructure", unverified: 1 },
];

async function main() {
  log("=== APOLLO BUCKET B RESCUE PASS — 18 MAY 2026 ===");
  log(`Processing ${TARGETS.length} projects where Hunter verification failed`);
  log("Phone numbers excluded per policy\n");

  const results: {
    project: string;
    priority: string;
    sector: string;
    newContacts: number;
    emailsFound: number;
    status: string;
  }[] = [];

  let totalNewContacts = 0;
  let totalEmailsFound = 0;
  let blocked = 0;

  for (const target of TARGETS) {
    log(`[Apollo] → ${target.name} (ID: ${target.id}, ${target.priority}/${target.sector})`);
    try {
      const result = await enrichProjectContacts(target.id, REPORT_ID, {
        enrichEmails: true,
        maxPerCompany: 6,
      });

      const newContacts = result.totalFound || 0;
      const emailsFound = result.enrichCreditsUsed || 0;

      if (newContacts > 0 || emailsFound > 0) {
        log(`[Apollo] ✓ ${newContacts} new contacts, ${emailsFound} emails found`);
        results.push({ project: target.name, priority: target.priority, sector: target.sector, newContacts, emailsFound, status: "ok" });
        totalNewContacts += newContacts;
        totalEmailsFound += emailsFound;
      } else {
        log(`[Apollo] — No new contacts found`);
        results.push({ project: target.name, priority: target.priority, sector: target.sector, newContacts: 0, emailsFound: 0, status: "ok_empty" });
      }
    } catch (err: any) {
      log(`[Apollo] ✗ ERROR: ${err.message}`);
      results.push({ project: target.name, priority: target.priority, sector: target.sector, newContacts: 0, emailsFound: 0, status: `error: ${err.message}` });
    }
    await sleep(DELAY_MS);
  }

  log("\n=== APOLLO BUCKET B RESCUE SUMMARY ===");
  log(`Total new contacts found : ${totalNewContacts}`);
  log(`Total emails confirmed   : ${totalEmailsFound}`);
  log(`Blocked (govt/unknown)   : ${blocked}`);
  log("\nPer-project results:");
  for (const r of results) {
    const icon = r.newContacts > 0 ? "✓" : r.status === "blocked" ? "⊘" : r.status.startsWith("error") ? "✗" : "—";
    const detail = r.status === "blocked" ? `blocked` : `${r.newContacts} contacts, ${r.emailsFound} emails`;
    log(`  ${icon} [${r.priority}/${r.sector}] ${r.project}: ${detail}`);
  }
  log(`\nCompleted: ${new Date().toISOString()}`);
}

main().catch(err => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
