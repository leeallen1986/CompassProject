import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Step 1: Find pump projects with named_unverified contacts that have emails + verificationScore >= 70
const [projects] = await conn.execute(`
  SELECT p.id, p.name, p.location,
         pbl.score as pumpScore,
         COUNT(c.id) as eligibleForPromotion
  FROM projects p
  JOIN projectBusinessLineScores pbl ON pbl.projectId = p.id AND pbl.scoringDimension = 'Pump/Dewatering'
  JOIN contactProjects cp ON cp.projectId = p.id
  JOIN contacts c ON c.id = cp.contactId
  WHERE c.contactTrustTier = 'named_unverified'
  AND c.rejectionReason IS NULL
  AND c.email IS NOT NULL AND c.email != ''
  AND c.verificationScore >= 70
  AND pbl.score >= 60
  GROUP BY p.id, p.name, p.location, pbl.score
  HAVING eligibleForPromotion >= 2
  ORDER BY eligibleForPromotion DESC, pbl.score DESC
  LIMIT 15
`);

console.log(`Found ${projects.length} pump projects with promotable named_unverified contacts:`);
projects.forEach(p => {
  console.log(`  ID:${p.id} [${p.pumpScore}] ${p.name} (${p.location}) — ${p.eligibleForPromotion} eligible`);
});

// Step 2: Count total eligible
const [totalRow] = await conn.execute(`
  SELECT COUNT(*) as cnt FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  JOIN projectBusinessLineScores pbl ON pbl.projectId = cp.projectId AND pbl.scoringDimension = 'Pump/Dewatering'
  WHERE c.contactTrustTier = 'named_unverified'
  AND c.rejectionReason IS NULL
  AND c.email IS NOT NULL AND c.email != ''
  AND c.verificationScore >= 70
  AND pbl.score >= 60
`);
console.log(`\nTotal eligible for promotion: ${totalRow[0].cnt}`);

// Step 3: Promote — update contactTrustTier from named_unverified to send_ready
// Only for contacts with verificationScore >= 80 (high confidence) on pump projects
const [promoted] = await conn.execute(`
  UPDATE contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  JOIN projectBusinessLineScores pbl ON pbl.projectId = cp.projectId AND pbl.scoringDimension = 'Pump/Dewatering'
  SET c.contactTrustTier = 'send_ready'
  WHERE c.contactTrustTier = 'named_unverified'
  AND c.rejectionReason IS NULL
  AND c.email IS NOT NULL AND c.email != ''
  AND c.verificationScore >= 80
  AND pbl.score >= 60
`);
console.log(`\nPromoted to send_ready (verificationScore >= 80): ${promoted.affectedRows} contacts`);

// Step 4: Promote contacts with verificationScore 70-79 on high-score pump projects (>= 80)
const [promoted2] = await conn.execute(`
  UPDATE contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  JOIN projectBusinessLineScores pbl ON pbl.projectId = cp.projectId AND pbl.scoringDimension = 'Pump/Dewatering'
  SET c.contactTrustTier = 'send_ready'
  WHERE c.contactTrustTier = 'named_unverified'
  AND c.rejectionReason IS NULL
  AND c.email IS NOT NULL AND c.email != ''
  AND c.verificationScore >= 70
  AND pbl.score >= 80
`);
console.log(`Promoted to send_ready (verificationScore 70-79 on high-pump projects): ${promoted2.affectedRows} contacts`);

// Step 5: Post-promotion check — how many projects moved from 0 to 1+ send_ready
const [after] = await conn.execute(`
  SELECT p.id, p.name, p.location,
         pbl.score as pumpScore,
         COUNT(c.id) as sendReadyCount
  FROM projects p
  JOIN projectBusinessLineScores pbl ON pbl.projectId = p.id AND pbl.scoringDimension = 'Pump/Dewatering'
  JOIN contactProjects cp ON cp.projectId = p.id
  JOIN contacts c ON c.id = cp.contactId
  WHERE c.contactTrustTier = 'send_ready'
  AND c.rejectionReason IS NULL
  AND pbl.score >= 80
  GROUP BY p.id, p.name, p.location, pbl.score
  ORDER BY sendReadyCount DESC, pbl.score DESC
  LIMIT 20
`);

console.log(`\nTop pump projects by send_ready count after promotion:`);
after.forEach(p => {
  console.log(`  ID:${p.id} [${p.pumpScore}] ${p.name} — ${p.sendReadyCount} send_ready`);
});

await conn.end();
