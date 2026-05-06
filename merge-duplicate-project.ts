/**
 * Merge Nelson Point Car Dumper 6 (ID 450043) INTO Port Hedland Car Dumper 6 (ID 450042)
 *
 * Steps:
 * 1. Reassign all child records from 450043 → 450042 (with dedup guards)
 * 2. Set 450043.mergedIntoId = 450042 and lifecycleStatus = 'merged'
 * 3. Verify final state
 */
import { getDb } from './server/db';
import { sql } from 'drizzle-orm';

const SOURCE_ID = 450043; // Nelson Point Car Dumper 6 — to be merged away
const TARGET_ID = 450042; // Port Hedland Car Dumper 6 — canonical record

async function run(label: string, query: () => Promise<any>) {
  try {
    await query();
    console.log(`  ✓ ${label}`);
  } catch (e: any) {
    if (e?.cause?.code === 'ER_DUP_ENTRY' || e?.message?.includes('Duplicate entry')) {
      console.log(`  ⚠ ${label} — skipped (duplicate already exists in target)`);
    } else {
      console.log(`  ✗ ${label} — ERROR: ${e.message}`);
    }
  }
}

async function count(db: any, table: string, col: string, id: number): Promise<number> {
  const r = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM \`${table}\` WHERE \`${col}\` = ${id}`));
  return Number((r as any)[0][0]?.cnt || 0);
}

async function main() {
  const db = await getDb();
  console.log(`\n===== MERGE: ${SOURCE_ID} → ${TARGET_ID} =====`);

  // Pre-merge counts
  console.log('\n--- Pre-merge counts ---');
  const tables = [
    { table: 'contactProjects', col: 'projectId' },
    { table: 'pipelineClaims', col: 'projectId' },
    { table: 'projectFeedback', col: 'projectId' },
    { table: 'projectBusinessLineScores', col: 'projectId' },
    { table: 'outreachEmails', col: 'projectId' },
    { table: 'projectEnrichmentCache', col: 'projectId' },
    { table: 'apolloCreditLog', col: 'projectId' },
    { table: 'projectoryEnrichmentLog', col: 'projectId' },
    { table: 'contractorProjectLinks', col: 'projectId' },
    { table: 'userActivity', col: 'projectId' },
    { table: 'collateralProjectMatches', col: 'projectId' },
    { table: 'projectActions', col: 'projectId' },
    { table: 'contactCandidateSlates', col: 'projectId' },
    { table: 'hunterVerificationLog', col: 'projectId' },
    { table: 'projectValidationGates', col: 'projectId' },
  ];
  for (const t of tables) {
    const src = await count(db, t.table, t.col, SOURCE_ID);
    const tgt = await count(db, t.table, t.col, TARGET_ID);
    if (src > 0) console.log(`  ${t.table}: source=${src}, target=${tgt}`);
  }

  console.log('\n--- Reassigning records ---');

  // contactProjects: skip if contact already linked to target
  await run('contactProjects — move unique contacts', async () => {
    await db.execute(sql`
      UPDATE contactProjects SET projectId = ${TARGET_ID}
      WHERE projectId = ${SOURCE_ID}
        AND contactId NOT IN (
          SELECT contactId FROM (SELECT contactId FROM contactProjects WHERE projectId = ${TARGET_ID}) AS existing
        )
    `);
  });
  // Delete any remaining (already linked to target)
  await run('contactProjects — delete duplicates', async () => {
    await db.execute(sql`DELETE FROM contactProjects WHERE projectId = ${SOURCE_ID}`);
  });

  // pipelineClaims
  await run('pipelineClaims', async () => {
    await db.execute(sql`UPDATE pipelineClaims SET projectId = ${TARGET_ID} WHERE projectId = ${SOURCE_ID}`);
  });

  // projectFeedback: skip if user already has feedback on target
  await run('projectFeedback — move unique', async () => {
    await db.execute(sql`
      UPDATE projectFeedback SET projectId = ${TARGET_ID}
      WHERE projectId = ${SOURCE_ID}
        AND userId NOT IN (
          SELECT userId FROM (SELECT userId FROM projectFeedback WHERE projectId = ${TARGET_ID}) AS existing
        )
    `);
  });
  await run('projectFeedback — delete duplicates', async () => {
    await db.execute(sql`DELETE FROM projectFeedback WHERE projectId = ${SOURCE_ID}`);
  });

  // projectBusinessLineScores
  await run('projectBusinessLineScores — move unique', async () => {
    await db.execute(sql`
      UPDATE projectBusinessLineScores SET projectId = ${TARGET_ID}
      WHERE projectId = ${SOURCE_ID}
        AND businessLineId NOT IN (
          SELECT businessLineId FROM (SELECT businessLineId FROM projectBusinessLineScores WHERE projectId = ${TARGET_ID}) AS existing
        )
    `);
  });
  await run('projectBusinessLineScores — delete duplicates', async () => {
    await db.execute(sql`DELETE FROM projectBusinessLineScores WHERE projectId = ${SOURCE_ID}`);
  });

  // outreachEmails
  await run('outreachEmails', async () => {
    await db.execute(sql`UPDATE outreachEmails SET projectId = ${TARGET_ID} WHERE projectId = ${SOURCE_ID}`);
  });

  // projectEnrichmentCache — delete source (cache will rebuild on next enrichment)
  await run('projectEnrichmentCache — delete source', async () => {
    await db.execute(sql`DELETE FROM projectEnrichmentCache WHERE projectId = ${SOURCE_ID}`);
  });

  // apolloCreditLog
  await run('apolloCreditLog', async () => {
    await db.execute(sql`UPDATE apolloCreditLog SET projectId = ${TARGET_ID} WHERE projectId = ${SOURCE_ID}`);
  });

  // projectoryEnrichmentLog
  await run('projectoryEnrichmentLog', async () => {
    await db.execute(sql`UPDATE projectoryEnrichmentLog SET projectId = ${TARGET_ID} WHERE projectId = ${SOURCE_ID}`);
  });

  // contractorProjectLinks
  await run('contractorProjectLinks — move unique', async () => {
    await db.execute(sql`
      UPDATE contractorProjectLinks SET projectId = ${TARGET_ID}
      WHERE projectId = ${SOURCE_ID}
        AND contractorId NOT IN (
          SELECT contractorId FROM (SELECT contractorId FROM contractorProjectLinks WHERE projectId = ${TARGET_ID}) AS existing
        )
    `);
  });
  await run('contractorProjectLinks — delete duplicates', async () => {
    await db.execute(sql`DELETE FROM contractorProjectLinks WHERE projectId = ${SOURCE_ID}`);
  });

  // userActivity
  await run('userActivity', async () => {
    await db.execute(sql`UPDATE userActivity SET projectId = ${TARGET_ID} WHERE projectId = ${SOURCE_ID}`);
  });

  // collateralProjectMatches
  await run('collateralProjectMatches', async () => {
    await db.execute(sql`UPDATE collateralProjectMatches SET projectId = ${TARGET_ID} WHERE projectId = ${SOURCE_ID}`);
  });

  // projectActions
  await run('projectActions', async () => {
    await db.execute(sql`UPDATE projectActions SET projectId = ${TARGET_ID} WHERE projectId = ${SOURCE_ID}`);
  });

  // contactCandidateSlates
  await run('contactCandidateSlates', async () => {
    await db.execute(sql`UPDATE contactCandidateSlates SET projectId = ${TARGET_ID} WHERE projectId = ${SOURCE_ID}`);
  });

  // hunterVerificationLog
  await run('hunterVerificationLog', async () => {
    await db.execute(sql`UPDATE hunterVerificationLog SET projectId = ${TARGET_ID} WHERE projectId = ${SOURCE_ID}`);
  });

  // projectValidationGates — source has no gate (we only gated 450042), just delete if any
  await run('projectValidationGates — delete source gate if any', async () => {
    await db.execute(sql`DELETE FROM projectValidationGates WHERE projectId = ${SOURCE_ID}`);
  });

  // contactValidationActions (projectId is nullable context field)
  await run('contactValidationActions', async () => {
    await db.execute(sql`UPDATE contactValidationActions SET projectId = ${TARGET_ID} WHERE projectId = ${SOURCE_ID}`);
  });

  // dismissedActions (if it has projectId — check schema)
  // dismissedActions has no projectId per schema, skip

  // ===== Suppress the source project =====
  console.log('\n--- Suppressing source project ---');
  await run('Set mergedIntoId and lifecycleStatus on source', async () => {
    await db.execute(sql`
      UPDATE projects
      SET mergedIntoId = ${TARGET_ID},
          lifecycleStatus = 'merged',
          discoveryStatus = 'merged',
          updatedAt = NOW()
      WHERE id = ${SOURCE_ID}
    `);
  });

  // ===== Update duplicateClusterId on both =====
  const clusterKey = `merge-${TARGET_ID}`;
  await run('Set duplicateClusterId on target', async () => {
    await db.execute(sql`UPDATE projects SET duplicateClusterId = ${clusterKey} WHERE id = ${TARGET_ID}`);
  });
  await run('Set duplicateClusterId on source', async () => {
    await db.execute(sql`UPDATE projects SET duplicateClusterId = ${clusterKey} WHERE id = ${SOURCE_ID}`);
  });

  // ===== Post-merge verification =====
  console.log('\n--- Post-merge verification ---');
  const srcProject = await db.execute(sql`SELECT id, name, lifecycleStatus, discoveryStatus, mergedIntoId, duplicateClusterId FROM projects WHERE id = ${SOURCE_ID}`);
  const tgtProject = await db.execute(sql`SELECT id, name, lifecycleStatus, discoveryStatus, mergedIntoId, duplicateClusterId FROM projects WHERE id = ${TARGET_ID}`);
  const src = (srcProject as any)[0][0];
  const tgt = (tgtProject as any)[0][0];
  console.log(`\nSource (${SOURCE_ID}): ${src?.name}`);
  console.log(`  lifecycleStatus: ${src?.lifecycleStatus} | discoveryStatus: ${src?.discoveryStatus}`);
  console.log(`  mergedIntoId: ${src?.mergedIntoId} | cluster: ${src?.duplicateClusterId}`);
  console.log(`\nTarget (${TARGET_ID}): ${tgt?.name}`);
  console.log(`  lifecycleStatus: ${tgt?.lifecycleStatus} | discoveryStatus: ${tgt?.discoveryStatus}`);
  console.log(`  mergedIntoId: ${tgt?.mergedIntoId} | cluster: ${tgt?.duplicateClusterId}`);

  // Contact count on target
  const contactCount = await count(db, 'contactProjects', 'projectId', TARGET_ID);
  console.log(`\nContacts linked to target (${TARGET_ID}): ${contactCount}`);

  // Remaining records on source
  let remainingTotal = 0;
  for (const t of tables) {
    const src = await count(db, t.table, t.col, SOURCE_ID);
    if (src > 0) {
      console.log(`  ⚠ ${t.table} still has ${src} records for source ${SOURCE_ID}`);
      remainingTotal += src;
    }
  }
  if (remainingTotal === 0) {
    console.log('  ✓ All child records cleared from source');
  }

  console.log('\n===== MERGE COMPLETE =====');
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
