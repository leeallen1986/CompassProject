/**
 * Targeted Apollo enrichment for Monday priority rep projects
 * Only enriches projects that are in the top 5 for a priority rep and have zero contacts
 */
import { enrichProjectContacts } from '../server/apolloEnrichment';
import { getDb, getLatestReport } from '../server/db';
import { sql } from 'drizzle-orm';

const ENRICHMENT_TARGETS = [
  // Ryan Pemberton — PA WA — top 3 all zero contacts
  { rep: 'Ryan Pemberton', projectName: 'United North Underground Gold Mine' },
  { rep: 'Ryan Pemberton', projectName: 'Design and Construct - Beckenham Depot - Workshop Building' },
  { rep: 'Ryan Pemberton', projectName: 'Peak Hill Gold Project Acquisition & Development' },
  // Daniel Zec — PA NSW/VIC — top 3 have named_unverified but no send_ready
  { rep: 'Daniel Zec', projectName: 'North East Link Program' },
  { rep: 'Daniel Zec', projectName: 'Sydney Metro West' },
  { rep: 'Daniel Zec', projectName: 'Suburban Rail Loop (SRL) East' },
  // Brett Hansen — Pump WA/NT — #1 has no contacts
  { rep: 'Brett Hansen', projectName: 'Jurien Bay Water Supply Strengthening Project' },
  { rep: 'Brett Hansen', projectName: 'Supply of Materials for Drainage Works on State Roads' },
  // Dan Day — Pump SA/QLD/VIC/NSW/TAS — top projects with no contacts
  { rep: 'Dan Day', projectName: 'Mersey-Forth Hydropower Scheme Upgrade (Tarraleah)' },
  { rep: 'Dan Day', projectName: 'Southern Queensland Water Infrastructure' },
  // Amit Bhargava — BESS National — top projects with no contacts
  { rep: 'Amit Bhargava', projectName: 'Richmond Valley Solar and BESS' },
  { rep: 'Amit Bhargava', projectName: 'Armidale East BESS' },
  { rep: 'Amit Bhargava', projectName: 'Burroway Solar Farm and BESS' },
];

async function main() {
  const db = await getDb();
  if (!db) throw new Error('No database');
  
  const report = await getLatestReport();
  if (!report) throw new Error('No report found');
  const reportId = report.id;

  console.log(`# PART B — Targeted Apollo Enrichment\n`);
  console.log(`Using report ID: ${reportId}`);
  console.log(`Targets: ${ENRICHMENT_TARGETS.length} projects\n`);
  console.log('| # | Rep | Project | Owner | Result | Contacts Found | Credits |');
  console.log('|---|-----|---------|-------|--------|----------------|---------|');

  let totalCredits = 0;
  let totalContacts = 0;
  let successCount = 0;

  for (let i = 0; i < ENRICHMENT_TARGETS.length; i++) {
    const target = ENRICHMENT_TARGETS[i];
    
    // Find project ID
    const projectResult = await db.execute(sql`
      SELECT id, name, owner FROM projects WHERE name LIKE ${target.projectName + '%'} AND suppressed = 0 LIMIT 1
    `);
    const projectRows = projectResult[0] as any[];
    
    if (projectRows.length === 0) {
      console.log(`| ${i+1} | ${target.rep} | ${target.projectName.substring(0,40)} | — | ❌ NOT FOUND | 0 | 0 |`);
      continue;
    }

    const project = projectRows[0];
    
    try {
      const result = await enrichProjectContacts(project.id, reportId, {
        enrichEmails: true,
        maxPerCompany: 3,
      });
      
      const contactsFound = result.people.filter(p => (p as any).status === 'enriched').length;
      const credits = result.enrichCreditsUsed || 0;
      totalCredits += credits;
      totalContacts += contactsFound;
      if (contactsFound > 0) successCount++;
      
      const status = contactsFound > 0 ? '✅' : (result.people.length > 0 ? '⚠️ searched' : '❌ blocked');
      console.log(`| ${i+1} | ${target.rep} | ${project.name.substring(0,40)} | ${(project.owner||'').substring(0,20)} | ${status} | ${contactsFound} | ${credits} |`);
    } catch (err: any) {
      console.log(`| ${i+1} | ${target.rep} | ${project.name.substring(0,40)} | ${(project.owner||'').substring(0,20)} | ❌ ERROR | 0 | 0 |`);
      console.error(`  Error: ${err.message}`);
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n## Summary`);
  console.log(`- Projects enriched: ${successCount}/${ENRICHMENT_TARGETS.length}`);
  console.log(`- Total contacts found: ${totalContacts}`);
  console.log(`- Total credits used: ${totalCredits}`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
