import { createConnection } from 'mysql2/promise';

async function main() {
  const db = await createConnection(process.env.DATABASE_URL as string);

  // Contacts created last 48h
  console.log('\n=== CONTACTS CREATED last 48h ===');
  const [nc] = await db.query(`
    SELECT c.id, c.name, c.title, c.email, c.company, 
      c.enrichmentStatus, c.enrichmentSource, c.verificationStatus, c.createdAt
    FROM contacts c 
    WHERE c.createdAt > DATE_SUB(NOW(), INTERVAL 48 HOUR) 
    ORDER BY c.createdAt DESC
  `);
  console.log(JSON.stringify(nc, null, 2));

  // DB totals
  console.log('\n=== DB TOTALS ===');
  const [[t]] = await db.query(`
    SELECT 
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
      (SELECT COUNT(*) FROM projects WHERE lifecycleStatus='active') as activeProjects
  `) as any;
  console.log(JSON.stringify(t, null, 2));

  // Enrichment block reasons
  console.log('\n=== ENRICHMENT BLOCKED REASONS ===');
  const [blocked] = await db.query(`
    SELECT enrichmentBlockedReason, COUNT(*) as count 
    FROM projects 
    WHERE enrichmentBlockedReason IS NOT NULL 
    GROUP BY enrichmentBlockedReason ORDER BY count DESC
  `);
  console.log(JSON.stringify(blocked, null, 2));

  // Projects by priority
  console.log('\n=== PROJECTS BY PRIORITY ===');
  const [byP] = await db.query(`SELECT priority, COUNT(*) as count FROM projects GROUP BY priority ORDER BY FIELD(priority,'hot','warm','cold')`);
  console.log(JSON.stringify(byP, null, 2));

  // Projects by source purpose
  console.log('\n=== PROJECTS BY SOURCE PURPOSE ===');
  const [byS] = await db.query(`SELECT sourcePurpose, COUNT(*) as count FROM projects GROUP BY sourcePurpose ORDER BY count DESC`);
  console.log(JSON.stringify(byS, null, 2));

  // Enrichment source breakdown
  console.log('\n=== ENRICHMENT SOURCE BREAKDOWN ===');
  const [eS] = await db.query(`SELECT enrichmentSource, enrichmentStatus, COUNT(*) as count FROM contacts GROUP BY enrichmentSource, enrichmentStatus ORDER BY count DESC`);
  console.log(JSON.stringify(eS, null, 2));

  // Action tier breakdown
  console.log('\n=== ACTION TIER BREAKDOWN ===');
  const [tiers] = await db.query(`SELECT actionTier, lifecycleStatus, COUNT(*) as count FROM projects GROUP BY actionTier, lifecycleStatus ORDER BY count DESC`);
  console.log(JSON.stringify(tiers, null, 2));

  // Live tenders closing soon
  console.log('\n=== LIVE TENDERS CLOSING WITHIN 14 DAYS ===');
  const [closing] = await db.query(`
    SELECT id, name, tenderNumber, tenderCloseDate, priority, createdAt
    FROM projects 
    WHERE sourcePurpose = 'live_tender' 
      AND tenderCloseDate IS NOT NULL
      AND tenderCloseDate <= DATE_ADD(NOW(), INTERVAL 14 DAY)
      AND tenderCloseDate >= NOW()
    ORDER BY tenderCloseDate ASC LIMIT 20
  `);
  console.log(JSON.stringify(closing, null, 2));

  // Email digest tables check
  console.log('\n=== DIGEST TABLES ===');
  const [tables] = await db.query(`SHOW TABLES LIKE '%igest%'`);
  console.log(JSON.stringify(tables, null, 2));

  // Users
  console.log('\n=== USERS ===');
  const [users] = await db.query(`SELECT id, name, email, role, createdAt FROM users ORDER BY createdAt`);
  console.log(JSON.stringify(users, null, 2));

  // Gov fallback status breakdown
  console.log('\n=== GOV FALLBACK STATUS ===');
  const [govFb] = await db.query(`
    SELECT govFallbackStatus, COUNT(*) as count 
    FROM projects 
    WHERE govFallbackStatus IS NOT NULL 
    GROUP BY govFallbackStatus ORDER BY count DESC
  `);
  console.log(JSON.stringify(govFb, null, 2));

  await db.end();
}

main().catch(console.error);
