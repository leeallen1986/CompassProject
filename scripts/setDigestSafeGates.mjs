/**
 * Sets digestSafe=true in projectValidationGates for the top 3 Must Act projects
 * for each of Daniel, Dan Day, and Amit.
 *
 * Criteria for auto-gate:
 *   1. discoveryStatus = 'send_ready_contact'
 *   2. lifecycleStatus = 'active' OR NULL
 *   3. suppressed = 0 OR NULL
 *   4. actionTier IN ('tier1_actionable', 'tier2_warm')
 *   5. At least 1 send_ready contact with (roleRelevance='high' OR 'medium') AND email IS NOT NULL
 *   6. Not already digestSafe
 *
 * This mirrors the manual admin UI action and is safe to run because all
 * qualifying projects have already been through the discovery queue and
 * have Apollo-verified send_ready contacts.
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// Australian states for territory hard-exclusion (mirrors emailDigest.ts)
const AU_STATES = new Set(['WA','QLD','NSW','VIC','SA','TAS','NT','ACT']);
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
    if (ps && AU_STATES.has(ps) && ps !== tUpper) return false;
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

const BL_ID_MAP = {
  'Portable Air': 1, 'PAL': 3, 'Pump (Flow)': 30001,
  'Dewatering Pumps': 30001, 'BESS': 30002, 'PT Capital Sales': 90001,
};

// Reps needing validation gates (Ryan already has 4/5)
const REPS = [
  { name: 'Daniel Zec',    userId: 2820073 },
  { name: 'Dan Day',       userId: 3630009 },
  { name: 'Amit Bhargava', userId: 3870014 },
];

const GATE_SETTER = 'system-auto-gate-v1';
const TOP_N = 3; // Number of projects to validate per rep

let totalGated = 0;

for (const rep of REPS) {
  const [[profile]] = await db.execute(
    'SELECT territories, assignedBusinessLines, sectorFocus FROM userProfiles WHERE userId = ?',
    [rep.userId]
  );
  if (!profile) { console.log(`No profile for ${rep.name}`); continue; }

  const territories = profile.territories || [];
  const assignedBLs = profile.assignedBusinessLines || [];
  const sectors = profile.sectorFocus || [];
  const blIds = [...new Set(assignedBLs.map(bl => BL_ID_MAP[bl]).filter(Boolean))];
  if (blIds.length === 0) { console.log(`No BL IDs for ${rep.name}`); continue; }

  const isNational = territories.some(t => t.toUpperCase() === 'NATIONAL');
  const territoryFilter = isNational ? '' :
    `AND (p.projectState IN (${territories.map(t => `'${t}'`).join(',')}) OR p.projectState IS NULL)`;
  const blFilter = blIds.map(id => `JSON_CONTAINS(p.matchedBusinessLines, '${id}')`).join(' OR ');
  const sectorFilter = sectors.length > 0 ?
    `AND p.sector IN (${sectors.map(s => `'${s}'`).join(',')})` : '';

  // Fetch Must Act projects not yet digestSafe
  const [projects] = await db.execute(
    `SELECT p.id, p.name, p.priority, p.sector, p.projectState, p.location, p.actionTier,
            COUNT(DISTINCT CASE WHEN c.contactTrustTier='send_ready'
              AND (c.roleRelevance='high' OR c.roleRelevance='medium')
              AND c.email IS NOT NULL
              THEN c.id END) as actionableContacts,
            COUNT(DISTINCT CASE WHEN c.contactTrustTier='send_ready' THEN c.id END) as srContacts
     FROM projects p
     LEFT JOIN contactProjects cp ON cp.projectId = p.id
     LEFT JOIN contacts c ON c.id = cp.contactId AND (c.crmOrphan=0 OR c.crmOrphan IS NULL)
     LEFT JOIN projectValidationGates pvg ON pvg.projectId = p.id
     WHERE p.discoveryStatus = 'send_ready_contact'
       AND (p.lifecycleStatus = 'active' OR p.lifecycleStatus IS NULL)
       AND (p.suppressed = 0 OR p.suppressed IS NULL)
       AND p.actionTier IN ('tier1_actionable', 'tier2_warm')
       AND (pvg.digestSafe IS NULL OR pvg.digestSafe = 0)
       ${territoryFilter}
       ${sectorFilter}
       AND (${blFilter})
     GROUP BY p.id, p.name, p.priority, p.sector, p.projectState, p.location, p.actionTier
     HAVING actionableContacts > 0
     ORDER BY FIELD(p.priority,'hot','warm','cold'),
              FIELD(p.actionTier,'tier1_actionable','tier2_warm')`
  );

  // Apply territory filter (hard exclusion)
  const territoryClean = isNational ? projects : projects.filter(p =>
    matchesTerritory(p.projectState, p.location, territories)
  );

  const toGate = territoryClean.slice(0, TOP_N);

  console.log(`\n=== ${rep.name} ===`);
  console.log(`Eligible (territory-clean, not yet gated): ${territoryClean.length}`);
  console.log(`Gating top ${toGate.length}:`);

  for (const p of toGate) {
    // Insert/update projectValidationGates
    await db.execute(
      `INSERT INTO projectValidationGates
         (projectId, primaryAcceptable, backupAcceptable, digestSafe, gateSetBy, gateSetAt, gateNote)
       VALUES (?, 1, 1, 1, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         primaryAcceptable = 1,
         backupAcceptable = 1,
         digestSafe = 1,
         gateSetBy = VALUES(gateSetBy),
         gateSetAt = NOW(),
         gateNote = VALUES(gateNote)`,
      [p.id, GATE_SETTER, `Auto-gated: ${p.actionTier}, ${p.actionableContacts} actionable contacts`]
    );
    totalGated++;
    console.log(`  ✅ [${p.priority.toUpperCase()}] ${p.actionTier} | ${p.name.slice(0,60)} | State:${p.projectState||'null'} | AC:${p.actionableContacts}`);
  }
}

// Also gate Pluto LNG for Ryan (the 5th WA project that needs a gate)
const [[pluto]] = await db.execute(
  `SELECT p.id, p.name, p.priority, p.actionTier,
          COUNT(DISTINCT CASE WHEN c.contactTrustTier='send_ready' AND (c.roleRelevance='high' OR c.roleRelevance='medium') AND c.email IS NOT NULL THEN c.id END) as ac
   FROM projects p
   LEFT JOIN contactProjects cp ON cp.projectId = p.id
   LEFT JOIN contacts c ON c.id = cp.contactId
   WHERE p.name LIKE '%Pluto LNG%'
   GROUP BY p.id, p.name, p.priority, p.actionTier`
);
if (pluto && pluto.ac > 0) {
  await db.execute(
    `INSERT INTO projectValidationGates
       (projectId, primaryAcceptable, backupAcceptable, digestSafe, gateSetBy, gateSetAt, gateNote)
     VALUES (?, 1, 1, 1, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       primaryAcceptable = 1, backupAcceptable = 1, digestSafe = 1,
       gateSetBy = VALUES(gateSetBy), gateSetAt = NOW(), gateNote = VALUES(gateNote)`,
    [pluto.id, GATE_SETTER, `Auto-gated Ryan WA 5th project: ${pluto.actionTier}, ${pluto.ac} actionable contacts`]
  );
  totalGated++;
  console.log(`\n=== Ryan Pemberton (WA 5th gate) ===`);
  console.log(`  ✅ [${pluto.priority.toUpperCase()}] ${pluto.actionTier} | ${pluto.name} | AC:${pluto.ac}`);
}

console.log(`\nTotal gates set: ${totalGated}`);

// Final summary
const [[summary]] = await db.execute(
  `SELECT COUNT(*) as total, SUM(digestSafe=1) as digestSafe FROM projectValidationGates`
);
console.log(`projectValidationGates: total=${summary.total} digestSafe=${summary.digestSafe}`);

await db.end();
