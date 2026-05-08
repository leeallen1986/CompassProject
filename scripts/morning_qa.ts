import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  
  // List all tables to find correct names
  const tables = await db.execute(sql`SHOW TABLES`);
  console.log('=== ALL TABLES ===');
  for (const row of (tables[0] as any[])) {
    console.log('  ', Object.values(row)[0]);
  }
  
  console.log('\n=== PIPELINE RUNS (last 5) ===');
  const runs = await db.execute(sql`SELECT * FROM pipelineRuns ORDER BY startedAt DESC LIMIT 5`);
  for (const r of (runs[0] as any[])) {
    console.log(JSON.stringify(r, null, 2));
    console.log('---');
  }
  
  console.log('\n=== DISCOVERY STATUS DISTRIBUTION ===');
  const discoveryStats = await db.execute(sql`SELECT discoveryStatus, COUNT(*) as cnt FROM projects WHERE discoveryStatus IS NOT NULL GROUP BY discoveryStatus ORDER BY cnt DESC`);
  for (const row of (discoveryStats[0] as any[])) {
    console.log('  ' + row.discoveryStatus + ': ' + row.cnt);
  }
  
  console.log('\n=== CONTACT TRUST TIER DISTRIBUTION ===');
  const trustTiers = await db.execute(sql`SELECT contactTrustTier, COUNT(*) as cnt FROM contacts GROUP BY contactTrustTier ORDER BY cnt DESC`);
  for (const row of (trustTiers[0] as any[])) {
    console.log('  ' + row.contactTrustTier + ': ' + row.cnt);
  }
  
  console.log('\n=== TOTAL PROJECTS ===');
  const totalProjects = await db.execute(sql`SELECT COUNT(*) as cnt FROM projects`);
  console.log('  Total:', (totalProjects[0] as any[])[0]?.cnt);
  
  console.log('\n=== PRIORITY DISTRIBUTION ===');
  const priorities = await db.execute(sql`SELECT priority, COUNT(*) as cnt FROM projects GROUP BY priority ORDER BY cnt DESC`);
  for (const row of (priorities[0] as any[])) {
    console.log('  ' + row.priority + ': ' + row.cnt);
  }
  
  // Find the contact-project junction table
  console.log('\n=== CONTACT-PROJECT JUNCTION ===');
  try {
    const cpCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM contactProjects`);
    console.log('  contactProjects rows:', (cpCount[0] as any[])[0]?.cnt);
    
    const sendReadyProj = await db.execute(sql`
      SELECT COUNT(DISTINCT cp.projectId) as cnt
      FROM contactProjects cp
      JOIN contacts c ON c.id = cp.contactId
      WHERE c.contactTrustTier = 'send_ready'
    `);
    console.log('  Projects with send_ready contacts:', (sendReadyProj[0] as any[])[0]?.cnt);
  } catch (e: any) {
    console.log('  Error:', e.message?.slice(0, 100));
  }
  
  // Pipeline activity
  console.log('\n=== PIPELINE ACTIVITY (last 10) ===');
  try {
    const activity = await db.execute(sql`SELECT * FROM pipelineActivity ORDER BY createdAt DESC LIMIT 10`);
    for (const row of (activity[0] as any[])) {
      console.log('  ' + row.createdAt + ' | ' + row.type + ' | ' + (row.message || row.note || '').slice(0, 80));
    }
  } catch (e: any) {
    console.log('  Error:', e.message?.slice(0, 100));
  }
  
  process.exit(0);
}
main();
