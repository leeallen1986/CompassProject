/**
 * preThursdayEnrichment.ts
 *
 * Targeted pre-Thursday enrichment recovery pass.
 * Scope: tier1_actionable hot projects that are named_contact_no_email only.
 * Private-owner projects only (government/unknown owners are blocked from Apollo).
 *
 * Waterfall order:
 * 1. Apollo enrichProjectContacts — find new contacts + emails for private owners
 * 2. Hunter verifyProjectContactsWithHunter — verify/find emails for named_unverified contacts
 * 3. repairWaterfall promoteDiscoveryStatus — fix any remaining stale discoveryStatus flags
 *
 * Run: npx tsx server/scripts/preThursdayEnrichment.ts
 */

import "dotenv/config";
import { getDb } from "../db";
import { projects, contacts, contactProjects } from "../../drizzle/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { enrichProjectContacts } from "../apolloEnrichment";
import { verifyProjectContactsWithHunter } from "../hunterVerification";

const REPORT_ID = 900001; // Latest report ID
const DELAY_MS = 2000;

// Tier1 hot named_contact_no_email targets — private owners only
// Government/unknown owners are pre-filtered out (Apollo will block them anyway)
const TIER1_TARGETS = [
  { id: 690036, name: "2.1GWh BESS for Neoen", owner: "Neoen" },
  { id: 690029, name: "2.1GWh Battery Storage for Neoen", owner: "Neoen" },
  { id: 690089, name: "Cadia Gold Mine Operations", owner: "Newmont" },
  { id: 690037, name: "Fortescue 4-5GWh Battery Storage", owner: "Fortescue" },
  { id: 690006, name: "Muchea Battery Project", owner: "Western Australia (via UGL)" },
  { id: 660008, name: "Queensland Copper Mine Off-grid Renewable Hybrid", owner: "Queensland copper mine owner" },
  // Tier2 warm — include if credits remain
  { id: 690003, name: "Fortescue Green Energy Grid Project", owner: "Fortescue" },
  { id: 510004, name: "Renewable Energy for Aluminium Smelter", owner: "Rio Tinto" },
  { id: 690009, name: "Amazon Australia Renewable Energy PPAs", owner: "Amazon Australia" },
];

// Marinus Link (210028) has 94 contacts, 5 send_ready — skip Apollo, run Hunter only
const HUNTER_ONLY_TARGETS = [
  { id: 210028, name: "Marinus Link" },
  { id: 690036, name: "2.1GWh BESS for Neoen" },
  { id: 690029, name: "2.1GWh Battery Storage for Neoen" },
  { id: 690037, name: "Fortescue 4-5GWh Battery Storage" },
  { id: 690006, name: "Muchea Battery Project" },
  { id: 660008, name: "Queensland Copper Mine Off-grid Renewable Hybrid" },
  { id: 690089, name: "Cadia Gold Mine Operations" },
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function promoteStaleDiscoveryStatus(db: any): Promise<number> {
  log("[Repair] Promoting stale discoveryStatus for projects with send_ready contacts...");
  const [rows] = await db.execute(sql`
    SELECT DISTINCT p.id, p.name, p.discoveryStatus
    FROM projects p
    JOIN contactProjects cp ON cp.projectId = p.id
    JOIN contacts c ON c.id = cp.contactId
      AND c.contactTrustTier = 'send_ready'
      AND c.crmOrphan = 0
    WHERE p.discoveryStatus != 'send_ready_contact'
      AND p.priority = 'hot'
      AND p.suppressed = 0
      AND p.lifecycleStatus = 'active'
    GROUP BY p.id, p.name, p.discoveryStatus
  `) as any[];
  const stuckProjects = (Array.isArray(rows) ? rows : []) as any[];
  log(`[Repair] Found ${stuckProjects.length} projects to promote`);
  let promoted = 0;
  for (const row of stuckProjects) {
    await db.update(projects)
      .set({ discoveryStatus: "send_ready_contact" })
      .where(eq(projects.id, row.id));
    log(`[Repair] Promoted: "${row.name}" (${row.discoveryStatus} → send_ready_contact)`);
    promoted++;
  }
  return promoted;
}

async function main() {
  log("=== PRE-THURSDAY ENRICHMENT RECOVERY PASS ===");

  const db = await getDb();
  if (!db) {
    log("ERROR: Database not available");
    process.exit(1);
  }

  const apolloResults: { project: string; newContacts: number; emailsFound: number; status: string }[] = [];
  const hunterResults: { project: string; promoted: number; emailsFound: number; status: string }[] = [];

  // ── PHASE 1: Apollo enrichProjectContacts on tier1 targets ──
  log("\n=== PHASE 1: Apollo enrichment on tier1 named_contact_no_email targets ===");

  for (const target of TIER1_TARGETS) {
    log(`\n[Apollo] Processing: ${target.name} (ID: ${target.id})`);
    try {
      const result = await enrichProjectContacts(target.id, REPORT_ID, {
        enrichEmails: true,
        maxPerCompany: 8,
      });
      const newContacts = result.totalFound || 0;
      const emailsFound = result.enrichCreditsUsed || 0;
      log(`[Apollo] ${target.name}: ${newContacts} contacts found, ${emailsFound} emails enriched`);
      apolloResults.push({
        project: target.name,
        newContacts,
        emailsFound,
        status: "ok",
      });
    } catch (err: any) {
      log(`[Apollo] ERROR on ${target.name}: ${err.message}`);
      apolloResults.push({ project: target.name, newContacts: 0, emailsFound: 0, status: `error: ${err.message}` });
    }
    await sleep(DELAY_MS);
  }

  // ── PHASE 2: Hunter verification on named_unverified contacts ──
  log("\n=== PHASE 2: Hunter verification on named_unverified contacts ===");

  for (const target of HUNTER_ONLY_TARGETS) {
    log(`\n[Hunter] Processing: ${target.name} (ID: ${target.id})`);
    try {
      const result = await verifyProjectContactsWithHunter(target.id, 10);
      log(`[Hunter] ${target.name}: ${result.processed} processed, ${result.promoted} promoted, ${result.emailsFound} emails found`);
      hunterResults.push({
        project: target.name,
        promoted: result.promoted,
        emailsFound: result.emailsFound,
        status: "ok",
      });
    } catch (err: any) {
      log(`[Hunter] ERROR on ${target.name}: ${err.message}`);
      hunterResults.push({ project: target.name, promoted: 0, emailsFound: 0, status: `error: ${err.message}` });
    }
    await sleep(DELAY_MS);
  }

  // ── PHASE 3: Promote stale discoveryStatus flags ──
  log("\n=== PHASE 3: Promote stale discoveryStatus flags ===");
  const promoted = await promoteStaleDiscoveryStatus(db);
  log(`[Repair] ${promoted} projects promoted to send_ready_contact`);

  // ── SUMMARY ──
  log("\n=== ENRICHMENT RECOVERY SUMMARY ===");
  log("\nApollo Results:");
  for (const r of apolloResults) {
    log(`  ${r.project}: ${r.newContacts} new contacts, ${r.emailsFound} emails — ${r.status}`);
  }
  log("\nHunter Results:");
  for (const r of hunterResults) {
    log(`  ${r.project}: ${r.promoted} promoted, ${r.emailsFound} emails — ${r.status}`);
  }
  log(`\nStale flag cleanup: ${promoted} projects promoted`);
  log(`\nCompleted at: ${new Date().toISOString()}`);
}

main().catch(err => {
  log(`FATAL ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
