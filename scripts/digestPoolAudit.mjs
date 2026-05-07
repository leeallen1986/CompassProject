import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

const reps = [
  { name: 'Ryan Pemberton', territories: ['WA'], sectors: ['mining','oil_gas','infrastructure','energy'] },
  { name: 'Daniel Zec', territories: ['NSW','VIC','SA','TAS'], sectors: ['mining','infrastructure','oil_gas','industrial'] },
  { name: 'Dan Day', territories: ['SA','QLD','VIC','NSW','TAS'], sectors: ['mining','infrastructure','water','civils'] },
  { name: 'Amit Bhargava', territories: ['WA','NSW','QLD','VIC','SA','TAS','NT','ACT'], sectors: ['energy','infrastructure','industrial'] },
];

const results = [];

for (const rep of reps) {
  const terrList = rep.territories.map(t => `'${t}'`).join(',');
  const secList = rep.sectors.map(s => `'${s}'`).join(',');

  const baseWhere = `
    c.contactTrustTier = 'send_ready'
    AND (c.crmOrphan = 0 OR c.crmOrphan IS NULL)
    AND c.enrichmentSource != 'manual'
    AND (p.lifecycleStatus = 'active' OR p.lifecycleStatus IS NULL)
    AND (p.suppressed = 0 OR p.suppressed IS NULL)
    AND (p.projectType = 'opportunity' OR p.projectType IS NULL)
    AND (p.projectState IN (${terrList}) OR p.projectCountry = 'AU')
    AND (p.sector IN (${secList}) OR p.sector IS NULL)
  `;

  const joinClause = `
    FROM projects p
    JOIN contactProjects cp ON cp.projectId = p.id
    JOIN contacts c ON c.id = cp.contactId
    WHERE ${baseWhere}
  `;

  const [[total]] = await db.execute(`SELECT COUNT(DISTINCT p.id) as cnt ${joinClause}`);
  const [[hot]] = await db.execute(`SELECT COUNT(DISTINCT p.id) as cnt ${joinClause} AND p.priority = 'hot'`);
  const [[warm]] = await db.execute(`SELECT COUNT(DISTINCT p.id) as cnt ${joinClause} AND p.priority = 'warm'`);
  const [[mustAct]] = await db.execute(`SELECT COUNT(DISTINCT p.id) as cnt ${joinClause} AND p.actionTier = 'must_act'`);
  const [[contacts]] = await db.execute(`SELECT COUNT(DISTINCT c.id) as cnt ${joinClause}`);

  // Top 5 hot/must_act projects for this rep
  const [topProjects] = await db.execute(`
    SELECT p.id, p.name, p.priority, p.actionTier, p.sector, p.projectState,
           MAX(p.lastActivityAt) as lastActivityAt,
           COUNT(DISTINCT c.id) as srContacts
    ${joinClause}
    AND p.priority IN ('hot','warm')
    GROUP BY p.id, p.name, p.priority, p.actionTier, p.sector, p.projectState
    ORDER BY FIELD(p.actionTier,'must_act','act_soon','monitor'), FIELD(p.priority,'hot','warm','cold'), MAX(p.lastActivityAt) DESC
    LIMIT 5
  `);

  results.push({
    rep: rep.name,
    territories: rep.territories.join(', '),
    sectors: rep.sectors.join(', '),
    totalDigestEligibleProjects: total.cnt,
    hotProjects: hot.cnt,
    warmProjects: warm.cnt,
    mustActProjects: mustAct.cnt,
    sendReadyContacts: contacts.cnt,
    topProjects,
  });
}

// Also check overall Must Act quality
const [[totalMustAct]] = await db.execute(`
  SELECT COUNT(DISTINCT p.id) as cnt
  FROM projects p
  JOIN contactProjects cp ON cp.projectId = p.id
  JOIN contacts c ON c.id = cp.contactId
  WHERE c.contactTrustTier = 'send_ready'
    AND (c.crmOrphan = 0 OR c.crmOrphan IS NULL)
    AND c.enrichmentSource != 'manual'
    AND (p.lifecycleStatus = 'active' OR p.lifecycleStatus IS NULL)
    AND (p.suppressed = 0 OR p.suppressed IS NULL)
    AND (p.projectType = 'opportunity' OR p.projectType IS NULL)
    AND p.actionTier = 'must_act'
`);

const [[totalSendReadyProjects]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM projects
  WHERE discoveryStatus = 'send_ready_contact'
    AND (lifecycleStatus = 'active' OR lifecycleStatus IS NULL)
`);

const [[totalSendReadyContacts]] = await db.execute(`
  SELECT COUNT(*) as cnt FROM contacts
  WHERE contactTrustTier = 'send_ready'
    AND (crmOrphan = 0 OR crmOrphan IS NULL)
`);

console.log(JSON.stringify({
  auditDate: new Date().toISOString(),
  globalStats: {
    totalSendReadyContacts: totalSendReadyContacts.cnt,
    totalSendReadyProjects: totalSendReadyProjects.cnt,
    totalMustActWithSendReady: totalMustAct.cnt,
  },
  repPools: results,
}, null, 2));

await db.end();
process.exit(0);
