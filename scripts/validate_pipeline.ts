import { createConnection } from 'mysql2/promise';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set in environment');
  const db = await createConnection(dbUrl);

  // ---- 1. PIPELINE RUNS ----
  console.log('\n=== PIPELINE RUNS (last 5) ===');
  const [runs] = await db.query(
    `SELECT id, runType, status, startedAt, completedAt, 
      durationMs,
      feedsFetched, feedErrors, articlesIngested, articlesSkippedKeyword, articlesDuplicate,
      articlesExtracted, projectsCreated, projectsDuplicate,
      contactsEnriched, apolloCreditsUsed,
      projectoryProjects, govProjects, aemoProjects, dmirsProjects,
      triggeredBy
     FROM pipelineRuns ORDER BY startedAt DESC LIMIT 5`
  );
  console.log(JSON.stringify(runs, null, 2));

  // ---- 2. PROJECTS CREATED last 48h ----
  console.log('\n=== PROJECTS CREATED last 48h ===');
  const [np] = await db.query(
    `SELECT id, name, priority, sector, sourcePurpose, tenderNumber, tenderCloseDate,
      lifecycleStatus, actionTier, matchedBusinessLines, createdAt 
     FROM projects WHERE createdAt > DATE_SUB(NOW(), INTERVAL 48 HOUR) 
     ORDER BY createdAt DESC`
  );
  console.log(JSON.stringify(np, null, 2));

  // ---- 3. PROJECTS UPDATED last 48h (not new) ----
  console.log('\n=== PROJECTS UPDATED last 48h (not new) ===');
  const [up] = await db.query(
    `SELECT id, name, priority, sourcePurpose, lifecycleStatus, actionTier, updatedAt 
     FROM projects 
     WHERE updatedAt > DATE_SUB(NOW(), INTERVAL 48 HOUR) 
       AND createdAt < DATE_SUB(NOW(), INTERVAL 48 HOUR) 
     ORDER BY updatedAt DESC LIMIT 30`
  );
  console.log(JSON.stringify(up, null, 2));

  // ---- 4. CONTACTS CREATED last 48h ----
  console.log('\n=== CONTACTS CREATED last 48h ===');
  const [nc] = await db.query(
    `SELECT c.id, c.name, c.title, c.email, c.company, 
      c.enrichmentStatus, c.enrichmentSource, c.verificationStatus, c.createdAt, 
      p.name as proj, p.priority as projPriority
     FROM contacts c 
     LEFT JOIN projects p ON c.projectId = p.id 
     WHERE c.createdAt > DATE_SUB(NOW(), INTERVAL 48 HOUR) 
     ORDER BY c.createdAt DESC`
  );
  console.log(JSON.stringify(nc, null, 2));

  // ---- 5. EMAIL DIGESTS ----
  console.log('\n=== EMAIL DIGESTS (last 20) ===');
  try {
    const [dg] = await db.query(
      `SELECT ed.id, u.name as userName, u.email as userEmail, ed.sentAt, ed.itemCount, ed.digestType, ed.status 
       FROM emailDigests ed 
       LEFT JOIN users u ON ed.userId = u.id
       ORDER BY ed.sentAt DESC LIMIT 20`
    );
    console.log(JSON.stringify(dg, null, 2));
  } catch (e: any) {
    console.log('emailDigests query error:', e.message);
    const [tables] = await db.query(`SHOW TABLES LIKE '%igest%'`);
    console.log('Digest-related tables:', JSON.stringify(tables));
  }

  // ---- 6. USERS ----
  console.log('\n=== USERS ===');
  const [users] = await db.query(
    `SELECT id, name, email, role, createdAt FROM users ORDER BY createdAt`
  );
  console.log(JSON.stringify(users, null, 2));

  // ---- 7. DB TOTALS ----
  console.log('\n=== DB TOTALS ===');
  const [[totals]] = await db.query(
    `SELECT 
      (SELECT COUNT(*) FROM projects) as totalProjects, 
      (SELECT COUNT(*) FROM contacts) as totalContacts, 
      (SELECT COUNT(*) FROM rawArticles) as totalArticles, 
      (SELECT COUNT(*) FROM projects WHERE priority='hot') as hotProjects, 
      (SELECT COUNT(*) FROM projects WHERE priority='warm') as warmProjects, 
      (SELECT COUNT(*) FROM projects WHERE sourcePurpose='live_tender') as liveTenders,
      (SELECT COUNT(*) FROM projects WHERE sourcePurpose='live_tender' AND createdAt > DATE_SUB(NOW(), INTERVAL 48 HOUR)) as newTenders48h,
      (SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL AND email != '') as contactsWithEmail,
      (SELECT COUNT(*) FROM pipelineRuns) as totalRuns,
      (SELECT COUNT(*) FROM projects WHERE createdAt > DATE_SUB(NOW(), INTERVAL 48 HOUR)) as newProjects48h,
      (SELECT COUNT(*) FROM contacts WHERE createdAt > DATE_SUB(NOW(), INTERVAL 48 HOUR)) as newContacts48h,
      (SELECT COUNT(*) FROM projects WHERE actionTier='tier1_actionable') as tier1Projects,
      (SELECT COUNT(*) FROM projects WHERE lifecycleStatus='active') as activeProjects`
  ) as any;
  console.log(JSON.stringify(totals, null, 2));

  // ---- 8. PROJECTS WITH NO CONTACTS (created last 48h) ----
  console.log('\n=== PROJECTS WITH NO CONTACTS (created last 48h) ===');
  const [noContact] = await db.query(
    `SELECT p.id, p.name, p.sourcePurpose, p.priority, 
      p.enrichmentBlockedReason, p.govFallbackStatus, p.createdAt
     FROM projects p
     LEFT JOIN contacts c ON c.projectId = p.id
     WHERE p.createdAt > DATE_SUB(NOW(), INTERVAL 48 HOUR)
     GROUP BY p.id
     HAVING COUNT(c.id) = 0
     ORDER BY p.priority DESC, p.createdAt DESC`
  );
  console.log(JSON.stringify(noContact, null, 2));

  // ---- 9. ENRICHMENT BLOCK REASONS ----
  console.log('\n=== ENRICHMENT BLOCKED REASONS (all projects) ===');
  const [blocked] = await db.query(
    `SELECT enrichmentBlockedReason, COUNT(*) as count 
     FROM projects 
     WHERE enrichmentBlockedReason IS NOT NULL 
     GROUP BY enrichmentBlockedReason ORDER BY count DESC`
  );
  console.log(JSON.stringify(blocked, null, 2));

  // ---- 10. PROJECTS BY PRIORITY ----
  console.log('\n=== PROJECTS BY PRIORITY (current state) ===');
  const [byPriority] = await db.query(
    `SELECT priority, COUNT(*) as count FROM projects GROUP BY priority ORDER BY FIELD(priority,'hot','warm','cold')`
  );
  console.log(JSON.stringify(byPriority, null, 2));

  // ---- 11. PROJECTS BY SOURCE PURPOSE ----
  console.log('\n=== PROJECTS BY SOURCE PURPOSE ===');
  const [bySource] = await db.query(
    `SELECT sourcePurpose, COUNT(*) as count FROM projects GROUP BY sourcePurpose ORDER BY count DESC`
  );
  console.log(JSON.stringify(bySource, null, 2));

  // ---- 12. ENRICHMENT SOURCE BREAKDOWN ----
  console.log('\n=== ENRICHMENT SOURCE BREAKDOWN (all contacts) ===');
  const [enrichSrc] = await db.query(
    `SELECT enrichmentSource, enrichmentStatus, COUNT(*) as count 
     FROM contacts GROUP BY enrichmentSource, enrichmentStatus ORDER BY count DESC`
  );
  console.log(JSON.stringify(enrichSrc, null, 2));

  // ---- 13. ACTION TIER BREAKDOWN ----
  console.log('\n=== ACTION TIER BREAKDOWN ===');
  const [tiers] = await db.query(
    `SELECT actionTier, lifecycleStatus, COUNT(*) as count 
     FROM projects GROUP BY actionTier, lifecycleStatus ORDER BY count DESC`
  );
  console.log(JSON.stringify(tiers, null, 2));

  // ---- 14. LIVE TENDERS CLOSING SOON ----
  console.log('\n=== LIVE TENDERS CLOSING WITHIN 14 DAYS ===');
  const [closing] = await db.query(
    `SELECT id, name, tenderNumber, tenderCloseDate, priority, createdAt
     FROM projects 
     WHERE sourcePurpose = 'live_tender' 
       AND tenderCloseDate IS NOT NULL
       AND tenderCloseDate <= DATE_ADD(NOW(), INTERVAL 14 DAY)
       AND tenderCloseDate >= NOW()
     ORDER BY tenderCloseDate ASC LIMIT 20`
  );
  console.log(JSON.stringify(closing, null, 2));

  await db.end();
}

main().catch(console.error);
