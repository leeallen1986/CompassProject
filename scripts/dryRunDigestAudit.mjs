import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// Business line ID mapping
// 1=Portable Air, 3=PAL, 30001=Pump(Flow), 30002=BESS, 90001=PT All Capital Sales
const reps = [
  { name: 'Ryan Pemberton',  territories: ['WA'],                        blIds: [1, 90001],   sectors: ['mining','oil_gas','infrastructure','energy'] },
  { name: 'Daniel Zec',      territories: ['NSW','VIC','SA','TAS'],       blIds: [1],          sectors: ['mining','infrastructure','oil_gas','industrial'] },
  { name: 'Dan Day',         territories: ['SA','QLD','VIC','NSW','TAS'], blIds: [30001],      sectors: ['mining','infrastructure','water','civils'] },
  { name: 'Amit Bhargava',   territories: ['NATIONAL'],                   blIds: [3, 30002],   sectors: ['energy','infrastructure','industrial'] },
];

for (const rep of reps) {
  const isNational = rep.territories.includes('NATIONAL');
  const territoryFilter = isNational ? '' :
    `AND (p.projectState IN (${rep.territories.map(t => `'${t}'`).join(',')}) OR p.projectState IS NULL)`;
  const blFilter = rep.blIds.map(id => `JSON_CONTAINS(p.matchedBusinessLines, '${id}')`).join(' OR ');
  const sectorFilter = `AND p.sector IN (${rep.sectors.map(s => `'${s}'`).join(',')})`;

  const [projects] = await db.execute(
    `SELECT p.id, p.name, p.priority, p.sector, p.projectState, p.actionTier,
            p.tenderCloseDate,
            COUNT(DISTINCT CASE WHEN c.contactTrustTier='send_ready'
              AND (c.roleRelevance='high' OR c.roleRelevance='medium')
              AND (c.email IS NOT NULL OR c.linkedin IS NOT NULL)
              THEN c.id END) as actionableContacts,
            COUNT(DISTINCT CASE WHEN c.contactTrustTier='send_ready' THEN c.id END) as srContacts
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
     GROUP BY p.id, p.name, p.priority, p.sector, p.projectState, p.actionTier, p.tenderCloseDate
     ORDER BY FIELD(p.priority,'hot','warm','cold'),
              FIELD(p.actionTier,'tier1_actionable','tier2_warm','tier3_monitor',NULL)`
  );

  let mustAct = 0, lowRelSR = 0, discoveryNeeded = 0, monitorOnly = 0;
  const mustActRows = [];
  const lowRelRows = [];

  for (const p of projects) {
    const tier = p.actionTier || 'tier3_monitor';
    // Tier gate
    if (tier === 'tier3_monitor') { monitorOnly++; continue; }
    if (tier === 'tier2_warm' && p.priority === 'cold') { monitorOnly++; continue; }

    if (p.actionableContacts > 0) {
      mustAct++;
      mustActRows.push(p);
    } else if (p.srContacts > 0) {
      lowRelSR++;
      lowRelRows.push(p);
    } else {
      discoveryNeeded++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`REP: ${rep.name}`);
  console.log(`Territories: ${rep.territories.join(', ')} | Sectors: ${rep.sectors.join(', ')}`);
  console.log(`Total matched projects: ${projects.length}`);
  console.log(`  Must Act (tier1/2 + high/med SR contact): ${mustAct}`);
  console.log(`  Low-rel SR contacts only (no high/med):   ${lowRelSR}`);
  console.log(`  Discovery Needed (no SR contacts):        ${discoveryNeeded}`);
  console.log(`  Monitor Only (tier3 or suppressed):       ${monitorOnly}`);

  if (mustActRows.length > 0) {
    console.log(`\nTop Must Act projects (up to 5):`);
    for (const p of mustActRows.slice(0, 5)) {
      const close = p.tenderCloseDate ? new Date(p.tenderCloseDate).toISOString().slice(0,10) : 'no date';
      console.log(`  [${p.priority.toUpperCase()}] ${p.actionTier} | ${p.name.slice(0,55)} | ${p.projectState || 'null'} | ${p.sector} | AC:${p.actionableContacts} SR:${p.srContacts} | close:${close}`);
    }
  }

  if (lowRelRows.length > 0) {
    console.log(`\nLow-rel SR contacts (no high/med roleRelevance — these are the 'Should Act' pool):`);
    for (const p of lowRelRows.slice(0, 5)) {
      console.log(`  [${p.priority.toUpperCase()}] ${p.actionTier} | ${p.name.slice(0,55)} | ${p.projectState || 'null'} | SR:${p.srContacts}`);
    }
  }
}

// Overall pool health
const [[poolStats]] = await db.execute(
  `SELECT
     COUNT(DISTINCT p.id) as totalSRProjects,
     COUNT(DISTINCT CASE WHEN p.actionTier='tier1_actionable' THEN p.id END) as tier1Projects,
     COUNT(DISTINCT CASE WHEN p.actionTier='tier2_warm' THEN p.id END) as tier2Projects,
     COUNT(DISTINCT CASE WHEN p.actionTier='tier3_monitor' THEN p.id END) as tier3Projects,
     COUNT(DISTINCT CASE WHEN p.priority='hot' THEN p.id END) as hotProjects,
     COUNT(DISTINCT CASE WHEN p.priority='warm' THEN p.id END) as warmProjects
   FROM projects p
   WHERE p.discoveryStatus = 'send_ready_contact'
     AND (p.lifecycleStatus = 'active' OR p.lifecycleStatus IS NULL)
     AND (p.suppressed = 0 OR p.suppressed IS NULL)`
);

const [[contactStats]] = await db.execute(
  `SELECT
     COUNT(DISTINCT c.id) as totalSR,
     COUNT(DISTINCT CASE WHEN c.roleRelevance='high' THEN c.id END) as highRel,
     COUNT(DISTINCT CASE WHEN c.roleRelevance='medium' THEN c.id END) as medRel,
     COUNT(DISTINCT CASE WHEN c.roleRelevance='low' THEN c.id END) as lowRel
   FROM contacts c
   WHERE c.contactTrustTier = 'send_ready'
     AND (c.crmOrphan = 0 OR c.crmOrphan IS NULL)`
);

console.log(`\n${'='.repeat(60)}`);
console.log(`GLOBAL POOL HEALTH`);
console.log(`Projects: total=${poolStats.totalSRProjects} | tier1=${poolStats.tier1Projects} | tier2=${poolStats.tier2Projects} | tier3=${poolStats.tier3Projects} | hot=${poolStats.hotProjects} | warm=${poolStats.warmProjects}`);
console.log(`Contacts: total=${contactStats.totalSR} | high=${contactStats.highRel} | medium=${contactStats.medRel} | low=${contactStats.lowRel}`);

await db.end();
