import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Port of Newcastle contacts with roleRelevance
const [contacts] = await conn.execute(`
  SELECT c.contactTrustTier, c.roleRelevance, c.title, c.name
  FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  WHERE cp.projectId = 690059 AND c.rejectionReason IS NULL
`);

const [proj] = await conn.execute(`
  SELECT p.stage, p.overview, p.contractors,
         pbl.score as pumpScore
  FROM projects p
  JOIN projectBusinessLineScores pbl ON pbl.projectId = p.id
  WHERE p.id = 690059 AND pbl.scoringDimension = 'Pump/Dewatering'
`);

const project = proj[0];
const pumpBLScore = project.pumpScore;
const projStage = (project.stage || '').toLowerCase();

const hasPumpContact = contacts.some(c =>
  c.contactTrustTier === 'send_ready' &&
  (c.roleRelevance === 'high' || c.roleRelevance === 'medium')
);
const isAwarded = ['awarded', 'construction'].some(s => projStage.includes(s));
const contractors = JSON.parse(project.contractors || '[]');
const hasContractorInfo = contractors.length > 0;
const overviewLower = (project.overview || '').toLowerCase();
const isEarlyStage = ['feasibility', 'exploration', 'scoping', 'concept'].some(s => projStage.includes(s));
const hasPumpWaterContext = /water|dewater|pump|excavat|tunnel|marine|dredg|flood|sewer|dam|bore|wellpoint|cofferdam|trench|slurry/.test(overviewLower);

console.log('Port of Newcastle (690059) action mode analysis:');
console.log('  pumpBLScore:', pumpBLScore);
console.log('  hasPumpContact (send_ready + high/medium roleRelevance):', hasPumpContact);
console.log('  isAwarded (contains construction):', isAwarded);
console.log('  isEarlyStage:', isEarlyStage);
console.log('  hasContractorInfo:', hasContractorInfo, '(contractors count:', contractors.length, ')');
console.log('  hasPumpWaterContext:', hasPumpWaterContext);
console.log('  stage:', project.stage);

// Apply real logic
let actionMode;
if (pumpBLScore >= 60 && hasPumpContact && !isEarlyStage) {
  actionMode = 'direct_pursue';
} else if (isAwarded && hasContractorInfo && hasPumpWaterContext) {
  actionMode = 'map_package';
} else if (pumpBLScore >= 40 && !hasPumpContact && !isEarlyStage) {
  actionMode = 'find_site_contact';
} else if (isEarlyStage || pumpBLScore < 30) {
  actionMode = 'reference_only';
} else {
  actionMode = 'find_site_contact (fallback)';
}
console.log('  => Action Mode (real laneScoring logic):', actionMode);

console.log('\nContacts:');
contacts.forEach(c => {
  console.log(`  ${c.name} | ${c.title} | trust: ${c.contactTrustTier} | roleRelevance: ${c.roleRelevance}`);
});

await conn.end();
