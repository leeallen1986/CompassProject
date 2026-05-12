import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Dan's top east-coast pump projects (strict filter, no WA/NT)
const [rows] = await conn.execute(`
  SELECT p.id, p.name, p.location, p.stage, p.overview, p.contractors,
         pbl.score as pumpScore,
         SUM(CASE WHEN c.rejectionReason IS NULL THEN 1 ELSE 0 END) as activeContacts,
         SUM(CASE WHEN c.rejectionReason IS NULL AND c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) as sendReadyContacts
  FROM projects p
  JOIN projectBusinessLineScores pbl ON pbl.projectId = p.id
  LEFT JOIN contactProjects cp ON cp.projectId = p.id
  LEFT JOIN contacts c ON c.id = cp.contactId
  WHERE pbl.scoringDimension = 'Pump/Dewatering'
  AND pbl.score >= 50
  AND (p.suppressed IS NULL OR p.suppressed = 0)
  AND (p.location LIKE '%QLD%' OR p.location LIKE '%NSW%' OR p.location LIKE '%VIC%' 
       OR p.location LIKE '%SA%' OR p.location LIKE '%TAS%'
       OR p.location LIKE '%Queensland%' OR p.location LIKE '%New South Wales%' 
       OR p.location LIKE '%Victoria%' OR p.location LIKE '%South Australia%' OR p.location LIKE '%Tasmania%')
  AND p.location NOT LIKE '%WA%' AND p.location NOT LIKE '%, NT%' AND p.location NOT LIKE '%NT,%'
  GROUP BY p.id, p.name, p.location, p.stage, p.overview, p.contractors, pbl.score
  ORDER BY pbl.score DESC, sendReadyContacts DESC
  LIMIT 8
`);

console.log('Dan Day top pump projects (strict east-coast):');
for (const p of rows) {
  const status = p.sendReadyContacts > 0 ? 'STRONG' : p.activeContacts > 0 ? 'has-contacts' : 'NO CONTACTS';
  console.log(`\n  [${status}] ID:${p.id} [${p.pumpScore}] ${p.name}`);
  console.log(`  Location: ${p.location} | Stage: ${p.stage}`);
  console.log(`  Contacts: ${p.activeContacts} active (${p.sendReadyContacts} send_ready)`);
  
  if (p.sendReadyContacts > 0 || p.activeContacts > 0) {
    const [contacts] = await conn.execute(`
      SELECT c.name, c.title, c.email, c.contactTrustTier, c.roleRelevance
      FROM contacts c
      JOIN contactProjects cp ON cp.contactId = c.id
      WHERE cp.projectId = ? AND c.rejectionReason IS NULL
      ORDER BY CASE c.contactTrustTier WHEN 'send_ready' THEN 1 WHEN 'named_unverified' THEN 2 ELSE 3 END,
               CASE c.roleRelevance WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
      LIMIT 3
    `, [p.id]);
    contacts.forEach((c, i) => {
      const marker = i === 0 ? '  ★ PRIMARY' : `    ${i+1}.    `;
      console.log(`  ${marker} ${c.name} | ${c.title}`);
      console.log(`             Trust: ${c.contactTrustTier} | Email: ${c.email || 'none'}`);
    });
  }
}

await conn.end();
