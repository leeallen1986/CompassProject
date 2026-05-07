import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// Get Ryan's WA tier 1/2 projects with overview and opportunityRoute
const [projects] = await db.execute(`
  SELECT p.id, p.name, p.priority, p.sector, p.projectState, p.actionTier,
         p.opportunityRoute, p.overview, p.equipmentSignals, p.productLane,
         (SELECT COUNT(*) FROM contacts c JOIN contactProjects cp ON cp.contactId=c.id
          WHERE cp.projectId=p.id AND c.contactTrustTier='send_ready'
            AND c.roleRelevance IN ('high','medium')) as actionableContacts,
         (SELECT COUNT(*) FROM contacts c JOIN contactProjects cp ON cp.contactId=c.id
          WHERE cp.projectId=p.id AND c.contactTrustTier='send_ready') as srContacts
  FROM projects p
  WHERE p.lifecycleStatus='active' AND p.suppressed=0
    AND p.actionTier IN (1,2)
    AND (p.projectState='WA' OR p.projectState IS NULL)
    AND JSON_CONTAINS(p.matchedBusinessLines, '1')
  ORDER BY p.actionTier ASC, p.priority DESC
`);

console.log(`\nRyan's WA tier 1/2 pool: ${projects.length} projects\n`);
for (const p of projects) {
  const text = `${p.name} ${p.overview || ''} ${p.opportunityRoute || ''}`.toLowerCase();
  
  // Check negative signals
  const hardNeg = [
    ['school|primary school|high school|secondary school|college|university|tafe|education|childcare|kindergarten', 'SCHOOL/EDU'],
    ['hospital|health|aged care|nursing home|medical centre|community health|mental health|ambulance', 'HEALTH'],
    ['residential|apartment|townhouse|housing estate|retirement village|social housing|affordable housing', 'RESIDENTIAL'],
    ['community centre|recreation centre|sports centre|library|museum|art gallery|cultural centre|civic', 'CIVIC'],
  ];
  const softNeg = [
    ['wind farm|wind turbine|wind energy|offshore wind|onshore wind', 'WIND'],
    ['battery storage|bess|grid-scale battery|utility battery|battery energy storage', 'BESS'],
    ['desalination|desal plant|water treatment|wastewater treatment|sewage treatment', 'DESAL/WATER'],
    ['solar farm|solar park|photovoltaic|pv farm|solar generation', 'SOLAR'],
    ['road upgrade|road widening|highway upgrade|intersection upgrade|footpath|footbridge|pedestrian bridge', 'MINOR CIVIL'],
    ['office fitout|commercial fitout|retail fitout|fit-out|fitout|refurbishment|renovation|office building', 'FITOUT'],
  ];
  const posSignals = ['drilling','blast hole','blasthole','exploration','mine development','mining','quarrying','commissioning','shutdown','turnaround','plant air','abrasive blast','sandblast','pneumatic','compressor','portable air','contractor fleet','remote site','oil','gas','lng','pipeline','offshore','refinery','mineral processing','ore processing'];
  const explicitSignals = ['compressor','portable air','air compressor','cfm','psi','pneumatic','abrasive blast','sandblast','drilling','blast hole','blasthole','shutdown','turnaround','plant air','instrument air','commissioning air','tie-in','contractor fleet'];
  
  const hasExplicit = explicitSignals.some(kw => text.includes(kw));
  const hasPos = posSignals.some(kw => text.includes(kw));
  
  let gateStatus = '✓ PASS';
  let gateReason = '';
  
  for (const [pat, label] of hardNeg) {
    if (new RegExp(`\\b(${pat})\\b`).test(text)) {
      gateStatus = '✗ SUPPRESS';
      gateReason = label;
      break;
    }
  }
  if (gateStatus === '✓ PASS') {
    for (const [pat, label] of softNeg) {
      if (new RegExp(`\\b(${pat})\\b`).test(text) && !hasExplicit) {
        gateStatus = '⚠ MONITOR';
        gateReason = label;
        break;
      }
    }
  }
  if (gateStatus === '✓ PASS' && !hasPos && !hasExplicit) {
    gateStatus = '⚠ MONITOR';
    gateReason = 'no positive signal';
  }
  
  const tier = p.actionTier === 1 ? 'T1' : 'T2';
  const ac = p.actionableContacts;
  const sr = p.srContacts;
  console.log(`[${tier}][${p.priority?.toUpperCase() || '?'}] ${gateStatus.padEnd(12)} ${(p.name || '').slice(0,55).padEnd(55)} | ${(p.sector||'').padEnd(12)} | AC=${ac} SR=${sr} | ${gateReason}`);
}

await db.end();
