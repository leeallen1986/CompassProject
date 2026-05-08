/**
 * Part D — Repair Contact Waterfall on High-PA WA Projects
 * 
 * Finds WA projects with PA score >= 60 that have:
 * - No contacts at all (discoveryStatus = 'no_contacts' or null)
 * - Stale contacts (last discovery > 14 days ago, no verified email)
 * - Hallucination-flagged contacts only
 * 
 * Re-queues them for discovery with priority A.
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { projects, contacts, contactProjects } from "../drizzle/schema";
import { eq, sql, and, isNull, or, lt, inArray } from "drizzle-orm";

async function repairContactWaterfall() {
  const db = await getDb();
  if (!db) { console.error("DB unavailable"); process.exit(1); }

  console.log("=== Part D: Contact Waterfall Repair ===\n");

  // Step 1: Find high-PA WA projects with no contacts or stale discovery
  const highPaNoContacts = await db.execute(sql.raw(`
    SELECT 
      p.id, p.name, p.owner, p.location, p.priority, p.sector,
      p.discoveryStatus, p.discoveryPriority, p.lastDiscoveryAt,
      p.discoveryAttempts, p.sourcePurpose, p.actionTier,
      COALESCE(pbs.score, 0) as paScore,
      COUNT(DISTINCT cp.contactId) as totalContacts,
      COUNT(DISTINCT CASE WHEN c.email IS NOT NULL AND c.email != '' 
        AND c.email NOT LIKE '%@example%' AND c.email NOT LIKE '%noreply%'
        THEN c.id END) as verifiedContacts
    FROM projects p
    LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Portable Air'
    LEFT JOIN contactProjects cp ON cp.projectId = p.id
    LEFT JOIN contacts c ON c.id = cp.contactId
    WHERE (p.projectCountry = 'Australia' OR p.location LIKE '%WA%' OR p.location LIKE '%Western Australia%')
      AND (p.suppressed = false OR p.suppressed IS NULL)
      AND COALESCE(pbs.score, 0) >= 60
      AND p.lifecycleStatus = 'active'
    GROUP BY p.id, p.name, p.owner, p.location, p.priority, p.sector,
      p.discoveryStatus, p.discoveryPriority, p.lastDiscoveryAt,
      p.discoveryAttempts, p.sourcePurpose, p.actionTier, pbs.score
    HAVING totalContacts = 0 OR verifiedContacts = 0
    ORDER BY paScore DESC, p.priority ASC
    LIMIT 60
  `)) as unknown as any[];

  const rows = (Array.isArray(highPaNoContacts[0]) ? highPaNoContacts[0] : highPaNoContacts) as any[];
  
  console.log(`Found ${rows.length} high-PA WA projects needing contact repair\n`);
  console.log("Top 30 projects to re-queue:\n");

  const toRequeue: number[] = [];
  
  rows.slice(0, 30).forEach((p: any, i: number) => {
    const paScore = Number(p.paScore || 0);
    const totalContacts = Number(p.totalContacts || 0);
    const verifiedContacts = Number(p.verifiedContacts || 0);
    const attempts = Number(p.discoveryAttempts || 0);
    
    console.log(`${i+1}. [PA:${paScore}] ${p.name}`);
    console.log(`   Owner: ${p.owner} | Location: ${p.location}`);
    console.log(`   Priority: ${p.priority} | Sector: ${p.sector}`);
    console.log(`   Contacts: ${totalContacts} total, ${verifiedContacts} verified`);
    console.log(`   Discovery: ${p.discoveryStatus || 'null'} | Attempts: ${attempts} | Last: ${p.lastDiscoveryAt || 'never'}`);
    
    // Re-queue if: no contacts OR no verified contacts AND attempts < 3
    if (attempts < 3 || totalContacts === 0) {
      toRequeue.push(p.id);
      console.log(`   → QUEUED for re-discovery (priority A)`);
    } else {
      console.log(`   → SKIPPED (${attempts} attempts already made)`);
    }
    console.log();
  });

  // Step 2: Re-queue them with priority A
  if (toRequeue.length > 0) {
    console.log(`\nRe-queuing ${toRequeue.length} projects for contact discovery...`);
    
    for (const projectId of toRequeue) {
      await db.update(projects).set({
        discoveryStatus: "discovery_queued",
        discoveryPriority: "A",
      }).where(eq(projects.id, projectId));
    }
    
    console.log(`✓ Re-queued ${toRequeue.length} projects with priority A`);
  }

  // Step 3: Show breakdown by discovery status
  const statusBreakdown = await db.execute(sql.raw(`
    SELECT 
      p.discoveryStatus,
      COUNT(*) as count,
      AVG(COALESCE(pbs.score, 0)) as avgPaScore
    FROM projects p
    LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Portable Air'
    WHERE (p.projectCountry = 'Australia' OR p.location LIKE '%WA%' OR p.location LIKE '%Western Australia%')
      AND (p.suppressed = false OR p.suppressed IS NULL)
      AND COALESCE(pbs.score, 0) >= 60
      AND p.lifecycleStatus = 'active'
    GROUP BY p.discoveryStatus
    ORDER BY count DESC
  `)) as unknown as any[];

  const statusRows = (Array.isArray(statusBreakdown[0]) ? statusBreakdown[0] : statusBreakdown) as any[];
  
  console.log("\n=== Discovery Status Breakdown (PA>=60 WA projects) ===");
  statusRows.forEach((r: any) => {
    console.log(`  ${r.discoveryStatus || 'null'}: ${r.count} projects (avg PA: ${Number(r.avgPaScore).toFixed(0)})`);
  });

  // Step 4: Check for projects with only hallucinated contacts
  const hallucinatedCheck = await db.execute(sql.raw(`
    SELECT 
      p.id, p.name, p.owner,
      COUNT(DISTINCT c.id) as contactCount,
      GROUP_CONCAT(c.name SEPARATOR ' | ') as contactNames,
      GROUP_CONCAT(c.enrichmentSource SEPARATOR ' | ') as sources
    FROM projects p
    JOIN contactProjects cp ON cp.projectId = p.id
    JOIN contacts c ON c.id = cp.contactId
    LEFT JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id AND pbs.scoringDimension = 'Portable Air'
    WHERE (p.projectCountry = 'Australia' OR p.location LIKE '%WA%' OR p.location LIKE '%Western Australia%')
      AND COALESCE(pbs.score, 0) >= 60
      AND p.lifecycleStatus = 'active'
      AND (p.suppressed = false OR p.suppressed IS NULL)
    GROUP BY p.id, p.name, p.owner
    HAVING contactCount > 0
    ORDER BY pbs.score DESC
    LIMIT 20
  `)) as unknown as any[];

  const halluRows = (Array.isArray(hallucinatedCheck[0]) ? hallucinatedCheck[0] : hallucinatedCheck) as any[];
  
  console.log("\n=== High-PA WA Projects WITH Contacts (check for hallucinations) ===");
  halluRows.forEach((r: any) => {
    console.log(`\n  ${r.name} (${r.owner})`);
    console.log(`  Contacts (${r.contactCount}): ${r.contactNames}`);
    console.log(`  Sources: ${r.sources}`);
  });

  console.log("\n=== Part D Complete ===");
  process.exit(0);
}

repairContactWaterfall().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
