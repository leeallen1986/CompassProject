/**
 * Gate Simulation Script — Addendum Evidence
 * Simulates the corrected gate logic for 5 reps using live DB data.
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const NON_DEFENSIBLE_DOMAINS = [
  /^gmail\.com$/i, /^hotmail\.com$/i, /^yahoo\.com$/i, /^outlook\.com$/i,
  /^icloud\.com$/i, /^protonmail\.com$/i, /^aol\.com$/i, /^live\.com$/i,
];

function checkContactDefensibility(contact, project) {
  const email = contact.email || '';
  const domain = email.split('@')[1] || '';
  const failedChecks = [];

  const trustTierOk = contact.trustTier === 'send_ready';
  if (!trustTierOk) failedChecks.push('trust_tier_not_send_ready');

  let domainDefensible = true;
  if (!email || !domain) {
    domainDefensible = false;
    failedChecks.push('no_email_or_domain');
  } else if (NON_DEFENSIBLE_DOMAINS.some(re => re.test(domain))) {
    domainDefensible = false;
    failedChecks.push('non_defensible_domain');
  }

  const FABRICATED = [/^(info|admin|sales|contact|hello|support|noreply)@/i];
  let noFabricatedEmail = true;
  if (FABRICATED.some(re => re.test(email))) {
    noFabricatedEmail = false;
    failedChecks.push('fabricated_email_pattern');
  }

  const cardDetailConsistent = !!(contact.email && contact.name && contact.source);
  if (!cardDetailConsistent) failedChecks.push('card_detail_inconsistent');

  return {
    passes: failedChecks.length === 0,
    failedChecks,
    checks: { trustTierOk, domainDefensible, noFabricatedEmail, cardDetailConsistent },
  };
}

function runGate(top3Projects) {
  const blockers = [];
  let contactsDefensible = 0;

  for (const project of top3Projects) {
    if (!project.bestContact) {
      blockers.push({ criterion: 'no_contact', detail: '"' + project.name + '" has no primary contact', severity: 'warning' });
      continue;
    }
    const result = checkContactDefensibility(project.bestContact, project);
    if (result.passes) {
      contactsDefensible++;
    } else {
      blockers.push({
        criterion: 'contact_not_defensible',
        detail: '"' + project.name + '" contact "' + project.bestContact.name + '" failed: ' + result.failedChecks.join(', '),
        severity: 'warning',
      });
      if (!result.checks.cardDetailConsistent) {
        blockers.push({
          criterion: 'card_detail_mismatch',
          detail: '"' + project.name + '" contact "' + project.bestContact.name + '" has inconsistent card/detail data',
          severity: 'blocking',
        });
      }
    }
  }

  if (contactsDefensible < 2) {
    blockers.push({
      criterion: 'insufficient_defensible_contacts',
      detail: 'Only ' + contactsDefensible + '/' + top3Projects.length + ' top projects have defensible contacts (minimum 2 required)',
      severity: 'blocking',
    });
  }

  const hasBlockingBlocker = blockers.some(b => b.severity === 'blocking');
  return { decision: hasBlockingBlocker ? 'HOLD' : 'SEND', blockers, contactsDefensible };
}

async function getTop3ForRep(db, rep) {
  const stateList = rep.territories.map(t => "'" + t + "'").join(',');
  const stateFilter = rep.territories.length > 0 ? 'AND p.projectState IN (' + stateList + ')' : '';

  const [rows] = await db.query(
    'SELECT p.id, p.name, p.projectState, pbl.score, ' +
    'c.name as cName, c.title as cTitle, c.email as cEmail, ' +
    'c.contactTrustTier, c.source, c.verificationScore, c.company as cCompany, p.owner as owner ' +
    'FROM projects p ' +
    'JOIN projectBusinessLineScores pbl ON pbl.projectId = p.id AND pbl.scoringDimension = ? ' +
    'JOIN contactProjects cp ON cp.projectId = p.id ' +
    'JOIN contacts c ON c.id = cp.contactId AND c.contactTrustTier = "send_ready" AND c.email IS NOT NULL ' +
    'WHERE (p.lifecycleStatus = "active" OR p.lifecycleStatus IS NULL) ' +
    'AND (p.suppressed = 0 OR p.suppressed IS NULL) ' +
    stateFilter + ' ' +
    'ORDER BY pbl.score DESC, c.verificationScore DESC LIMIT 20',
    [rep.primaryDim]
  );

  const projectMap = new Map();
  for (const r of rows) {
    if (!projectMap.has(r.id)) {
      projectMap.set(r.id, {
        id: r.id, name: r.name, state: r.projectState, score: r.score, owner: r.owner,
        bestContact: {
          name: r.cName, title: r.cTitle, email: r.cEmail,
          trustTier: r.contactTrustTier, source: r.source,
          verificationScore: r.verificationScore, company: r.cCompany,
        },
      });
    }
  }
  return Array.from(projectMap.values()).slice(0, 3);
}

async function main() {
  const db = await mysql.createConnection(process.env.DATABASE_URL);

  const reps = [
    { id: 2340043, name: 'Ryan Pemberton',  territories: ['WA'],                              primaryDim: 'Portable Air' },
    { id: 2550006, name: 'Brett Hansen',    territories: ['WA', 'NT'],                        primaryDim: 'Pump/Dewatering' },
    { id: 2820073, name: 'Daniel Zec',      territories: ['NSW', 'VIC', 'SA', 'TAS'],         primaryDim: 'Portable Air' },
    { id: 3630009, name: 'Dan Day',         territories: ['SA', 'QLD', 'VIC', 'NSW', 'TAS'], primaryDim: 'Pump/Dewatering' },
    { id: 3870014, name: 'Amit Bhargava',   territories: [],                                  primaryDim: 'PAL' },
  ];

  const results = [];

  for (const rep of reps) {
    const top3 = await getTop3ForRep(db, rep);

    // BEFORE: simulate old broken wiring (trustTier=null, source=null)
    const top3Broken = top3.map(p => ({
      ...p,
      bestContact: p.bestContact ? { ...p.bestContact, trustTier: null, source: null } : null,
    }));
    const beforeResult = runGate(top3Broken);

    // AFTER: simulate fixed wiring
    const afterResult = runGate(top3);

    results.push({ rep, top3, beforeResult, afterResult });
  }

  await db.end();

  for (const { rep, top3, beforeResult, afterResult } of results) {
    console.log('\n' + '='.repeat(70));
    console.log('REP: ' + rep.name + ' | BL: ' + rep.primaryDim + ' | Territories: ' + (rep.territories.join('/') || 'NATIONAL'));
    console.log('='.repeat(70));
    console.log('BEFORE (broken wiring): ' + beforeResult.decision + ' | defensible=' + beforeResult.contactsDefensible + '/3');
    console.log('AFTER  (fixed wiring):  ' + afterResult.decision + ' | defensible=' + afterResult.contactsDefensible + '/3');
    console.log('\nTop 3 projects:');
    for (const p of top3) {
      const c = p.bestContact;
      console.log('  [' + p.id + '] ' + p.name.substring(0, 55) + ' | score=' + p.score + ' | state=' + p.state);
      console.log('    Contact: ' + c.name + ' | ' + (c.title || '').substring(0, 35) + ' | tier=' + c.trustTier + ' | src=' + c.source + ' | email=' + c.email);
    }
    if (afterResult.decision === 'HOLD') {
      console.log('\nAfter-fix blockers:');
      for (const b of afterResult.blockers) {
        console.log('  [' + b.severity + '] ' + b.criterion + ': ' + (b.detail || '').substring(0, 80));
      }
    } else {
      console.log('\nAll gate checks PASSED — digest would SEND');
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(70));
  console.log('Rep             | BL              | Before  | After   | Change');
  console.log('----------------|-----------------|---------|---------|-------');
  for (const { rep, beforeResult, afterResult } of results) {
    const change = beforeResult.decision !== afterResult.decision ? '*** CHANGED ***' : 'same';
    const name = rep.name.padEnd(16);
    const bl = rep.primaryDim.padEnd(16);
    console.log(name + '| ' + bl + '| ' + beforeResult.decision.padEnd(8) + '| ' + afterResult.decision.padEnd(8) + '| ' + change);
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
