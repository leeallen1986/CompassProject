/**
 * Fix stuck discovery queue projects and run targeted O&G enrichment pass.
 *
 * Problem 1: 28 Priority A projects have discoveryAttempts=3 but lastDiscoveryAt=NULL.
 * The queue query requires: attempts < 3 OR lastDiscoveryAt < 72h ago.
 * These projects fail both conditions so they never re-enter the queue.
 * Fix: reset discoveryAttempts to 0 and set lastDiscoveryAt to 4 days ago so they
 * immediately qualify on the next run.
 *
 * Problem 2: O&G projects (Scarborough, Gorgon, Pluto LNG, Barossa etc.) have
 * named_unverified contacts that need Apollo email reveal to become send_ready.
 * Fix: force Apollo enrichment on these specific high-value O&G projects.
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { enrichProjectContacts } from "../server/apolloEnrichment";

async function run() {
  const db = await getDb();

  // ── Fix 1: Reset stuck projects ──
  console.log("\n=== Fix 1: Resetting stuck Priority A projects ===");
  const stuckResult = await db.execute(sql`
    UPDATE projects p
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    SET p.discoveryAttempts = 0,
        p.lastDiscoveryAt = DATE_SUB(NOW(), INTERVAL 5 DAY)
    WHERE (p.projectState = 'WA' OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 70
      AND p.discoveryStatus = 'discovery_queued'
      AND p.discoveryPriority = 'A'
      AND p.discoveryAttempts >= 3
      AND p.lastDiscoveryAt IS NULL
  `);
  console.log("Stuck projects reset:", (stuckResult as any)[0]?.affectedRows ?? 0);

  // Also reset for ALL WA projects (not just PA>=70) to clear the full backlog
  const stuckAllResult = await db.execute(sql`
    UPDATE projects
    SET discoveryAttempts = 0,
        lastDiscoveryAt = DATE_SUB(NOW(), INTERVAL 5 DAY)
    WHERE discoveryStatus = 'discovery_queued'
      AND discoveryPriority = 'A'
      AND discoveryAttempts >= 3
      AND lastDiscoveryAt IS NULL
  `);
  console.log("All stuck Priority A projects reset:", (stuckAllResult as any)[0]?.affectedRows ?? 0);

  // ── Fix 2: Verify queue eligibility after reset ──
  console.log("\n=== Verify: Priority A queue eligibility after reset ===");
  const eligible = await db.execute(sql`
    SELECT COUNT(*) as cnt
    FROM projects p
    WHERE p.discoveryStatus IN ('no_contacts', 'discovery_queued', 'role_only', 'named_contact_no_email')
      AND (p.geoBlockedReason IS NULL)
      AND (p.projectCountry = 'AU' OR p.projectCountry IS NULL)
      AND (p.suppressed = false OR p.suppressed IS NULL)
      AND (p.projectType = 'opportunity' OR p.projectType IS NULL)
      AND p.matchedBusinessLines IS NOT NULL
      AND JSON_LENGTH(p.matchedBusinessLines) > 0
      AND (p.discoveryAttempts < 3 OR p.discoveryAttempts IS NULL)
      AND (
        p.lastDiscoveryAt IS NULL
        OR p.lastDiscoveryAt < DATE_SUB(NOW(), INTERVAL 72 HOUR)
      )
      AND p.discoveryPriority = 'A'
  `);
  console.log("Priority A projects now eligible for next run:", (eligible as any)[0][0].cnt);

  // ── Fix 3: O&G Apollo enrichment pass ──
  console.log("\n=== Fix 3: O&G Apollo enrichment pass ===");

  // Get the latest report ID
  const [reportRowsRaw] = (await db.execute(sql`
    SELECT id FROM reports ORDER BY id DESC LIMIT 1
  `)) as any[];
  const reportId = (reportRowsRaw as any[])?.[0]?.id || 1;

  // Target O&G projects with named_unverified contacts that need Apollo email reveal
  const ogProjects = await db.execute(sql`
    SELECT DISTINCT p.id, p.name, p.sector, p.owner,
           COUNT(DISTINCT c.id) as total_contacts,
           SUM(CASE WHEN c.contactTrustTier = 'named_unverified' THEN 1 ELSE 0 END) as unverified_contacts,
           SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) as send_ready_contacts
    FROM projects p
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    LEFT JOIN contactProjects cp ON cp.projectId = p.id
    LEFT JOIN contacts c ON c.id = cp.contactId
    WHERE (p.projectState IN ('WA','OFFSHORE_AU') OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 60
      AND p.lifecycleStatus = 'active'
      AND (p.sector = 'oil_gas'
           OR p.name LIKE '%Woodside%' OR p.name LIKE '%Santos%'
           OR p.name LIKE '%Chevron%' OR p.name LIKE '%Strike%'
           OR p.name LIKE '%FPSO%' OR p.name LIKE '%Barossa%'
           OR p.name LIKE '%Scarborough%' OR p.name LIKE '%Gorgon%'
           OR p.name LIKE '%Pluto%' OR p.name LIKE '%NWS%' OR p.name LIKE '%Prelude%')
    GROUP BY p.id, p.name, p.sector, p.owner
    ORDER BY pbls.score DESC
  `);

  const ogRows = (ogProjects as any)[0] as any[];
  console.log(`Found ${ogRows.length} O&G projects for Apollo enrichment pass`);

  let totalNewSendReady = 0;
  let apolloCreditsUsed = 0;

  for (const proj of ogRows) {
    // Check Apollo budget before each project
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [budgetRow] = await db
      .select({ total: sql<number>`COALESCE(SUM(creditsUsed), 0)` })
      .from(sql`apolloCreditLog`)
      .where(sql`createdAt >= ${today}`) as any;
    const dailyUsed = Number(budgetRow?.total ?? 0);
    if (dailyUsed >= 50) {
      console.log(`Apollo daily cap reached (${dailyUsed}/50) — stopping O&G pass`);
      break;
    }

    console.log(`\n  Processing: ${proj.name.substring(0, 60)}`);
    console.log(`    Contacts: ${proj.total_contacts} total, ${proj.unverified_contacts} unverified, ${proj.send_ready_contacts} send_ready`);

    try {
      const result = await enrichProjectContacts(proj.id, reportId, {
        enrichEmails: true,
        maxPerCompany: 8, // Higher cap for O&G
      });
      const newSendReady = result.people.filter((p: any) => p.status === "enriched").length;
      totalNewSendReady += newSendReady;
      apolloCreditsUsed += result.enrichCreditsUsed || 0;
      console.log(`    Apollo result: ${result.people.length} people found, ${newSendReady} enriched, ${result.enrichCreditsUsed} credits used`);
    } catch (e: any) {
      console.warn(`    Apollo failed: ${e.message}`);
    }
  }

  console.log(`\n=== O&G enrichment summary ===`);
  console.log(`  Projects processed: ${ogRows.length}`);
  console.log(`  New send_ready contacts: ${totalNewSendReady}`);
  console.log(`  Apollo credits used: ${apolloCreditsUsed}`);

  // ── Final state check ──
  console.log("\n=== Final state ===");
  const finalSendReady = await db.execute(sql`
    SELECT COUNT(DISTINCT c.id) as cnt
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    JOIN projects p ON p.id = cp.projectId
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    WHERE (p.projectState = 'WA' OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 60
      AND c.email IS NOT NULL AND c.email != ''
      AND (c.contactTrustTier IS NULL OR c.contactTrustTier != 'llm_inferred')
  `);
  console.log("Send-ready contacts:", (finalSendReady as any)[0][0].cnt);

  const finalSendReadyProjects = await db.execute(sql`
    SELECT COUNT(DISTINCT p.id) as cnt
    FROM projects p
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    WHERE (p.projectState = 'WA' OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 60
      AND p.lifecycleStatus = 'active'
      AND EXISTS (
        SELECT 1 FROM contactProjects cp
        JOIN contacts c ON c.id = cp.contactId
        WHERE cp.projectId = p.id AND c.email IS NOT NULL AND c.email != ''
        AND (c.contactTrustTier IS NULL OR c.contactTrustTier != 'llm_inferred')
      )
  `);
  console.log("Send-ready WA projects:", (finalSendReadyProjects as any)[0][0].cnt);

  const finalRyanDigest = await db.execute(sql`
    SELECT COUNT(DISTINCT p.id) as cnt
    FROM projects p
    JOIN projectBusinessLineScores pbls ON pbls.projectId = p.id
    WHERE (p.projectState = 'WA' OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
      AND pbls.scoringDimension = 'Portable Air'
      AND pbls.score >= 70
      AND p.lifecycleStatus = 'active'
      AND EXISTS (
        SELECT 1 FROM contactProjects cp
        JOIN contacts c ON c.id = cp.contactId
        WHERE cp.projectId = p.id AND c.email IS NOT NULL AND c.email != ''
        AND (c.contactTrustTier IS NULL OR c.contactTrustTier != 'llm_inferred')
      )
  `);
  console.log("Ryan digest-safe projects (PA>=70):", (finalRyanDigest as any)[0][0].cnt);

  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
