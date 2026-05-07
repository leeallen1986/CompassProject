/**
 * Fresh digest previews for Daniel Zec, Dan Day, and Amit Bhargava.
 * Shows: digestSafe count, threshold status, top Must Act projects, best contacts per project.
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// Rep definitions (userId, name, territories)
const reps = [
  { userId: 2820073, name: 'Daniel Zec',     territories: ['NSW','VIC','SA','TAS'] },
  { userId: 3630009, name: 'Dan Day',         territories: ['SA','QLD','VIC','NSW','TAS'] },
  { userId: 3870014, name: 'Amit Bhargava',   territories: ['WA','NSW','QLD','VIC','SA','TAS','NT','ACT'] },
];

// Get all digestSafe gated projects
const [gated] = await db.execute(
  `SELECT p.id, p.name, p.priority, p.actionTier, p.sector, p.projectState, p.location,
          p.discoveryStatus, p.lifecycleStatus, p.suppressed
   FROM projectValidationGates pvg
   JOIN projects p ON p.id = pvg.projectId
   WHERE pvg.digestSafe = 1 AND p.suppressed = 0 AND (p.lifecycleStatus = 'active' OR p.lifecycleStatus IS NULL)`
);

// Get all send_ready contacts for gated projects
const projectIds = gated.map(p => p.id);
const [allContacts] = await db.execute(
  `SELECT c.id, c.name, c.title, c.email, c.roleRelevance, c.contactTrustTier,
          c.verificationStatus, cp.projectId
   FROM contacts c
   JOIN contactProjects cp ON cp.contactId = c.id
   WHERE cp.projectId IN (${projectIds.join(',')})
     AND c.contactTrustTier = 'send_ready'
     AND (c.crmOrphan = 0 OR c.crmOrphan IS NULL)`
);

const contactsByProject = new Map();
for (const c of allContacts) {
  if (!contactsByProject.has(c.projectId)) contactsByProject.set(c.projectId, []);
  contactsByProject.get(c.projectId).push(c);
}

// Territory matching (mirrors the digest engine logic)
function projectMatchesTerritory(project, territories) {
  if (!territories || territories.length === 0) return true;
  if (territories.includes('National')) return true;
  const state = project.projectState;
  const location = (project.location || '').toLowerCase();
  if (state && territories.includes(state)) return true;
  // Location string fallback
  const stateKeywords = {
    NSW: ['new south wales','sydney','newcastle','wollongong','canberra'],
    VIC: ['victoria','melbourne','geelong','ballarat'],
    QLD: ['queensland','brisbane','cairns','townsville','mackay','gladstone','rockhampton'],
    SA:  ['south australia','adelaide','port augusta','whyalla'],
    WA:  ['western australia','perth','pilbara','kimberley','kalgoorlie','port hedland'],
    TAS: ['tasmania','hobart','launceston'],
    NT:  ['northern territory','darwin','alice springs','katherine'],
    ACT: ['canberra','act'],
  };
  for (const terr of territories) {
    const kws = stateKeywords[terr] || [];
    if (kws.some(kw => location.includes(kw))) return true;
  }
  return false;
}

const THRESHOLD = 3;

for (const rep of reps) {
  // Filter gated projects to rep's territory
  const repProjects = gated.filter(p => projectMatchesTerritory(p, rep.territories));

  // Count digestSafe (all repProjects are digestSafe by definition)
  const digestSafeCount = repProjects.length;
  const thresholdPasses = digestSafeCount >= THRESHOLD;

  // Must Act = tier1_actionable projects with at least 1 send_ready contact
  const mustAct = repProjects.filter(p =>
    p.actionTier === 'tier1_actionable' &&
    (contactsByProject.get(p.id) || []).length > 0
  );

  // Sort: hot first, then tier1, then by contact count desc
  const sorted = [...mustAct].sort((a, b) => {
    const pOrder = { hot: 1, warm: 2, cold: 3 };
    const pa = pOrder[a.priority] || 9;
    const pb = pOrder[b.priority] || 9;
    if (pa !== pb) return pa - pb;
    return (contactsByProject.get(b.id) || []).length - (contactsByProject.get(a.id) || []).length;
  });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`REP: ${rep.name}`);
  console.log(`Territories: ${rep.territories.join(', ')}`);
  console.log(`digestSafe projects in territory: ${digestSafeCount} / threshold: ${THRESHOLD} → ${thresholdPasses ? '✅ PASSES' : '❌ BELOW THRESHOLD'}`);
  console.log(`Must Act (tier1 + contacts): ${mustAct.length}`);
  console.log(`\nTop Must Act projects for digest:`);

  const top = sorted.slice(0, 5);
  for (const p of top) {
    const contacts = contactsByProject.get(p.id) || [];
    const high = contacts.filter(c => c.roleRelevance === 'high');
    const med = contacts.filter(c => c.roleRelevance === 'medium');
    const best = contacts.sort((a,b) => {
      const r = {high:1,medium:2,low:3};
      return (r[a.roleRelevance]||9)-(r[b.roleRelevance]||9);
    })[0];

    console.log(`\n  [${p.priority.toUpperCase()}] ${p.name}`);
    console.log(`    State: ${p.projectState||'null'} | Sector: ${p.sector}`);
    console.log(`    Contacts: ${contacts.length} (high:${high.length} med:${med.length})`);
    if (best) {
      console.log(`    Best: ${best.name} — ${best.title||'no title'}`);
      console.log(`    Email: ${best.email||'NONE'} | Relevance: ${best.roleRelevance}`);
    }
  }

  if (sorted.length === 0) {
    console.log('  (no Must Act projects in territory with gated contacts)');
  }

  // Summary line
  console.log(`\n  DIGEST PREVIEW SUMMARY:`);
  console.log(`  Subject: PT Capital Sales — Weekly Intelligence Brief | ${rep.territories.slice(0,2).join('/')} — Week of 4–10 May 2026`);
  console.log(`  Projects in email: ${Math.min(sorted.length, 5)} Must Act + ${Math.max(0, Math.min(repProjects.length - mustAct.length, 3))} warm`);
  console.log(`  Send status: ${thresholdPasses ? 'READY — will send on next Monday run' : 'BLOCKED — needs more digestSafe projects'}`);
}

await db.end();
