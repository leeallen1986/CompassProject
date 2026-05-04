import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

function safeParseContractors(raw) {
  if (!raw) return [];
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) {
    // mysql2 may return parsed JSON already
    if (Array.isArray(raw)) return raw.map(c => c.name || c.company || '').filter(Boolean);
    return [];
  }
  const str = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  if (!str || str.trim() === '' || str === 'null') return [];
  try {
    const parsed = JSON.parse(str);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(c => c.name || c.company || '').filter(Boolean);
  } catch(e) { return []; }
}

const db = await createConnection(process.env.DATABASE_URL);

// ── TOP 20 ──────────────────────────────────────────────────────────────────
const [top20] = await db.execute(`
  SELECT id, name, priority, discoveryPriority, discoveryStatus, discoveryAttempts, lastDiscoveryAt,
         owner, contractors, stage, projectState, projectType, suppressed, geoBlockedReason,
         matchedBusinessLines, capexGrade, lastActivityAt, createdAt, actionTier, lifecycleStatus
  FROM projects
  WHERE suppressed = false
    AND (projectType = 'opportunity' OR projectType IS NULL)
    AND (geoBlockedReason IS NULL)
    AND matchedBusinessLines IS NOT NULL
    AND JSON_LENGTH(matchedBusinessLines) > 0
    AND (lifecycleStatus IS NULL OR lifecycleStatus NOT IN ('archived', 'stale'))
  ORDER BY FIELD(priority, 'hot', 'warm', 'cold'), FIELD(discoveryPriority, 'A', 'B', 'C'), lastActivityAt DESC
  LIMIT 20
`);

const projectIds = top20.map(p => p.id);
const idList = projectIds.join(',');

// ── CONTACTS ────────────────────────────────────────────────────────────────
const [linkedContacts] = await db.execute(`
  SELECT cp.projectId, c.id as contactId, c.name, c.company, c.title, c.email,
         c.linkedin as linkedinUrl, c.enrichmentStatus, c.enrichmentSource,
         c.verificationScore, c.roleBucket, c.roleRelevance, c.source
  FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  WHERE cp.projectId IN (${idList})
    AND (c.enrichmentSource != 'manual' OR c.enrichmentSource IS NULL)
`);
const contactsByProject = {};
for (const c of linkedContacts) {
  if (!contactsByProject[c.projectId]) contactsByProject[c.projectId] = [];
  contactsByProject[c.projectId].push(c);
}

// ── APOLLO CREDIT LOG ────────────────────────────────────────────────────────
const [apolloActivity] = await db.execute(`
  SELECT projectId, COUNT(*) as totalActions, SUM(creditsUsed) as totalCredits, MAX(createdAt) as lastActionAt
  FROM apolloCreditLog WHERE projectId IN (${idList}) GROUP BY projectId
`);
const apolloByProject = {};
for (const a of apolloActivity) apolloByProject[a.projectId] = a;

// ── ENRICHMENT CACHE ─────────────────────────────────────────────────────────
const [enrichCache] = await db.execute(`
  SELECT projectId, MAX(enrichedAt) as lastEnrichedAt, SUM(contactsFound) as totalFound, SUM(apiCallsMade) as totalApiCalls
  FROM projectEnrichmentCache WHERE projectId IN (${idList}) GROUP BY projectId
`);
const enrichCacheByProject = {};
for (const e of enrichCache) enrichCacheByProject[e.projectId] = e;

// ── FUNNEL ANALYSIS ──────────────────────────────────────────────────────────
const funnelCounts = { s1:0,s2:0,s3:0,s4:0,s5:0,s6:0,s7:0,s8:0,s9:0,s10:0 };
const projectFunnels = [];

for (const p of top20) {
  const contacts = contactsByProject[p.id] || [];
  const apollo = apolloByProject[p.id] || null;
  const cache = enrichCacheByProject[p.id] || null;
  const contractorNames = safeParseContractors(p.contractors);
  const hasOwner = !!(p.owner && p.owner.trim() && p.owner !== 'Unknown' && p.owner !== 'TBC');
  const hasContractor = contractorNames.length > 0;
  const ownerIsGov = !!(p.owner && /government|council|department|authority|state|federal|shire|city of|minister|commission|transport for|roads and maritime|main roads/i.test(p.owner));
  const hasRouteToBuy = hasContractor || (hasOwner && !ownerIsGov);
  const hasRoleHypothesis = contacts.some(c => c.roleBucket && c.roleBucket !== 'Unknown' && c.roleBucket !== 'Other');
  const apolloAttempted = !!(apollo && apollo.totalActions > 0) || !!(cache && cache.totalApiCalls > 0);
  const revealAttempted = !!(apollo && apollo.totalCredits > 0);
  const contactSaved = contacts.length > 0;
  const verifiedContacts = contacts.filter(c => c.enrichmentStatus === 'enriched' && c.email && !c.email.includes('@unknown') && !c.email.includes('placeholder'));
  const contactVerified = verifiedContacts.length > 0;
  const sendReadyContacts = contacts.filter(c => c.email && c.enrichmentStatus === 'enriched' && (c.roleRelevance === 'high' || c.roleRelevance === 'medium') && !c.email.includes('@unknown') && !c.email.includes('placeholder'));
  const namedNoEmail = contacts.filter(c => c.name && c.name !== 'Unknown' && !c.email);
  const roleOnly = contacts.filter(c => !c.name || c.name === 'Unknown' || c.name.startsWith('Role:'));

  funnelCounts.s1++; if(hasOwner) funnelCounts.s2++; if(hasContractor) funnelCounts.s3++;
  if(hasRouteToBuy) funnelCounts.s4++; if(hasRoleHypothesis) funnelCounts.s5++;
  if(apolloAttempted) funnelCounts.s6++; if(revealAttempted) funnelCounts.s7++;
  if(contactSaved) funnelCounts.s8++; if(contactVerified) funnelCounts.s9++; if(contactSaved) funnelCounts.s10++;

  projectFunnels.push({
    id:p.id, name:p.name, priority:p.priority, discoveryPriority:p.discoveryPriority,
    discoveryStatus:p.discoveryStatus, discoveryAttempts:p.discoveryAttempts||0,
    ownerCompany:p.owner, contractorNames, hasOwner, hasContractor, hasRouteToBuy, ownerIsGov,
    hasRoleHypothesis, apolloAttempted, revealAttempted, contactSaved, contactVerified,
    totalContacts:contacts.length, sendReadyCount:sendReadyContacts.length,
    namedNoEmailCount:namedNoEmail.length, roleOnlyCount:roleOnly.length,
    apolloActions:apollo?.totalActions||0, apolloCredits:apollo?.totalCredits||0,
    contacts, sendReadyContacts, namedNoEmail, roleOnly,
  });
}

const n = 20;
const pct = v => `${v}/${n} (${Math.round(v/n*100)}%)`;

console.log('\n=== FUNNEL DROP-OFF (top 20 priority projects) ===');
console.log('Stage 1  Project exists:                   ', pct(funnelCounts.s1));
console.log('Stage 2  Owner/account identified:         ', pct(funnelCounts.s2));
console.log('Stage 3  Contractor identified:            ', pct(funnelCounts.s3));
console.log('Stage 4  Route-to-buy identified:          ', pct(funnelCounts.s4));
console.log('Stage 5  Role hypothesis created:          ', pct(funnelCounts.s5));
console.log('Stage 6  Apollo/search attempted:          ', pct(funnelCounts.s6));
console.log('Stage 7  Reveal (email credit) attempted:  ', pct(funnelCounts.s7));
console.log('Stage 8  Contact saved:                    ', pct(funnelCounts.s8));
console.log('Stage 9  Contact verified (enriched+email):', pct(funnelCounts.s9));
console.log('Stage 10 Contact linked to project:        ', pct(funnelCounts.s10));

const withSendReady = projectFunnels.filter(f=>f.sendReadyCount>0).length;
const withOnlyRoleGap = projectFunnels.filter(f=>f.roleOnlyCount>0&&f.sendReadyCount===0&&f.namedNoEmailCount===0).length;
const withNamedNoEmail = projectFunnels.filter(f=>f.namedNoEmailCount>0&&f.sendReadyCount===0).length;
const withNoContacts = projectFunnels.filter(f=>f.totalContacts===0).length;
const withGovBlock = projectFunnels.filter(f=>f.ownerIsGov&&!f.hasContractor).length;
const withAttemptedNoResult = projectFunnels.filter(f=>f.apolloAttempted&&f.sendReadyCount===0).length;

console.log('\n=== COVERAGE METRICS ===');
console.log('Projects with >=1 send-ready contact:              ', pct(withSendReady));
console.log('Projects with only role-gap (no named person):     ', pct(withOnlyRoleGap));
console.log('Projects with named contact but no email:          ', pct(withNamedNoEmail));
console.log('Projects with zero contacts:                       ', pct(withNoContacts));
console.log('Projects blocked by gov owner (no contractor):     ', pct(withGovBlock));
console.log('Projects where Apollo ran but still no send-ready: ', pct(withAttemptedNoResult));

console.log('\n=== PER-PROJECT DETAIL ===');
const yn = v => v?'Y':'N';
for (let i=0; i<projectFunnels.length; i++) {
  const f = projectFunnels[i];
  console.log(`${i+1}. [${f.priority}/${f.discoveryPriority||'?'}] ID=${f.id} "${f.name?.substring(0,45)}"`);
  console.log(`   Owner: ${(f.ownerCompany||'?').substring(0,40)} | Contractors: ${(f.contractorNames.join('; ')||'none').substring(0,45)}`);
  console.log(`   Own=${yn(f.hasOwner)} Ctr=${yn(f.hasContractor)} Route=${yn(f.hasRouteToBuy)} GovBlk=${yn(f.ownerIsGov)} RoleHyp=${yn(f.hasRoleHypothesis)} AplAtt=${yn(f.apolloAttempted)} RevAtt=${yn(f.revealAttempted)} Saved=${yn(f.contactSaved)} Verif=${yn(f.contactVerified)}`);
  console.log(`   Contacts: total=${f.totalContacts} sendReady=${f.sendReadyCount} namedNoEmail=${f.namedNoEmailCount} roleOnly=${f.roleOnlyCount} | discStatus=${f.discoveryStatus} attempts=${f.discoveryAttempts} apolloActions=${f.apolloActions}`);
  for (const c of f.sendReadyContacts) {
    console.log(`   SEND-READY: ${c.name} | ${c.title} | ${c.email} | rel=${c.roleRelevance} | src=${c.enrichmentSource}`);
  }
  for (const c of f.namedNoEmail) {
    console.log(`   NAMED-NO-EMAIL: ${c.name} | ${c.title} | enrichStatus=${c.enrichmentStatus} | src=${c.enrichmentSource}`);
  }
}

// ── APOLLO LAST 7 DAYS ───────────────────────────────────────────────────────
const [a7] = await db.execute(`
  SELECT COUNT(*) as totalActions, SUM(creditsUsed) as totalCredits,
         COUNT(DISTINCT projectId) as distinctProjects, COUNT(DISTINCT contactId) as distinctContacts,
         SUM(CASE WHEN creditsUsed > 0 THEN 1 ELSE 0 END) as revealActions,
         SUM(CASE WHEN creditsUsed = 0 THEN 1 ELSE 0 END) as searchActions
  FROM apolloCreditLog WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
`);
console.log('\n=== APOLLO LAST 7 DAYS ===');
console.log(JSON.stringify(a7[0], null, 2));

const [aDupes] = await db.execute(`
  SELECT projectId, projectName, COUNT(*) as cnt, SUM(creditsUsed) as credits
  FROM apolloCreditLog WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
  GROUP BY projectId, projectName HAVING COUNT(*) > 2 ORDER BY cnt DESC LIMIT 15
`);
console.log('Repeated project actions (>2x, last 7d):');
for (const d of aDupes) console.log(`  ${d.cnt}x project ${d.projectId} "${d.projectName?.substring(0,40)}" credits=${d.credits}`);

const [aByDay] = await db.execute(`
  SELECT DATE(createdAt) as day, COUNT(*) as actions, SUM(creditsUsed) as credits, COUNT(DISTINCT projectId) as projects
  FROM apolloCreditLog WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 14 DAY)
  GROUP BY DATE(createdAt) ORDER BY day DESC
`);
console.log('Apollo by day:');
for (const r of aByDay) console.log(`  ${r.day}: ${r.actions} actions, ${r.credits} credits, ${r.projects} projects`);

// ── ORPHAN CONTACTS ──────────────────────────────────────────────────────────
const [orphan] = await db.execute(`
  SELECT COUNT(*) as total,
    SUM(CASE WHEN cp.contactId IS NULL THEN 1 ELSE 0 END) as orphan,
    SUM(CASE WHEN cp.contactId IS NOT NULL THEN 1 ELSE 0 END) as linked,
    SUM(CASE WHEN c.email IS NOT NULL AND c.enrichmentStatus='enriched' AND cp.contactId IS NOT NULL THEN 1 ELSE 0 END) as linkedEnrichedEmail,
    SUM(CASE WHEN c.email IS NOT NULL AND c.enrichmentStatus='enriched' AND cp.contactId IS NULL THEN 1 ELSE 0 END) as orphanEnrichedEmail
  FROM contacts c LEFT JOIN contactProjects cp ON cp.contactId = c.id
`);
console.log('\n=== ORPHAN CONTACTS ===');
console.log(JSON.stringify(orphan[0], null, 2));

// ── DISCOVERY STATUS DISTRIBUTION ────────────────────────────────────────────
const [discDist] = await db.execute(`
  SELECT COALESCE(discoveryStatus,'null/unset') as ds, COUNT(*) as total,
    SUM(CASE WHEN priority='hot' THEN 1 ELSE 0 END) as hot,
    SUM(CASE WHEN priority='warm' THEN 1 ELSE 0 END) as warm,
    SUM(CASE WHEN priority='cold' THEN 1 ELSE 0 END) as cold
  FROM projects WHERE suppressed=false AND (projectType='opportunity' OR projectType IS NULL)
    AND (geoBlockedReason IS NULL) AND matchedBusinessLines IS NOT NULL AND JSON_LENGTH(matchedBusinessLines)>0
    AND (lifecycleStatus IS NULL OR lifecycleStatus NOT IN ('archived','stale'))
  GROUP BY discoveryStatus ORDER BY total DESC
`);
console.log('\n=== DISCOVERY STATUS DISTRIBUTION (all active AU opportunity projects) ===');
let gt=0;
for (const r of discDist) { gt+=Number(r.total); console.log(`${r.ds.padEnd(35)} total=${r.total} hot=${r.hot} warm=${r.warm} cold=${r.cold}`); }
console.log(`GRAND TOTAL: ${gt}`);

// ── QUEUE ELIGIBILITY ────────────────────────────────────────────────────────
const [qElig] = await db.execute(`
  SELECT COUNT(*) as eligible,
    SUM(CASE WHEN priority='hot' THEN 1 ELSE 0 END) as hot,
    SUM(CASE WHEN priority='warm' THEN 1 ELSE 0 END) as warm
  FROM projects
  WHERE discoveryStatus IN ('no_contacts','discovery_queued','role_only','named_contact_no_email')
    AND (geoBlockedReason IS NULL) AND (projectCountry='AU' OR projectCountry IS NULL)
    AND (suppressed=false OR suppressed IS NULL) AND (projectType='opportunity' OR projectType IS NULL)
    AND matchedBusinessLines IS NOT NULL AND JSON_LENGTH(matchedBusinessLines)>0
    AND (discoveryAttempts < 3 OR discoveryAttempts IS NULL)
    AND (lastDiscoveryAt IS NULL OR lastDiscoveryAt < DATE_SUB(NOW(), INTERVAL 72 HOUR))
    AND (lifecycleStatus IS NULL OR lifecycleStatus NOT IN ('archived','stale'))
`);
console.log('\n=== QUEUE ELIGIBILITY RIGHT NOW ===');
console.log('Immediately eligible:', JSON.stringify(qElig[0]));

// ── EXHAUSTED ATTEMPTS ───────────────────────────────────────────────────────
const [exh] = await db.execute(`
  SELECT COUNT(*) as total, SUM(CASE WHEN priority='hot' THEN 1 ELSE 0 END) as hot,
    SUM(CASE WHEN priority='warm' THEN 1 ELSE 0 END) as warm,
    SUM(CASE WHEN discoveryStatus='no_contacts' THEN 1 ELSE 0 END) as stillNoContacts,
    SUM(CASE WHEN discoveryStatus='role_only' THEN 1 ELSE 0 END) as roleOnly,
    SUM(CASE WHEN discoveryStatus='named_contact_no_email' THEN 1 ELSE 0 END) as namedNoEmail
  FROM projects WHERE discoveryAttempts>=3 AND suppressed=false
    AND (projectType='opportunity' OR projectType IS NULL) AND (geoBlockedReason IS NULL)
    AND (lifecycleStatus IS NULL OR lifecycleStatus NOT IN ('archived','stale'))
`);
console.log('\n=== EXHAUSTED DISCOVERY ATTEMPTS (>=3) ===');
console.log(JSON.stringify(exh[0], null, 2));

// ── RECENT PIPELINE RUNS ─────────────────────────────────────────────────────
const [runs] = await db.execute(`
  SELECT id, status, startedAt, projectsCreated, contactsEnriched, apolloCreditsUsed, currentStep, lastActivityNote
  FROM pipelineRuns ORDER BY startedAt DESC LIMIT 8
`);
console.log('\n=== RECENT PIPELINE RUNS ===');
for (const r of runs) {
  console.log(`Run ${r.id} [${r.status}] ${r.startedAt?.toISOString?.()?.substring(0,19)} | projects=${r.projectsCreated} contacts=${r.contactsEnriched} apollo$=${r.apolloCreditsUsed}`);
  if (r.lastActivityNote) console.log(`  note: ${r.lastActivityNote}`);
}

// ── PIPELINE STEP ANALYSIS ───────────────────────────────────────────────────
const [pRuns] = await db.execute(`SELECT id, startedAt, steps FROM pipelineRuns WHERE status='completed' ORDER BY startedAt DESC LIMIT 3`);
console.log('\n=== PIPELINE STEP ANALYSIS (discovery steps, last 3 completed runs) ===');
for (const run of pRuns) {
  console.log(`\nRun ${run.id} (${run.startedAt?.toISOString?.()?.substring(0,10)}):`);
  try {
    const stepsRaw = run.steps;
    let steps;
    if (typeof stepsRaw === 'string') steps = JSON.parse(stepsRaw);
    else if (Buffer.isBuffer(stepsRaw)) steps = JSON.parse(stepsRaw.toString('utf8'));
    else steps = stepsRaw || [];
    for (const s of steps) {
      if (/enrich|discover|apollo|hunter|contact|second.pass|contractor.enrich|discovery.queue|sla|web.stakeholder/i.test(s.name)) {
        console.log(`  ${s.name.padEnd(38)} status=${s.status.padEnd(12)} counts=${JSON.stringify(s.counts||{})}`);
      }
    }
  } catch(e) { console.log('  (parse error:', e.message, ')'); }
}

// ── ENRICHMENT STATUS BREAKDOWN ──────────────────────────────────────────────
const [eStats] = await db.execute(`
  SELECT COALESCE(enrichmentStatus,'null/pending') as es, COALESCE(enrichmentSource,'null') as src,
    COUNT(*) as cnt, SUM(CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END) as withEmail,
    SUM(CASE WHEN linkedin IS NOT NULL THEN 1 ELSE 0 END) as withLI
  FROM contacts GROUP BY enrichmentStatus, enrichmentSource ORDER BY cnt DESC LIMIT 20
`);
console.log('\n=== CONTACT ENRICHMENT STATUS BREAKDOWN ===');
for (const r of eStats) console.log(`${r.es.padEnd(18)} ${r.src.padEnd(22)} cnt=${r.cnt} email=${r.withEmail} li=${r.withLI}`);

// ── [object Object] BUG ──────────────────────────────────────────────────────
const [oob1] = await db.execute("SELECT COUNT(*) as c FROM contacts WHERE name LIKE '%[object%' OR title LIKE '%[object%'");
const [oob2] = await db.execute("SELECT COUNT(*) as c FROM projects WHERE opportunityRoute LIKE '%[object Object]%' OR equipmentSignals LIKE '%[object Object]%'");
console.log('\n=== [object Object] BUG CHECK ===');
console.log('Contacts with [object...] in name/title:', oob1[0].c);
console.log('Projects with [object Object] in opportunityRoute/equipmentSignals:', oob2[0].c);
const [oob3] = await db.execute("SELECT id, name, opportunityRoute FROM projects WHERE opportunityRoute LIKE '%[object Object]%' LIMIT 3");
for (const r of oob3) console.log(`  Project ${r.id}: ${r.name?.substring(0,40)} | route: ${String(r.opportunityRoute).substring(0,100)}`);

await db.end();
console.log('\n=== AUDIT COMPLETE ===');
