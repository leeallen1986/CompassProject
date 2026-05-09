/**
 * Second Apollo enrichment pass — after domain inference fixes
 * Targets the companies that previously failed due to wrong domains
 */
import { enrichProjectContacts } from '../server/apolloEnrichment';
import { getDb, getLatestReport } from '../server/db';
import { sql } from 'drizzle-orm';

const TARGETS = [
  // Ryan — WA mining companies with now-correct domains
  { rep: 'Ryan', project: 'Mulgine Trench Project' },
  { rep: 'Ryan', project: 'United North Underground Gold Mine' },
  { rep: 'Ryan', project: 'Peak Hill Gold Project Acquisition & Development' },
  // Amit — BESS companies with now-correct domains
  { rep: 'Amit', project: 'Richmond Valley Solar and BESS' },
  { rep: 'Amit', project: 'Armidale East BESS' },
  { rep: 'Amit', project: 'Burroway Solar Farm and BESS' },
  // Dan Day — projects with private owners
  { rep: 'Dan Day', project: 'Mersey-Forth Hydropower Scheme Upgrade' },
  // Brett — projects with private owners  
  { rep: 'Brett', project: 'Large-Scale Iron Ore Processing Development' },
];

async function main() {
  const db = await getDb();
  if (!db) throw new Error('No database');
  const report = await getLatestReport();
  if (!report) throw new Error('No report');

  console.log('# PART B — Apollo Enrichment Pass 2 (Domain Fixes)\n');
  console.log('| # | Rep | Project | Owner | Domain | Contacts | Credits |');
  console.log('|---|-----|---------|-------|--------|----------|---------|');

  let totalContacts = 0;
  let totalCredits = 0;

  for (let i = 0; i < TARGETS.length; i++) {
    const t = TARGETS[i];
    const projectResult = await db.execute(sql`
      SELECT id, name, owner FROM projects WHERE name LIKE ${t.project + '%'} AND suppressed = 0 LIMIT 1
    `);
    const rows = projectResult[0] as any[];
    if (rows.length === 0) {
      console.log(`| ${i+1} | ${t.rep} | ${t.project.substring(0,40)} | — | — | NOT FOUND | 0 |`);
      continue;
    }
    const project = rows[0];
    
    try {
      const result = await enrichProjectContacts(project.id, report.id, {
        enrichEmails: true,
        maxPerCompany: 3,
      });
      const enriched = result.people.filter(p => (p as any).status === 'enriched').length;
      totalContacts += enriched;
      totalCredits += result.enrichCreditsUsed;
      const status = enriched > 0 ? `✅ ${enriched}` : `⚠️ ${result.people.length} searched`;
      console.log(`| ${i+1} | ${t.rep} | ${project.name.substring(0,40)} | ${(project.owner||'').substring(0,20)} | inferred | ${status} | ${result.enrichCreditsUsed} |`);
    } catch (err: any) {
      console.log(`| ${i+1} | ${t.rep} | ${project.name.substring(0,40)} | ${(project.owner||'').substring(0,20)} | — | ERROR: ${err.message.substring(0,30)} | 0 |`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n## Summary: ${totalContacts} contacts enriched, ${totalCredits} credits used`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
