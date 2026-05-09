import mysql from 'mysql2/promise';

/**
 * Contact integrity audit on the final Monday-visible set.
 * Checks: email format, company plausibility, title relevance, trust tier consistency
 */
async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL as string);

  // The Monday-visible contacts are those in the Must Act top 3 for each rep
  const visibleProjects = [
    // Ryan
    'Norseman Gold Project - Third Underground Mine Development',
    'Port Hedland Car Dumper 6 Project',
    'Kwinana Gas Power Generation 2 Project',
    // Brett (same WA projects + pump-specific)
    'Murchison Gold Project underground development',
    'Berth 1 and Tugboat Harbour Jetty Construction (Geraldton Port)',
    // Daniel
    'Multiple Large-Scale Renewable Energy Generation Projects (1.2 GW)',
    'Flint Project',
    "Australia's First Large-Scale Solar-Battery Hybrid Facility",
    // Dan Day
    'Fortescue 4-5GWh BESS with 1.8GW Renewable Energy',
    // Amit
    'Mortlake Battery Energy Storage System (BESS)',
    '3.6GWh Solar-plus-Storage Developments',
  ];

  const placeholders = visibleProjects.map(() => '?').join(',');
  const [contacts] = await conn.execute(
    `SELECT id, name, title, company, email, contactTrustTier, roleRelevance, enrichmentSource, project, verificationScore
     FROM contacts WHERE project IN (${placeholders}) AND contactTrustTier = 'send_ready' AND roleRelevance IN ('high','medium')
     ORDER BY project, verificationScore DESC`,
    visibleProjects
  ) as any[];

  console.log(`# Contact Integrity Audit — Monday Visible Set`);
  console.log(`Total send_ready contacts in visible projects: ${contacts.length}\n`);

  const issues: string[] = [];
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const nonIndustrialTitles = /professor|teacher|chef|lawyer|attorney|doctor|nurse|dentist|pharmacist|therapist|counselor|pastor|priest/i;
  const nonIndustrialCompanies = /university|school|hospital|church|clinic|pharmacy|law firm|dental/i;

  for (const c of contacts) {
    // Email format check
    if (c.email && emailRegex.test(c.email) === false) {
      issues.push(`INVALID_EMAIL: [${c.id}] ${c.name} — "${c.email}" is malformed`);
    }
    // No email for send_ready
    if (c.contactTrustTier === 'send_ready' && (c.email === null || c.email === '')) {
      issues.push(`MISSING_EMAIL: [${c.id}] ${c.name} — send_ready but no email`);
    }
    // Non-industrial title
    if (c.title && nonIndustrialTitles.test(c.title)) {
      issues.push(`NON_INDUSTRIAL_TITLE: [${c.id}] ${c.name} — "${c.title}"`);
    }
    // Non-industrial company
    if (c.company && nonIndustrialCompanies.test(c.company)) {
      issues.push(`NON_INDUSTRIAL_COMPANY: [${c.id}] ${c.name} — "${c.company}"`);
    }
    // Generic email domain (gmail, yahoo, hotmail)
    if (c.email && /(@gmail\.|@yahoo\.|@hotmail\.|@outlook\.com)/i.test(c.email)) {
      issues.push(`PERSONAL_EMAIL: [${c.id}] ${c.name} — "${c.email}" is personal domain`);
    }
    // Verification score too low for send_ready
    if (c.verificationScore !== null && c.verificationScore < 30) {
      issues.push(`LOW_VERIFICATION: [${c.id}] ${c.name} — score=${c.verificationScore}`);
    }
  }

  if (issues.length === 0) {
    console.log('**PASS** — No integrity issues found in Monday-visible contacts.\n');
  } else {
    console.log(`**${issues.length} ISSUES FOUND:**\n`);
    for (const issue of issues) {
      console.log(`- ${issue}`);
    }
  }

  // Print summary table of visible contacts
  console.log('\n## Monday Visible Contacts Summary\n');
  console.log('| Project | Contact | Title | Company | Email | Source | Score |');
  console.log('|---------|---------|-------|---------|-------|--------|-------|');
  
  let currentProject = '';
  for (const c of contacts) {
    const projShort = c.project.substring(0, 40);
    if (c.project !== currentProject) {
      currentProject = c.project;
      console.log(`| **${projShort}** | ${c.name} | ${(c.title || '').substring(0, 40)} | ${c.company} | ${c.email ? 'yes' : 'NO'} | ${c.enrichmentSource} | ${c.verificationScore || '-'} |`);
    } else {
      console.log(`| ↳ | ${c.name} | ${(c.title || '').substring(0, 40)} | ${c.company} | ${c.email ? 'yes' : 'NO'} | ${c.enrichmentSource} | ${c.verificationScore || '-'} |`);
    }
  }

  await conn.end();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
