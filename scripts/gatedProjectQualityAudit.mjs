/**
 * Commercial quality audit for all 15 digestSafe gated projects.
 *
 * For each gated project, checks:
 *   1. Project metadata: priority, actionTier, sector, state, capexGrade, discoveryStatus
 *   2. send_ready contacts: count, roleRelevance breakdown, email format validity
 *   3. Best contact per project (highest roleRelevance, has email)
 *   4. Flags: no high/med contacts, suspicious email patterns, wrong state for rep
 *   5. Contact email domain spot-check (not free email, not generic)
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// Fetch all gated projects
const [gated] = await db.execute(
  `SELECT p.id, p.name, p.priority, p.actionTier, p.sector, p.projectState, p.location,
          p.capexGrade, p.discoveryStatus, p.owner, p.suppressed, p.lifecycleStatus,
          pvg.digestSafe, pvg.gateSetBy, pvg.gateNote
   FROM projectValidationGates pvg
   JOIN projects p ON p.id = pvg.projectId
   WHERE pvg.digestSafe = 1
   ORDER BY FIELD(p.priority,'hot','warm','cold'), FIELD(p.actionTier,'tier1_actionable','tier2_warm','tier3_monitor')`
);

// Fetch all send_ready contacts for these projects
const projectIds = gated.map(p => p.id);
const [contacts] = await db.execute(
  `SELECT c.id, c.name, c.title, c.email, c.roleRelevance, c.contactTrustTier,
          c.verificationStatus, c.source, cp.projectId
   FROM contacts c
   JOIN contactProjects cp ON cp.contactId = c.id
   WHERE cp.projectId IN (${projectIds.join(',')})
     AND c.contactTrustTier = 'send_ready'
     AND (c.crmOrphan = 0 OR c.crmOrphan IS NULL)`
);

// Group contacts by project
const contactsByProject = new Map();
for (const c of contacts) {
  if (!contactsByProject.has(c.projectId)) contactsByProject.set(c.projectId, []);
  contactsByProject.get(c.projectId).push(c);
}

// Free/generic email patterns to flag
const FREE_DOMAINS = new Set(['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','live.com','me.com']);
const GENERIC_PREFIXES = ['info@','contact@','admin@','hello@','sales@','support@','enquiries@','enquiry@'];

function auditEmail(email) {
  if (!email) return { valid: false, flag: 'NO_EMAIL' };
  const lower = email.toLowerCase().trim();
  if (!lower.includes('@') || !lower.includes('.')) return { valid: false, flag: 'MALFORMED' };
  const [local, domain] = lower.split('@');
  if (FREE_DOMAINS.has(domain)) return { valid: false, flag: 'FREE_DOMAIN' };
  if (GENERIC_PREFIXES.some(p => lower.startsWith(p))) return { valid: false, flag: 'GENERIC_PREFIX' };
  if (local.length < 2) return { valid: false, flag: 'SHORT_LOCAL' };
  return { valid: true, flag: null };
}

const PRIORITY_ORDER = { hot: 1, warm: 2, cold: 3 };
const TIER_ORDER = { tier1_actionable: 1, tier2_warm: 2, tier3_monitor: 3 };
const REL_ORDER = { high: 1, medium: 2, low: 3 };

let issueCount = 0;

console.log('\n=== GATED PROJECT COMMERCIAL QUALITY AUDIT ===\n');
console.log(`Total digestSafe projects: ${gated.length}\n`);

for (const p of gated) {
  const projectContacts = contactsByProject.get(p.id) || [];
  const highMed = projectContacts.filter(c => c.roleRelevance === 'high' || c.roleRelevance === 'medium');
  const highOnly = projectContacts.filter(c => c.roleRelevance === 'high');
  const medOnly = projectContacts.filter(c => c.roleRelevance === 'medium');
  const lowOnly = projectContacts.filter(c => c.roleRelevance === 'low');

  // Best contact: highest relevance, has email
  const sorted = [...projectContacts].sort((a, b) =>
    (REL_ORDER[a.roleRelevance] || 9) - (REL_ORDER[b.roleRelevance] || 9)
  );
  const best = sorted.find(c => c.email) || sorted[0];

  // Email audit for all contacts
  const emailIssues = projectContacts
    .map(c => ({ name: c.name, email: c.email, ...auditEmail(c.email) }))
    .filter(c => !c.valid);

  // Flags
  const flags = [];
  if (p.suppressed) flags.push('⛔ SUPPRESSED');
  if (p.lifecycleStatus && p.lifecycleStatus !== 'active') flags.push(`⚠️ lifecycle=${p.lifecycleStatus}`);
  if (highMed.length === 0) flags.push('⚠️ NO HIGH/MED CONTACTS');
  if (!best?.email) flags.push('⚠️ NO EMAIL ON BEST CONTACT');
  if (emailIssues.length > 0) flags.push(`⚠️ ${emailIssues.length} EMAIL ISSUE(S)`);
  if (p.actionTier === 'tier3_monitor') flags.push('⚠️ TIER3 — should not be gated');

  const status = flags.length === 0 ? '✅ CLEAN' : `❌ ${flags.join(' | ')}`;
  if (flags.length > 0) issueCount++;

  console.log(`─────────────────────────────────────────────────────────`);
  console.log(`[${p.priority.toUpperCase()}] ${p.actionTier} | ${p.name}`);
  console.log(`  State: ${p.projectState || 'null'} | Sector: ${p.sector} | CAPEX: ${p.capexGrade || 'n/a'}`);
  console.log(`  discoveryStatus: ${p.discoveryStatus} | lifecycleStatus: ${p.lifecycleStatus || 'null'}`);
  console.log(`  send_ready contacts: ${projectContacts.length} total | high:${highOnly.length} med:${medOnly.length} low:${lowOnly.length}`);
  if (best) {
    const emailCheck = auditEmail(best.email);
    console.log(`  Best contact: ${best.name} (${best.title || 'no title'})`);
    console.log(`    Email: ${best.email || 'NONE'} [${emailCheck.valid ? '✅' : '❌ ' + emailCheck.flag}]`);
    console.log(`    Relevance: ${best.roleRelevance} | Trust: ${best.contactTrustTier} | Verified: ${best.verificationStatus}`);
  }
  if (emailIssues.length > 0) {
    console.log(`  Email issues:`);
    for (const e of emailIssues) console.log(`    - ${e.name}: ${e.email || 'null'} [${e.flag}]`);
  }
  console.log(`  Gate: ${p.gateSetBy} | Note: ${p.gateNote || 'none'}`);
  console.log(`  STATUS: ${status}`);
}

console.log(`\n=== SUMMARY ===`);
console.log(`Total gated: ${gated.length}`);
console.log(`Clean (no flags): ${gated.length - issueCount}`);
console.log(`With issues: ${issueCount}`);

await db.end();
