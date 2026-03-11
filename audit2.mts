import { getDb } from './server/db.ts';
import { rssSources, rawArticles, projects, contacts, contactProjects, projectEnrichmentCache } from './drizzle/schema.ts';
import { sql, count } from 'drizzle-orm';

async function main() {
  const db = await getDb();

  // Get project source distribution via reports
  const projectsByReport = await db.execute(sql`
    SELECT r.id, r.weekEnding, COUNT(p.id) as projectCount 
    FROM reports r 
    LEFT JOIN projects p ON p.reportId = r.id 
    GROUP BY r.id, r.weekEnding 
    ORDER BY r.id DESC 
    LIMIT 20
  `);
  console.log('=== PROJECTS BY REPORT ===');
  console.log(JSON.stringify(projectsByReport[0], null, 2));

  // Total projects
  const [{ total: totalProjects }] = await db.select({ total: count() }).from(projects);
  const [{ total: activeProjects }] = await db.select({ total: count() }).from(projects).where(sql`lifecycleStatus = 'active'`);
  const [{ total: staleProjects }] = await db.select({ total: count() }).from(projects).where(sql`lifecycleStatus = 'stale'`);
  const [{ total: archivedProjects }] = await db.select({ total: count() }).from(projects).where(sql`lifecycleStatus = 'archived'`);
  
  console.log(`\n=== PROJECTS ===`);
  console.log(`Total: ${totalProjects} | Active: ${activeProjects} | Stale: ${staleProjects} | Archived: ${archivedProjects}`);

  // Projects with contacts via contactProjects junction
  const projectsWithContactsResult = await db.execute(sql`SELECT COUNT(DISTINCT projectId) as cnt FROM contactProjects`);
  const pwc = (projectsWithContactsResult[0] as any[])[0]?.cnt || 0;
  console.log(`Projects with contacts (via junction): ${pwc} / ${totalProjects} (${Math.round(pwc/totalProjects*100)}%)`);
  console.log(`Projects WITHOUT contacts: ${totalProjects - pwc}`);

  // Contacts breakdown
  const [{ total: totalContacts }] = await db.select({ total: count() }).from(contacts);
  const contactStats = await db.execute(sql`
    SELECT 
      enrichmentSource, 
      verificationStatus,
      COUNT(*) as cnt,
      SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) as withEmail
    FROM contacts 
    GROUP BY enrichmentSource, verificationStatus
    ORDER BY cnt DESC
  `);
  console.log(`\n=== CONTACTS (Total: ${totalContacts}) ===`);
  console.log(JSON.stringify((contactStats[0] as any[]), null, 2));

  // Enrichment cache
  const [{ total: cachedProjects }] = await db.select({ total: count() }).from(projectEnrichmentCache);
  console.log(`\n=== ENRICHMENT CACHE ===`);
  console.log(`Projects with enrichment cache: ${cachedProjects}`);
  console.log(`Projects never enriched: ${totalProjects - cachedProjects}`);

  // Raw articles
  const articleStats = await db.execute(sql`SELECT status, COUNT(*) as cnt FROM rawArticles GROUP BY status`);
  console.log(`\n=== RAW ARTICLES ===`);
  console.log(JSON.stringify((articleStats[0] as any[]), null, 2));

  // RSS sources with errors (correct column: feedUrl)
  const rssErrors = await db.execute(sql`SELECT name, feedUrl, errorCount, lastFetchedAt FROM rssSources WHERE errorCount > 0 ORDER BY errorCount DESC`);
  console.log(`\n=== RSS SOURCES WITH ERRORS ===`);
  console.log(JSON.stringify((rssErrors[0] as any[]), null, 2));

  // All RSS sources
  const allRss = await db.execute(sql`SELECT name, feedUrl, isActive, errorCount, lastFetchedAt, lastFetchCount FROM rssSources ORDER BY errorCount DESC, name ASC`);
  console.log(`\n=== ALL RSS SOURCES ===`);
  console.log(JSON.stringify((allRss[0] as any[]), null, 2));

  // Projects by sector
  const bySector = await db.execute(sql`SELECT sector, COUNT(*) as cnt FROM projects GROUP BY sector ORDER BY cnt DESC`);
  console.log(`\n=== PROJECTS BY SECTOR ===`);
  console.log(JSON.stringify((bySector[0] as any[]), null, 2));

  // Projects by priority
  const byPriority = await db.execute(sql`SELECT priority, COUNT(*) as cnt FROM projects GROUP BY priority ORDER BY cnt DESC`);
  console.log(`\n=== PROJECTS BY PRIORITY ===`);
  console.log(JSON.stringify((byPriority[0] as any[]), null, 2));

  // Business lines
  const businessLines = await db.execute(sql`SELECT id, name, isActive FROM businessLines ORDER BY id`);
  console.log(`\n=== BUSINESS LINES ===`);
  console.log(JSON.stringify((businessLines[0] as any[]), null, 2));

  // Projects with no business line tags
  const noBlProjects = await db.execute(sql`SELECT COUNT(*) as cnt FROM projects WHERE matchedBusinessLines IS NULL OR matchedBusinessLines = '[]' OR matchedBusinessLines = 'null'`);
  console.log(`\nProjects with NO business line tag: ${(noBlProjects[0] as any[])[0]?.cnt}`);

  // Apollo credit log
  const apolloStats = await db.execute(sql`SELECT action, COUNT(*) as cnt, SUM(creditsUsed) as totalCredits FROM apolloCreditLog GROUP BY action ORDER BY cnt DESC`);
  console.log(`\n=== APOLLO CREDIT USAGE ===`);
  console.log(JSON.stringify((apolloStats[0] as any[]), null, 2));

  // Scraper sources breakdown - check what reports have what data
  const scraperBreakdown = await db.execute(sql`
    SELECT 
      CASE 
        WHEN name LIKE '%Projectory%' THEN 'Projectory'
        WHEN name LIKE '%DMIRS%' OR name LIKE '%MINEDEX%' THEN 'DMIRS'
        WHEN name LIKE '%AEMO%' THEN 'AEMO'
        WHEN name LIKE '%AusTender%' THEN 'AusTender'
        WHEN name LIKE '%ICN%' THEN 'ICN'
        WHEN name LIKE '%Gov%' OR name LIKE '%Infrastructure%' THEN 'Gov'
        ELSE 'RSS/Other'
      END as scraperType,
      COUNT(*) as projectCount
    FROM projects p
    JOIN reports r ON p.reportId = r.id
    GROUP BY scraperType
    ORDER BY projectCount DESC
  `);
  console.log(`\n=== PROJECTS BY SCRAPER TYPE (via report name) ===`);
  console.log(JSON.stringify((scraperBreakdown[0] as any[]), null, 2));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
