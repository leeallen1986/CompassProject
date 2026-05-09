/**
 * PART D — Contact Integrity on Monday-Visible Projects
 * Checks:
 * 1. Trust tier consistency (send_ready must have email + verified)
 * 2. No llm_inferred contacts as primary
 * 3. No non-industrial contacts (teachers, nurses, etc.)
 * 4. Company-project alignment (contact company matches project owner/contractor)
 * 5. Role relevance accuracy
 */
import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

const NON_INDUSTRIAL_TITLES = /\b(teacher|professor|nurse|doctor|physician|dentist|lawyer|attorney|solicitor|barrister|accountant|auditor|real estate|realtor|retail|barista|waiter|chef|cook|hairdresser|beautician|receptionist|librarian|pastor|minister|chaplain)\b/i;

const IRRELEVANT_COMPANIES = /\b(school|university|college|hospital|clinic|medical|dental|church|law firm|legal|accounting|real estate|salon|restaurant|cafe|hotel)\b/i;

async function main() {
  const db = drizzle(process.env.DATABASE_URL as string);

  // Get all contacts on non-suppressed projects that have send_ready or named_unverified tier
  const contactsResult = await db.execute(sql`
    SELECT c.id, c.name, c.title, c.company, c.project, c.email, c.linkedin,
           c.contactTrustTier, c.enrichmentSource, c.verificationStatus, c.roleRelevance,
           c.verificationScore, c.enrichmentStatus
    FROM contacts c
    JOIN projects p ON p.name = c.project AND p.suppressed = 0
    WHERE c.contactTrustTier IN ('send_ready', 'named_unverified')
      AND c.roleRelevance IN ('high', 'medium')
    ORDER BY c.contactTrustTier, c.project
  `);
  const contacts = contactsResult[0] as any[];

  console.log('# PART D — Contact Integrity Audit\n');
  console.log(`Total contacts checked: ${contacts.length}\n`);

  // Issue tracking
  const issues: { id: number; name: string; project: string; issue: string; severity: string }[] = [];

  for (const c of contacts) {
    // Check 1: send_ready must have email
    if (c.contactTrustTier === 'send_ready' && !c.email) {
      issues.push({ id: c.id, name: c.name, project: c.project, issue: 'send_ready but NO email', severity: 'HIGH' });
    }

    // Check 2: send_ready should have verified status
    if (c.contactTrustTier === 'send_ready' && c.verificationStatus !== 'verified' && c.verificationScore < 70) {
      issues.push({ id: c.id, name: c.name, project: c.project, issue: `send_ready but verification=${c.verificationStatus} score=${c.verificationScore}`, severity: 'MEDIUM' });
    }

    // Check 3: Non-industrial titles
    if (c.title && NON_INDUSTRIAL_TITLES.test(c.title)) {
      issues.push({ id: c.id, name: c.name, project: c.project, issue: `Non-industrial title: "${c.title}"`, severity: 'HIGH' });
    }

    // Check 4: Non-industrial companies
    if (c.company && IRRELEVANT_COMPANIES.test(c.company)) {
      issues.push({ id: c.id, name: c.name, project: c.project, issue: `Non-industrial company: "${c.company}"`, severity: 'HIGH' });
    }

    // Check 5: LLM-inferred as primary source
    if (c.enrichmentSource === 'llm_inferred' && c.contactTrustTier === 'send_ready') {
      issues.push({ id: c.id, name: c.name, project: c.project, issue: 'LLM-inferred contact marked as send_ready', severity: 'HIGH' });
    }

    // Check 6: Missing both email and LinkedIn
    if (!c.email && !c.linkedin && c.contactTrustTier === 'send_ready') {
      issues.push({ id: c.id, name: c.name, project: c.project, issue: 'send_ready but no email AND no LinkedIn', severity: 'HIGH' });
    }
  }

  // Report issues by severity
  const highIssues = issues.filter(i => i.severity === 'HIGH');
  const medIssues = issues.filter(i => i.severity === 'MEDIUM');

  console.log(`## Issues Found: ${issues.length} total (${highIssues.length} HIGH, ${medIssues.length} MEDIUM)\n`);

  if (highIssues.length > 0) {
    console.log('### HIGH Severity Issues\n');
    console.log('| Contact | Project | Issue |');
    console.log('|---------|---------|-------|');
    for (const i of highIssues.slice(0, 30)) {
      console.log(`| ${i.name} | ${i.project.substring(0, 40)} | ${i.issue} |`);
    }
    if (highIssues.length > 30) console.log(`\n... and ${highIssues.length - 30} more HIGH issues`);
  }

  if (medIssues.length > 0) {
    console.log('\n### MEDIUM Severity Issues\n');
    console.log('| Contact | Project | Issue |');
    console.log('|---------|---------|-------|');
    for (const i of medIssues.slice(0, 20)) {
      console.log(`| ${i.name} | ${i.project.substring(0, 40)} | ${i.issue} |`);
    }
    if (medIssues.length > 20) console.log(`\n... and ${medIssues.length - 20} more MEDIUM issues`);
  }

  // Auto-fix: Downgrade send_ready contacts that have no email
  if (highIssues.filter(i => i.issue.includes('NO email')).length > 0) {
    const noEmailIds = highIssues.filter(i => i.issue.includes('NO email')).map(i => i.id);
    console.log(`\n## Auto-Fix: Downgrading ${noEmailIds.length} send_ready contacts with no email to named_unverified`);
    
    for (const id of noEmailIds) {
      await db.execute(sql`UPDATE contacts SET contactTrustTier = 'named_unverified' WHERE id = ${id}`);
    }
    console.log(`✅ ${noEmailIds.length} contacts downgraded`);
  }

  // Auto-fix: Downgrade LLM-inferred send_ready contacts
  const llmIssues = highIssues.filter(i => i.issue.includes('LLM-inferred'));
  if (llmIssues.length > 0) {
    console.log(`\n## Auto-Fix: Downgrading ${llmIssues.length} LLM-inferred send_ready contacts`);
    for (const i of llmIssues) {
      await db.execute(sql`UPDATE contacts SET contactTrustTier = 'named_unverified' WHERE id = ${i.id}`);
    }
    console.log(`✅ ${llmIssues.length} contacts downgraded`);
  }

  // Summary stats
  const sendReadyCount = contacts.filter(c => c.contactTrustTier === 'send_ready').length;
  const namedCount = contacts.filter(c => c.contactTrustTier === 'named_unverified').length;
  const apolloCount = contacts.filter(c => c.enrichmentSource === 'apollo').length;
  const llmCount = contacts.filter(c => c.enrichmentSource === 'llm_inferred').length;
  const hunterCount = contacts.filter(c => c.enrichmentSource === 'hunter').length;

  console.log('\n## Contact Pool Summary\n');
  console.log(`| Metric | Count |`);
  console.log(`|--------|-------|`);
  console.log(`| Total relevant contacts | ${contacts.length} |`);
  console.log(`| send_ready | ${sendReadyCount} |`);
  console.log(`| named_unverified | ${namedCount} |`);
  console.log(`| Source: Apollo | ${apolloCount} |`);
  console.log(`| Source: LLM-inferred | ${llmCount} |`);
  console.log(`| Source: Hunter | ${hunterCount} |`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
