import { getDb } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();

  // ===== STEP 1: Duplicate check — Port Hedland (450042) vs Nelson Point (450043) =====
  console.log('\n===== DUPLICATE CHECK: 450042 vs 450043 =====');
  const dupResult = await db.execute(sql`
    SELECT id, name, location, projectState, owner, stage, stageCode, value, capexGrade,
           opportunityRoute, lifecycleStatus, overview, contractors, equipmentSignals,
           createdAt, updatedAt, duplicateClusterId, mergedIntoId
    FROM projects WHERE id IN (450042, 450043)
  `);
  const dupRows = (dupResult as any)[0] as any[];
  for (const r of dupRows) {
    console.log(`\nID: ${r.id}`);
    console.log(`  Name: ${r.name}`);
    console.log(`  Location: ${r.location} | State: ${r.projectState}`);
    console.log(`  Owner: ${r.owner}`);
    console.log(`  Stage: ${r.stage} (${r.stageCode})`);
    console.log(`  Value: ${r.value} | Grade: ${r.capexGrade}`);
    console.log(`  Route: ${r.opportunityRoute}`);
    console.log(`  Overview: ${(r.overview || '').substring(0, 350)}`);
    console.log(`  Contractors: ${typeof r.contractors === 'string' ? r.contractors.substring(0, 250) : JSON.stringify(r.contractors)?.substring(0, 250)}`);
    console.log(`  DuplicateClusterId: ${r.duplicateClusterId}`);
    console.log(`  MergedIntoId: ${r.mergedIntoId}`);
  }

  // ===== STEP 2: Send-ready contacts for 3 true WA projects =====
  const projectIds = [450042, 330015, 1020027];
  for (const pid of projectIds) {
    console.log(`\n\n===== SEND-READY CONTACTS: Project ${pid} =====`);
    const cResult = await db.execute(sql`
      SELECT c.id, c.name, c.title, c.company, c.email, c.verificationScore,
             c.contactTrustTier, c.linkedin, c.roleBucket, c.enrichmentSource,
             c.verificationStatus, c.confidenceScore, c.emailVerified
      FROM contacts c
      JOIN contactProjects cp ON cp.contactId = c.id
      WHERE cp.projectId = ${pid}
        AND c.contactTrustTier = 'send_ready'
      ORDER BY c.verificationScore DESC
    `);
    const cRows = (cResult as any)[0] as any[];
    console.log(`  Count: ${cRows.length}`);
    for (const c of cRows) {
      console.log(`  ---`);
      console.log(`  Name: ${c.name}`);
      console.log(`  Title: ${c.title}`);
      console.log(`  Company: ${c.company}`);
      console.log(`  Email: ${c.email} (verScore: ${c.verificationScore}, emailVerified: ${c.emailVerified})`);
      console.log(`  RoleBucket: ${c.roleBucket}`);
      console.log(`  TrustTier: ${c.contactTrustTier} | VerStatus: ${c.verificationStatus} | Confidence: ${c.confidenceScore}`);
      console.log(`  Source: ${c.enrichmentSource}`);
      console.log(`  LinkedIn: ${c.linkedin || 'none'}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
