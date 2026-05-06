import 'dotenv/config';
import { getDb } from './server/db';
import { projectValidationGates, projects } from './drizzle/schema';
import { eq, inArray } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) { console.error('No DB'); process.exit(1); }

  const projectIds = [660052, 690069]; // Kwinana Gas, Walyering West-1

  // Fetch project names for confirmation
  const rows = await db.select({ id: projects.id, name: projects.name, projectState: projects.projectState, priority: projects.priority })
    .from(projects)
    .where(inArray(projects.id, projectIds));

  console.log('Projects to gate:');
  for (const r of rows) {
    console.log(`  ID ${r.id}: ${r.name} | state=${r.projectState} | priority=${r.priority}`);
  }

  // Upsert digest-safe gates
  for (const projectId of projectIds) {
    await db.insert(projectValidationGates).values({
      projectId,
      digestSafe: true,
      primaryAcceptable: true,
      backupAcceptable: true,
      gateSetBy: 'admin-final-validation-2026-05-06',
      gateSetAt: new Date(),
      gateNote: 'WA-confirmed HOT project with Apollo-verified send_ready contacts. Gated as digest-safe for WA weekly digest.',
    }).onDuplicateKeyUpdate({
      set: {
        digestSafe: true,
        primaryAcceptable: true,
        backupAcceptable: true,
        gateSetBy: 'admin-final-validation-2026-05-06',
        gateSetAt: new Date(),
        gateNote: 'WA-confirmed HOT project with Apollo-verified send_ready contacts. Gated as digest-safe for WA weekly digest.',
      }
    });
    console.log(`  ✓ Gated project ${projectId} as digest-safe`);
  }

  // Verify
  const gates = await db.select().from(projectValidationGates).where(inArray(projectValidationGates.projectId, projectIds));
  console.log('\nVerification:');
  for (const g of gates) {
    console.log(`  Project ${g.projectId}: digestSafe=${g.digestSafe}, primaryAcceptable=${g.primaryAcceptable}, gateSetBy=${g.gateSetBy}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
