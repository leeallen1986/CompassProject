import 'dotenv/config';
import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);
// Dan's top 3 strong projects
const projectIds = [690059, 630006, 1200018];
for (const pid of projectIds) {
  const [proj] = await conn.execute('SELECT id, name, location, stage, overview, contractors FROM projects WHERE id = ?', [pid]);
  const [pbl] = await conn.execute('SELECT score FROM projectBusinessLineScores WHERE projectId = ? AND scoringDimension = ?', [pid, 'Pump/Dewatering']);
  const [contacts] = await conn.execute(`SELECT c.name, c.title, c.email, c.contactTrustTier, c.roleRelevance FROM contacts c JOIN contactProjects cp ON cp.contactId = c.id WHERE cp.projectId = ? AND c.rejectionReason IS NULL ORDER BY CASE c.contactTrustTier WHEN 'send_ready' THEN 1 WHEN 'named_unverified' THEN 2 ELSE 3 END, CASE c.roleRelevance WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 4`, [pid]);
  const p = proj[0];
  const pumpScore = pbl[0]?.score || 0;
  const projStage = (p.stage || '').toLowerCase();
  const hasPumpContact = contacts.some(c => c.contactTrustTier === 'send_ready' && (c.roleRelevance === 'high' || c.roleRelevance === 'medium'));
  const isEarlyStage = ['feasibility', 'exploration', 'scoping', 'concept'].some(s => projStage.includes(s));
  let actionMode;
  if (pumpScore >= 60 && hasPumpContact && !isEarlyStage) actionMode = 'direct_pursue';
  else if (pumpScore >= 40 && !isEarlyStage) actionMode = 'find_site_contact';
  else actionMode = 'reference_only';
  console.log(`ID: ${p.id} | ${p.name}`);
  console.log(`  Location: ${p.location} | Stage: ${p.stage}`);
  console.log(`  Pump Score: ${pumpScore} | Action Mode: ${actionMode}`);
  contacts.slice(0, 3).forEach((c, i) => {
    console.log(`  ${i===0?'PRIMARY':'   '+i+'.'} ${c.name} | ${c.title} | ${c.contactTrustTier} | ${c.roleRelevance} | ${c.email || 'no-email'}`);
  });
}
await conn.end();
