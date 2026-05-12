import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check Apollo API key
const apolloKey = process.env.APOLLO_API_KEY;
console.log('APOLLO_API_KEY present:', !!apolloKey, apolloKey ? '(length: ' + apolloKey.length + ')' : '');

// Rob Gordon contact record
const [rob] = await conn.execute(`
  SELECT c.id, c.name, c.title, c.email, c.contactTrustTier, c.roleRelevance, c.linkedin, c.rejectionReason,
         p.id as projectId, p.name as projectName
  FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  JOIN projects p ON p.id = cp.projectId
  WHERE c.name LIKE '%Rob Gordon%' AND c.rejectionReason IS NULL
`);
console.log('\nRob Gordon records:');
rob.forEach(r => {
  console.log('  ID:', r.id, '| Name:', r.name);
  console.log('  Title:', r.title);
  console.log('  Email:', r.email);
  console.log('  LinkedIn:', r.linkedinUrl);
  console.log('  Trust:', r.contactTrustTier, '| Relevance:', r.roleRelevance);
  console.log('  Project:', r.projectName, '(ID:', r.projectId + ')');
});

// Named_unverified backlog for top stuck projects
const [backlog] = await conn.execute(`
  SELECT p.id, p.name, p.location,
         pbl.score as pumpScore,
         COUNT(c.id) as namedUnverified,
         SUM(CASE WHEN c.email IS NOT NULL AND c.email != '' THEN 1 ELSE 0 END) as hasEmail
  FROM projects p
  JOIN projectBusinessLineScores pbl ON pbl.projectId = p.id AND pbl.scoringDimension = 'Pump/Dewatering'
  JOIN contactProjects cp ON cp.projectId = p.id
  JOIN contacts c ON c.id = cp.contactId
  WHERE c.contactTrustTier = 'named_unverified'
  AND c.rejectionReason IS NULL
  AND pbl.score >= 60
  GROUP BY p.id, p.name, p.location, pbl.score
  HAVING namedUnverified >= 3
  ORDER BY namedUnverified DESC
  LIMIT 10
`);
console.log('\nTop named_unverified backlogs (pump score >= 60):');
backlog.forEach(r => {
  console.log(`  ID:${r.id} [${r.pumpScore}] ${r.name}`);
  console.log(`    Location: ${r.location} | named_unverified: ${r.namedUnverified} (with email: ${r.hasEmail})`);
});

// Cairns Water and Bass Strait status
const [zero] = await conn.execute(`
  SELECT p.id, p.name, p.location, p.stage,
         COUNT(c.id) as activeContacts
  FROM projects p
  LEFT JOIN contactProjects cp ON cp.projectId = p.id
  LEFT JOIN contacts c ON c.id = cp.contactId AND c.rejectionReason IS NULL
  WHERE p.id IN (720008, 690073)
  GROUP BY p.id, p.name, p.location, p.stage
`);
console.log('\nZero-contact projects:');
zero.forEach(r => {
  console.log(`  ID:${r.id} ${r.name} | Location: ${r.location} | Stage: ${r.stage} | Active: ${r.activeContacts}`);
});

await conn.end();
