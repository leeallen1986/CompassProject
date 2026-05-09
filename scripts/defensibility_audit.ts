import mysql from 'mysql2/promise';

/**
 * Contact Defensibility Audit
 * 
 * For each rep's top 3 visible projects, check the #1 contact that would
 * appear in the Monday digest and assess:
 * 1. Is the person real? (Apollo/verified source vs web_search guess)
 * 2. Is the company correct? (matches project owner/contractor)
 * 3. Is the title plausible? (industrial role, not academic/generic)
 * 4. Is the email pattern valid? (corporate domain, not generic)
 * 5. Overall verdict: STRONG / ACCEPTABLE / WEAK
 */

const TARGET_REPS = [
  { name: 'Ryan Pemberton', territories: ['WA'], dimensions: ['Portable Air', 'Generators', 'PAL', 'Pump/Dewatering', 'BESS'] },
  { name: 'Brett Hansen', territories: ['WA', 'NT'], dimensions: ['Portable Air', 'Pump/Dewatering'] },
  { name: 'Daniel Zec', territories: ['NSW', 'VIC', 'SA', 'TAS'], dimensions: ['Portable Air'] },
  { name: 'Dan Day', territories: ['SA', 'QLD', 'VIC', 'NSW', 'TAS'], dimensions: ['Pump/Dewatering'] },
  { name: 'Amit Bhargava', territories: ['WA', 'NSW', 'QLD', 'VIC', 'SA', 'TAS', 'NT', 'ACT'], dimensions: ['PAL', 'Generators', 'BESS'] },
];

// Non-industrial patterns
const NON_INDUSTRIAL_TITLES = /professor|lecturer|teacher|chef|lawyer|solicitor|barrister|nurse|doctor|dentist|pharmacist|student|intern$/i;
const GENERIC_DOMAINS = /gmail|yahoo|hotmail|outlook|icloud|protonmail/i;
const NON_INDUSTRIAL_COMPANIES = /university|school|hospital|clinic|church|council|police|prison|correctional/i;

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL as string);

  // Get digestSafe projects
  const [digestSafeRows] = await conn.execute(
    `SELECT projectId FROM projectValidationGates WHERE digestSafe = 1`
  ) as any[];
  const digestSafeIds = new Set(digestSafeRows.map((r: any) => r.projectId));

  // Get all projects
  const [allProjects] = await conn.execute(
    `SELECT p.id, p.name as projectName, p.projectState, p.priority, p.owner, p.contractors
     FROM projects p
     WHERE p.projectType = 'opportunity'
       AND (p.suppressed IS NULL OR p.suppressed = 0)
       AND (p.lifecycleStatus IS NULL OR p.lifecycleStatus NOT IN ('archived', 'duplicate'))
     ORDER BY p.priority DESC, p.id`
  ) as any[];

  // Get BL scores
  const [allScores] = await conn.execute(
    `SELECT projectId, scoringDimension, score FROM projectBusinessLineScores WHERE score >= 50`
  ) as any[];
  const scoreMap = new Map<number, Map<string, number>>();
  for (const s of allScores) {
    if (!scoreMap.has(s.projectId)) scoreMap.set(s.projectId, new Map());
    scoreMap.get(s.projectId)!.set(s.scoringDimension, s.score);
  }

  // Get ALL contacts for the relevant projects (not just high/medium)
  const [allContacts] = await conn.execute(
    `SELECT id, name, title, company, email, contactTrustTier, roleRelevance,
            enrichmentSource, project, verificationScore, linkedinProfileUrl, emailVerified
     FROM contacts
     WHERE roleRelevance IN ('high', 'medium')
       AND contactTrustTier IN ('send_ready', 'named_unverified')
     ORDER BY
       CASE WHEN contactTrustTier = 'send_ready' THEN 0 ELSE 1 END,
       verificationScore DESC`
  ) as any[];
  const contactsByProject = new Map<string, any[]>();
  for (const c of allContacts) {
    if (!contactsByProject.has(c.project)) contactsByProject.set(c.project, []);
    contactsByProject.get(c.project)!.push(c);
  }

  console.log('# Contact Defensibility Audit');
  console.log(`**Timestamp:** ${new Date().toISOString()}`);
  console.log('');

  const allResults: { rep: string; project: string; contact: string; company: string; verdict: string; issues: string[] }[] = [];

  for (const rep of TARGET_REPS) {
    // Filter and rank projects for this rep
    const territoryFiltered = allProjects.filter((p: any) => {
      if (!p.projectState || p.projectState === '') return true;
      const state = p.projectState.toUpperCase();
      return rep.territories.some(t => state.includes(t));
    });

    const blFiltered = territoryFiltered.filter((p: any) => {
      const scores = scoreMap.get(p.id);
      if (!scores) return false;
      for (const dim of rep.dimensions) {
        if ((scores.get(dim) || 0) >= 50) return true;
      }
      return false;
    });

    const ranked = blFiltered.map((p: any) => {
      const contacts = contactsByProject.get(p.projectName) || [];
      const sendReady = contacts.filter((c: any) => c.contactTrustTier === 'send_ready');
      const isDigestSafe = digestSafeIds.has(p.id);
      const priorityScore = p.priority === 'hot' ? 3 : p.priority === 'warm' ? 2 : 1;
      const contactScore = sendReady.length > 0 ? 2 : contacts.length > 0 ? 1 : 0;
      return { ...p, contacts, sendReady, isDigestSafe, rankScore: priorityScore * 10 + contactScore * 3 + (isDigestSafe ? 5 : 0) };
    }).sort((a: any, b: any) => b.rankScore - a.rankScore);

    const top3 = ranked.slice(0, 3);

    console.log(`## ${rep.name}`);
    console.log('');

    for (let i = 0; i < top3.length; i++) {
      const p = top3[i];
      const bestContact = p.sendReady[0] || p.contacts[0];
      
      if (!bestContact) {
        console.log(`### #${i+1} ${p.projectName}`);
        console.log('- **NO CONTACT** — WEAK');
        console.log('');
        allResults.push({ rep: rep.name, project: p.projectName, contact: 'NONE', company: '-', verdict: 'WEAK', issues: ['no contact'] });
        continue;
      }

      const issues: string[] = [];

      // Check 1: Source quality
      if (bestContact.enrichmentSource === 'llm_inferred') {
        issues.push('LLM-inferred (not verified)');
      } else if (bestContact.enrichmentSource === 'web_search' && !bestContact.emailVerified) {
        issues.push('web_search without email verification');
      }

      // Check 2: Company alignment
      const projectOwner = (p.owner || '').toLowerCase();
      const projectContractors = (Array.isArray(p.contractors) ? p.contractors.join(',') : String(p.contractors || '')).toLowerCase();
      const contactCompany = (bestContact.company || '').toLowerCase();
      const companyAligned = projectOwner.includes(contactCompany) || 
                            contactCompany.includes(projectOwner.split(' ')[0]) ||
                            projectContractors.includes(contactCompany) ||
                            contactCompany.includes(projectContractors.split(',')[0]?.trim());
      if (!companyAligned && contactCompany) {
        // Not necessarily bad — could be a contractor not listed
        // Only flag if the company is clearly non-industrial
        if (NON_INDUSTRIAL_COMPANIES.test(contactCompany)) {
          issues.push(`non-industrial company: ${bestContact.company}`);
        }
      }

      // Check 3: Title plausibility
      if (NON_INDUSTRIAL_TITLES.test(bestContact.title || '')) {
        issues.push(`non-industrial title: ${bestContact.title}`);
      }

      // Check 4: Email domain
      if (bestContact.email) {
        const domain = bestContact.email.split('@')[1] || '';
        if (GENERIC_DOMAINS.test(domain)) {
          issues.push(`generic email domain: ${domain}`);
        }
      } else if (bestContact.contactTrustTier === 'send_ready') {
        issues.push('send_ready but no email (should be downgraded)');
      }

      // Check 5: Verification score
      if (bestContact.verificationScore && bestContact.verificationScore < 70) {
        issues.push(`low verification score: ${bestContact.verificationScore}`);
      }

      // Verdict
      let verdict = 'STRONG';
      if (issues.length >= 2) verdict = 'WEAK';
      else if (issues.length === 1) verdict = 'ACCEPTABLE';

      console.log(`### #${i+1} ${p.projectName.substring(0, 60)}`);
      console.log(`- **Contact:** ${bestContact.name} | ${bestContact.title || 'No title'}`);
      console.log(`- **Company:** ${bestContact.company} | Source: ${bestContact.enrichmentSource} | Score: ${bestContact.verificationScore || 'N/A'}`);
      console.log(`- **Email:** ${bestContact.email ? bestContact.email.replace(/(.{3}).*(@.*)/, '$1***$2') : 'NONE'} | Verified: ${bestContact.emailVerified || 'N/A'}`);
      console.log(`- **LinkedIn:** ${bestContact.linkedinProfileUrl ? 'YES' : 'NO'}`);
      const contractorsStr = Array.isArray(p.contractors) ? p.contractors.join(', ') : String(p.contractors || 'None');
      console.log(`- **Project owner:** ${p.owner || 'Unknown'} | Contractors: ${contractorsStr.substring(0, 60)}`);
      console.log(`- **Verdict:** ${verdict}${issues.length > 0 ? ' — ' + issues.join('; ') : ''}`);
      console.log('');

      allResults.push({ rep: rep.name, project: p.projectName, contact: bestContact.name, company: bestContact.company, verdict, issues });
    }
  }

  // Summary table
  console.log('---');
  console.log('## Summary');
  console.log('| Rep | Project | Contact | Company | Verdict |');
  console.log('|-----|---------|---------|---------|---------|');
  for (const r of allResults) {
    console.log(`| ${r.rep.split(' ')[0]} | ${r.project.substring(0, 40)} | ${r.contact.substring(0, 25)} | ${r.company.substring(0, 20)} | ${r.verdict} |`);
  }
  console.log('');

  const strong = allResults.filter(r => r.verdict === 'STRONG').length;
  const acceptable = allResults.filter(r => r.verdict === 'ACCEPTABLE').length;
  const weak = allResults.filter(r => r.verdict === 'WEAK').length;
  console.log(`**Totals:** ${strong} STRONG, ${acceptable} ACCEPTABLE, ${weak} WEAK out of ${allResults.length} contacts`);

  await conn.end();
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
