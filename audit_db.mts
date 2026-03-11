import { getDb } from './server/db.ts';
import { rssSources, rawArticles, projects, contacts, projectEnrichmentCache } from './drizzle/schema.ts';
import { desc, sql, count, eq } from 'drizzle-orm';

async function main() {
  const db = await getDb();

  // RSS Sources
  const sources = await db.select().from(rssSources).orderBy(desc(sql`errorCount`));
  console.log('=== RSS SOURCES ===');
  for (const s of sources) {
    const status = s.isActive ? (s.errorCount > 0 ? 'ERRORS' : 'OK') : 'INACTIVE';
    const lastFetch = s.lastFetchedAt ? new Date(s.lastFetchedAt).toISOString().slice(0,10) : 'NEVER';
    console.log(`[${status}] ${s.name} | errors:${s.errorCount} | last:${lastFetch} | ${s.url}`);
  }
  
  const activeCount = sources.filter(s => s.isActive).length;
  const inactiveCount = sources.filter(s => !s.isActive).length;
  const errorCount = sources.filter(s => s.isActive && s.errorCount > 0).length;
  const neverFetched = sources.filter(s => s.isActive && !s.lastFetchedAt).length;
  
  console.log(`\n--- RSS Summary ---`);
  console.log(`Active: ${activeCount}, Inactive: ${inactiveCount}, With errors: ${errorCount}, Never fetched: ${neverFetched}`);

  // Articles - use sql raw for enum comparison
  const [{ total: totalArticles }] = await db.select({ total: count() }).from(rawArticles);
  const [{ total: queuedArticles }] = await db.select({ total: count() }).from(rawArticles).where(sql`status = 'queued'`);
  const [{ total: extractedArticles }] = await db.select({ total: count() }).from(rawArticles).where(sql`status = 'extracted'`);
  const [{ total: skippedArticles }] = await db.select({ total: count() }).from(rawArticles).where(sql`status = 'skipped'`);
  const [{ total: failedArticles }] = await db.select({ total: count() }).from(rawArticles).where(sql`status = 'failed'`);
  const [{ total: pendingArticles }] = await db.select({ total: count() }).from(rawArticles).where(sql`status = 'pending'`);
  
  console.log(`\n=== RAW ARTICLES ===`);
  console.log(`Total: ${totalArticles} | Pending: ${pendingArticles} | Queued: ${queuedArticles} | Extracted: ${extractedArticles} | Skipped: ${skippedArticles} | Failed: ${failedArticles}`);

  // Projects
  const [{ total: totalProjects }] = await db.select({ total: count() }).from(projects);
  const [{ total: activeProjects }] = await db.select({ total: count() }).from(projects).where(sql`lifecycleStatus = 'active'`);
  const [{ total: staleProjects }] = await db.select({ total: count() }).from(projects).where(sql`lifecycleStatus = 'stale'`);
  const [{ total: archivedProjects }] = await db.select({ total: count() }).from(projects).where(sql`lifecycleStatus = 'archived'`);
  
  // Projects by source
  const projectsBySource = await db.select({ source: projects.source, total: count() }).from(projects).groupBy(projects.source);
  
  // Projects with contacts
  const projectsWithContacts = await db.select({ projectId: contacts.projectId }).from(contacts).groupBy(contacts.projectId);
  const projectsWithContactsCount = projectsWithContacts.length;
  
  console.log(`\n=== PROJECTS ===`);
  console.log(`Total: ${totalProjects} | Active: ${activeProjects} | Stale: ${staleProjects} | Archived: ${archivedProjects}`);
  console.log(`Projects with contacts: ${projectsWithContactsCount} / ${totalProjects} (${Math.round(projectsWithContactsCount/totalProjects*100)}%)`);
  console.log(`Projects WITHOUT contacts: ${totalProjects - projectsWithContactsCount}`);
  
  console.log(`\n--- Projects by Source ---`);
  for (const row of projectsBySource.sort((a,b) => b.total - a.total)) {
    console.log(`  ${row.source || 'unknown'}: ${row.total}`);
  }

  // Contacts
  const [{ total: totalContacts }] = await db.select({ total: count() }).from(contacts);
  const [{ total: verifiedContacts }] = await db.select({ total: count() }).from(contacts).where(sql`verificationStatus = 'verified'`);
  const [{ total: aiContacts }] = await db.select({ total: count() }).from(contacts).where(sql`verificationStatus = 'ai_suggested'`);
  const [{ total: apolloContacts }] = await db.select({ total: count() }).from(contacts).where(sql`enrichmentSource = 'apollo'`);
  const [{ total: linkedinContacts }] = await db.select({ total: count() }).from(contacts).where(sql`enrichmentSource = 'linkedin'`);
  const [{ total: llmContacts }] = await db.select({ total: count() }).from(contacts).where(sql`enrichmentSource = 'llm'`);
  const [{ total: contactsWithEmail }] = await db.select({ total: count() }).from(contacts).where(sql`email IS NOT NULL AND email != ''`);
  
  console.log(`\n=== CONTACTS ===`);
  console.log(`Total: ${totalContacts} | With email: ${contactsWithEmail} (${Math.round(contactsWithEmail/totalContacts*100)}%)`);
  console.log(`By source: Apollo=${apolloContacts}, LinkedIn=${linkedinContacts}, LLM=${llmContacts}`);
  console.log(`By verification: Verified=${verifiedContacts}, AI-suggested=${aiContacts}`);
  
  // Enrichment cache
  const [{ total: cachedProjects }] = await db.select({ total: count() }).from(projectEnrichmentCache);
  console.log(`\n=== ENRICHMENT CACHE ===`);
  console.log(`Projects with enrichment cache: ${cachedProjects}`);
  console.log(`Projects never enriched: ${totalProjects - cachedProjects}`);
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
