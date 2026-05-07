/**
 * Dry-run digest preview for the four key reps.
 * Simulates the exact digest engine logic (scoreAndFilterProjects + classifyBriefReadiness)
 * without sending any emails, and reports:
 *   - Total matched projects
 *   - Must Act count (tier1/2 + high/med send_ready contact)
 *   - Should Act count (tier1/2 + low-rel send_ready contact)
 *   - Monitor Only count
 *   - digestSafe gate status
 *   - Top 5 Must Act projects with contact details
 *   - Territory contamination check
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// Rep user IDs
const REP_IDS = {
  'Ryan Pemberton':  2340043,
  'Daniel Zec':      2820073,
  'Dan Day':         3630009,
  'Amit Bhargava':   3870014,
};

// Business line ID mapping
const BL_ID_MAP = {
  'Portable Air': 1,
  'PAL': 3,
  'Pump (Flow)': 30001,
  'Dewatering Pumps': 30001,
  'BESS': 30002,
  'PT Capital Sales': 90001,
  'PT All Capital Sales': 90001,
};

// Australian states for territory hard-exclusion
const AU_STATES = new Set(['WA','QLD','NSW','VIC','SA','TAS','NT','ACT']);

// State keyword map (mirrors emailDigest.ts)
const STATE_KEYWORDS = {
  WA:  ['western australia', 'wa', 'perth', 'pilbara', 'kalgoorlie', 'karratha', 'port hedland', 'newman', 'geraldton', 'bunbury', 'broome', 'norseman', 'murchison', 'kwinana'],
  QLD: ['queensland', 'qld', 'brisbane', 'townsville', 'mackay', 'gladstone', 'rockhampton', 'cairns', 'bowen basin', 'moranbah', 'emerald'],
  NSW: ['new south wales', 'nsw', 'sydney', 'newcastle', 'hunter valley', 'wollongong', 'broken hill', 'orange', 'dubbo', 'mudgee', 'goulburn', 'wakehurst'],
  VIC: ['victoria', 'vic', 'melbourne', 'geelong', 'ballarat', 'bendigo', 'latrobe', 'euroa'],
  SA:  ['south australia', 'sa', 'adelaide', 'olympic dam', 'whyalla', 'port augusta'],
  NT:  ['northern territory', 'nt', 'darwin', 'alice springs', 'tennant creek', 'katherine'],
  TAS: ['tasmania', 'tas', 'hobart', 'launceston'],
  ACT: ['australian capital territory', 'act', 'canberra'],
};

function matchesTerritory(projectState, location, territories) {
  if (!territories || territories.length === 0) return true;
  if (territories.some(t => t.toUpperCase() === 'NATIONAL')) return true;
  const ps = (projectState || '').toUpperCase();
  const loc = (location || '').toLowerCase();
  return territories.some(t => {
    const tUpper = t.toUpperCase();
    // Hard exclusion: projectState is a different AU state
    if (ps && AU_STATES.has(ps) && ps !== tUpper) return false;
    // Location keyword match
    const keywords = STATE_KEYWORDS[tUpper] || [t.toLowerCase()];
    return keywords.some(kw => {
      if (kw.length <= 3) {
        const re = new RegExp(`(?:^|[\\s,;/|()\-])${kw}(?:$|[\\s,;/|()\-])`, 'i');
        return re.test(loc);
      }
      return loc.includes(kw);
    });
  });
}

for (const [repName, userId] of Object.entries(REP_IDS)) {
  // Get user profile
  const [[profile]] = await db.execute(
    'SELECT territories, assignedBusinessLines, sectorFocus FROM userProfiles WHERE userId = ?',
    [userId]
  );
  if (!profile) { console.log(`No profile for ${repName}`); continue; }

  const territories = profile.territories || [];
  const assignedBLs = profile.assignedBusinessLines || [];
  const sectors = profile.sectorFocus || [];

  // Map BL names to IDs
  const blIds = [...new Set(assignedBLs.map(bl => BL_ID_MAP[bl]).filter(Boolean))];
  if (blIds.length === 0) { console.log(`No BL IDs for ${repName}`); continue; }

  const isNational = territories.some(t => t.toUpperCase() === 'NATIONAL');
  const territoryFilter = isNational ? '' :
    `AND (p.projectState IN (${territories.map(t => `'${t}'`).join(',')}) OR p.projectState IS NULL)`;
  const blFilter = blIds.map(id => `JSON_CONTAINS(p.matchedBusinessLines, '${id}')`).join(' OR ');
  const sectorFilter = sectors.length > 0 ?
    `AND p.sector IN (${sectors.map(s => `'${s}'`).join(',')})` : '';

  // Fetch projects with contact stats
  const [projects] = await db.execute(
    `SELECT p.id, p.name, p.priority, p.sector, p.projectState, p.location,
            p.actionTier, p.tenderCloseDate,
            COUNT(DISTINCT CASE WHEN c.contactTrustTier='send_ready'
              AND (c.roleRelevance='high' OR c.roleRelevance='medium')
              AND (c.email IS NOT NULL OR c.linkedin IS NOT NULL)
              THEN c.id END) as actionableContacts,
            COUNT(DISTINCT CASE WHEN c.contactTrustTier='send_ready' THEN c.id END) as srContacts,
            MAX(CASE WHEN c.contactTrustTier='send_ready' AND (c.roleRelevance='high' OR c.roleRelevance='medium') AND c.email IS NOT NULL THEN c.name END) as bestContactName,
            MAX(CASE WHEN c.contactTrustTier='send_ready' AND (c.roleRelevance='high' OR c.roleRelevance='medium') AND c.email IS NOT NULL THEN c.title END) as bestContactTitle,
            MAX(CASE WHEN c.contactTrustTier='send_ready' AND (c.roleRelevance='high' OR c.roleRelevance='medium') AND c.email IS NOT NULL THEN c.email END) as bestContactEmail
     FROM projects p
     LEFT JOIN contactProjects cp ON cp.projectId = p.id
     LEFT JOIN contacts c ON c.id = cp.contactId
       AND (c.crmOrphan = 0 OR c.crmOrphan IS NULL)
     WHERE p.discoveryStatus = 'send_ready_contact'
       AND (p.lifecycleStatus = 'active' OR p.lifecycleStatus IS NULL)
       AND (p.suppressed = 0 OR p.suppressed IS NULL)
       ${territoryFilter}
       ${sectorFilter}
       AND (${blFilter})
     GROUP BY p.id, p.name, p.priority, p.sector, p.projectState, p.location, p.actionTier, p.tenderCloseDate
     ORDER BY FIELD(p.priority,'hot','warm','cold'),
              FIELD(p.actionTier,'tier1_actionable','tier2_warm','tier3_monitor',NULL)`
  );

  // Apply territory filter (mirrors scoreAndFilterProjects hard filter)
  const territoryFiltered = isNational ? projects : projects.filter(p =>
    matchesTerritory(p.projectState, p.location, territories)
  );

  // Check digestSafe gate
  const projectIds = territoryFiltered.map(p => p.id);
  let digestSafeIds = new Set();
  if (projectIds.length > 0) {
    const [gates] = await db.execute(
      `SELECT projectId FROM projectValidationGates WHERE digestSafe=1 AND projectId IN (${projectIds.join(',')})`,
    );
    digestSafeIds = new Set(gates.map(g => g.projectId));
  }

  // Classify readiness
  let mustAct = 0, lowRelSR = 0, discoveryNeeded = 0, monitorOnly = 0;
  let territoryLeaks = 0;
  const mustActRows = [];

  for (const p of projects) {
    // Territory check (for audit — flag leaks)
    const inTerritory = matchesTerritory(p.projectState, p.location, territories);
    if (!isNational && !inTerritory) { territoryLeaks++; continue; }

    const tier = p.actionTier || 'tier3_monitor';
    if (tier === 'tier3_monitor') { monitorOnly++; continue; }
    if (tier === 'tier2_warm' && p.priority === 'cold') { monitorOnly++; continue; }

    if (p.actionableContacts > 0) {
      mustAct++;
      mustActRows.push(p);
    } else if (p.srContacts > 0) {
      lowRelSR++;
    } else {
      discoveryNeeded++;
    }
  }

  const digestSafeCount = mustActRows.filter(p => digestSafeIds.has(p.id)).length;
  const thresholdPasses = digestSafeCount >= 3;

  console.log(`\n${'='.repeat(65)}`);
  console.log(`REP: ${repName} (userId=${userId})`);
  console.log(`Territories: ${territories.join(', ')} | BLs: ${assignedBLs.join(', ')}`);
  console.log(`Sectors: ${sectors.join(', ')}`);
  console.log(`\nPool summary:`);
  console.log(`  Total matched (pre-territory filter): ${projects.length}`);
  console.log(`  Territory leaks excluded:             ${territoryLeaks}`);
  console.log(`  After territory filter:               ${projects.length - territoryLeaks}`);
  console.log(`  Must Act (tier1/2 + high/med SR):     ${mustAct}`);
  console.log(`    → digestSafe validated:             ${digestSafeCount} / ${mustAct}`);
  console.log(`    → Threshold (≥3 digestSafe):        ${thresholdPasses ? '✅ PASSES' : '❌ BLOCKED (need validation gates)'}`);
  console.log(`  Low-rel SR only (no high/med):        ${lowRelSR}`);
  console.log(`  Discovery Needed (no SR contacts):    ${discoveryNeeded}`);
  console.log(`  Monitor Only (tier3/suppressed):      ${monitorOnly}`);

  if (mustActRows.length > 0) {
    console.log(`\nTop Must Act projects (up to 5):`);
    for (const p of mustActRows.slice(0, 5)) {
      const safe = digestSafeIds.has(p.id) ? '✅ digestSafe' : '⚠️  needs gate';
      const close = p.tenderCloseDate ? new Date(p.tenderCloseDate).toISOString().slice(0,10) : 'no date';
      console.log(`  [${p.priority.toUpperCase()}] ${p.actionTier} | ${safe}`);
      console.log(`    ${p.name.slice(0,60)}`);
      console.log(`    State:${p.projectState||'null'} | ${p.sector} | AC:${p.actionableContacts} SR:${p.srContacts} | close:${close}`);
      if (p.bestContactName) {
        console.log(`    Best contact: ${p.bestContactName} (${p.bestContactTitle||'?'}) — ${p.bestContactEmail}`);
      }
    }
  }
}

await db.end();
