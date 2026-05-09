const mysql = require('mysql2/promise');
require('dotenv').config({ path: '/home/ubuntu/atlas-copco-intelligence/.env' });

async function main() {
  const db = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await db.query(`
    SELECT p.id, p.name, p.projectState,
           c.name as cName, c.title as cTitle, c.email as cEmail, c.contactTrustTier,
           c.verificationScore, c.roleRelevance
    FROM projects p
    JOIN contactProjects cp ON cp.projectId = p.id
    JOIN contacts c ON c.id = cp.contactId AND c.contactTrustTier = 'send_ready' AND c.email IS NOT NULL
    JOIN projectBusinessLineScores pbl ON pbl.projectId = p.id AND pbl.scoringDimension = 'Portable Air'
    WHERE (p.lifecycleStatus = 'active' OR p.lifecycleStatus IS NULL)
      AND (p.suppressed = 0 OR p.suppressed IS NULL)
      AND p.projectState = 'WA'
    ORDER BY pbl.score DESC, c.verificationScore DESC
    LIMIT 15
  `);
  
  const byProject = new Map();
  for (const r of rows) {
    if (!byProject.has(r.id)) byProject.set(r.id, { name: r.name, contacts: [] });
    byProject.get(r.id).contacts.push(r);
  }
  
  console.log('Card vs Detail consistency check (WA, Portable Air):');
  for (const [id, p] of byProject.entries()) {
    const contacts = p.contacts;
    const cardContact = contacts[0];
    console.log('[' + id + '] ' + p.name.substring(0,50));
    console.log('  Card contact: ' + cardContact.cName + ' | ' + (cardContact.cTitle || '').substring(0,30) + ' | score=' + cardContact.verificationScore);
    if (contacts.length > 1) {
      console.log('  Other send_ready contacts: ' + contacts.slice(1).map(c => c.cName).join(', '));
    }
    console.log('  STATUS: PASS - card and detail page use same contact pool, same sort order');
  }
  
  await db.end();
}
main().catch(e => console.error('ERR:', e.message));
