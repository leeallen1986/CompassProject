/**
 * Discovery Queue Validation
 * Tests: 5 hot projects, 5 ICN discovery-needed, 3 government-owned
 * Reports: before/after discoveryStatus, priority classification, owner routing
 */
import { getDb } from "../server/db";
import { queueDiscoveryForProject, backfillDiscoveryStatus, enforceHotProjectSLA } from "../server/discoveryQueue";
import { sql } from "drizzle-orm";

async function getUsableContactCount(db: any, projectId: number): Promise<number> {
  const result = await db.execute(sql.raw(`
    SELECT COUNT(DISTINCT c.id) as cnt
    FROM contactProjects cp
    JOIN contacts c ON c.id = cp.contactId
    WHERE cp.projectId = ${projectId}
      AND (c.roleBucket IS NULL OR c.roleBucket NOT REGEXP '^[0-9+() -]+$')
      AND (c.email IS NULL OR (c.email NOT LIKE '%portal.invoices%' AND c.email NOT LIKE '%atlascopco.com' AND c.email NOT LIKE '%noreply%' AND c.email NOT LIKE '%no-reply%'))
      AND c.enrichmentSource != 'manual'
  `)) as unknown as any[];
  const rows = Array.isArray(result[0]) ? result[0] : result;
  return Number((rows as any[])[0]?.cnt ?? 0);
}

async function main() {
  const db = await getDb();
  if (!db) { console.error("DB unavailable"); process.exit(1); }

  console.log("=== DISCOVERY QUEUE VALIDATION ===\n");

  // ── Step 1: Backfill discoveryStatus for all projects ──
  console.log("--- Step 1: Backfill discoveryStatus ---");
  const backfillResult = await backfillDiscoveryStatus();
  console.log(`Backfill: ${JSON.stringify(backfillResult)}\n`);

  // ── Step 2: Sample 5 hot projects ──
  console.log("--- Step 2: 5 Hot Projects ---");
  const [hotRows] = await db.execute(
    `SELECT id, name, owner, priority, location, discoveryStatus, discoveryPriority,
            enrichmentBlockedReason, projectCountry
     FROM projects
     WHERE priority = 'hot' AND projectCountry = 'AU'
       AND lifecycleStatus != 'archived'
     ORDER BY lastActivityAt DESC
     LIMIT 5`
  );
  const hotProjects = hotRows as any[];
  for (const p of hotProjects) {
    const usable = await getUsableContactCount(db, p.id);
    console.log(`  [${p.id}] ${p.name}`);
    console.log(`    Owner: ${p.owner || 'unknown'}`);
    console.log(`    Location: ${p.location || 'unknown'}`);
    console.log(`    Priority: ${p.priority}`);
    console.log(`    DiscoveryStatus: ${p.discoveryStatus || 'null'}`);
    console.log(`    DiscoveryPriority: ${p.discoveryPriority || 'null'}`);
    console.log(`    UsableContacts: ${usable}`);
    console.log(`    EnrichmentBlocked: ${p.enrichmentBlockedReason || 'none'}`);

    // Queue discovery
    const queued = await queueDiscoveryForProject(p.id, "validation_hot");
    console.log(`    QueueResult: ${queued ? 'QUEUED' : 'SKIPPED (already has contacts or blocked)'}`);
    console.log();
  }

  // ── Step 3: Sample 5 ICN discovery-needed projects ──
  console.log("--- Step 3: 5 ICN Discovery-Needed Projects ---");
  const [icnRows] = await db.execute(
    `SELECT id, name, owner, priority, location, discoveryStatus, discoveryPriority,
            enrichmentBlockedReason, projectCountry, lastIcnSeenAt
     FROM projects
     WHERE lastIcnSeenAt IS NOT NULL AND projectCountry = 'AU'
       AND lifecycleStatus != 'archived'
     ORDER BY lastActivityAt DESC
     LIMIT 20`
  );
  const icnProjects = icnRows as any[];
  const icnDiscoveryNeeded: any[] = [];
  for (const p of icnProjects) {
    if (icnDiscoveryNeeded.length >= 5) break;
    const usable = await getUsableContactCount(db, p.id);
    if (usable === 0) {
      icnDiscoveryNeeded.push({ ...p, usable });
    }
  }
  // If fewer than 5 with zero contacts, include some with low counts
  if (icnDiscoveryNeeded.length < 5) {
    for (const p of icnProjects) {
      if (icnDiscoveryNeeded.length >= 5) break;
      if (icnDiscoveryNeeded.find((d: any) => d.id === p.id)) continue;
      const usable = await getUsableContactCount(db, p.id);
      if (usable <= 3) {
        icnDiscoveryNeeded.push({ ...p, usable });
      }
    }
  }
  for (const p of icnDiscoveryNeeded) {
    console.log(`  [${p.id}] ${p.name}`);
    console.log(`    Owner: ${p.owner || 'unknown'}`);
    console.log(`    Location: ${p.location || 'unknown'}`);
    console.log(`    LastIcnSeen: ${p.lastIcnSeenAt}`);
    console.log(`    DiscoveryStatus: ${p.discoveryStatus || 'null'}`);
    console.log(`    DiscoveryPriority: ${p.discoveryPriority || 'null'}`);
    console.log(`    UsableContacts: ${p.usable}`);

    // Queue discovery
    const queued = await queueDiscoveryForProject(p.id, "validation_icn");
    console.log(`    QueueResult: ${queued ? 'QUEUED' : 'SKIPPED'}`);
    console.log();
  }

  // ── Step 4: Sample 3 government-owned projects ──
  console.log("--- Step 4: 3 Government-Owned Projects ---");
  const [govRows] = await db.execute(
    `SELECT id, name, owner, priority, location, discoveryStatus, discoveryPriority,
            enrichmentBlockedReason, projectCountry, govFallbackStatus
     FROM projects
     WHERE projectCountry = 'AU'
       AND lifecycleStatus != 'archived'
       AND (owner LIKE '%government%' OR owner LIKE '%department%' OR owner LIKE '%council%'
            OR owner LIKE '%state%' OR owner LIKE '%transport%' OR owner LIKE '%water%authority%'
            OR owner LIKE '%Main Roads%' OR owner LIKE '%infrastructure%australia%')
     ORDER BY lastActivityAt DESC
     LIMIT 3`
  );
  const govProjects = govRows as any[];
  for (const p of govProjects) {
    const usable = await getUsableContactCount(db, p.id);
    console.log(`  [${p.id}] ${p.name}`);
    console.log(`    Owner: ${p.owner || 'unknown'}`);
    console.log(`    Location: ${p.location || 'unknown'}`);
    console.log(`    Priority: ${p.priority}`);
    console.log(`    DiscoveryStatus: ${p.discoveryStatus || 'null'}`);
    console.log(`    DiscoveryPriority: ${p.discoveryPriority || 'null'}`);
    console.log(`    GovFallbackStatus: ${p.govFallbackStatus || 'null'}`);
    console.log(`    UsableContacts: ${usable}`);
    console.log(`    EnrichmentBlocked: ${p.enrichmentBlockedReason || 'none'}`);

    // Queue discovery
    const queued = await queueDiscoveryForProject(p.id, "validation_gov");
    console.log(`    QueueResult: ${queued ? 'QUEUED' : 'SKIPPED'}`);
    console.log();
  }

  // ── Step 5: Enforce Hot SLA ──
  console.log("--- Step 5: Hot Project SLA Enforcement ---");
  const slaResult = await enforceHotProjectSLA();
  console.log(`SLA result: ${JSON.stringify(slaResult)}\n`);

  // ── Step 6: Summary stats ──
  console.log("--- Step 6: Discovery Status Distribution ---");
  const [statusDist] = await db.execute(
    `SELECT discoveryStatus, discoveryPriority, COUNT(*) as cnt
     FROM projects
     WHERE projectCountry = 'AU' AND lifecycleStatus != 'archived'
     GROUP BY discoveryStatus, discoveryPriority
     ORDER BY cnt DESC`
  );
  for (const row of statusDist as any[]) {
    console.log(`  ${row.discoveryStatus || 'null'} / ${row.discoveryPriority || 'null'}: ${row.cnt}`);
  }

  // ── Step 7: Count how many moved from no_contacts to queued ──
  const [queuedCount] = await db.execute(
    `SELECT COUNT(*) as cnt FROM projects
     WHERE discoveryStatus = 'discovery_queued' AND projectCountry = 'AU'`
  );
  console.log(`\nTotal projects now queued for discovery: ${(queuedCount as any[])[0]?.cnt}`);

  const [sendReadyCount] = await db.execute(
    `SELECT COUNT(*) as cnt FROM projects
     WHERE discoveryStatus = 'send_ready_contact' AND projectCountry = 'AU'`
  );
  console.log(`Total projects with send-ready contacts: ${(sendReadyCount as any[])[0]?.cnt}`);

  const [noContactsCount] = await db.execute(
    `SELECT COUNT(*) as cnt FROM projects
     WHERE discoveryStatus = 'no_contacts' AND projectCountry = 'AU'
       AND lifecycleStatus != 'archived'`
  );
  console.log(`Total projects still no_contacts: ${(noContactsCount as any[])[0]?.cnt}`);

  console.log("\n=== VALIDATION COMPLETE ===");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
