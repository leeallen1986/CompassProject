import { getDb } from '../server/db';
import { projects, pipelineRuns } from '../drizzle/schema';
import { sql, and, or, like, gte, eq, isNull, ne, isNotNull } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) { console.log('No DB connection'); process.exit(1); }

  // Week window: Mon 21 Apr 00:00 UTC to Sun 27 Apr 23:59 UTC
  const weekStart = new Date('2026-04-21T00:00:00Z');
  const weekEnd = new Date('2026-04-27T23:59:59Z');

  console.log('=== STEP 4-7 SOURCE VALIDATION ===');
  console.log(`Week: ${weekStart.toISOString()} to ${weekEnd.toISOString()}\n`);

  // 1. Pipeline runs this week for Step 4-7 sources
  console.log('--- 1. PIPELINE RUNS THIS WEEK (Step 4-7 counters) ---');
  const [runs] = await db.execute(sql`
    SELECT id, status, triggeredBy, startedAt,
           dmirsProjects, aemoProjects, projectoryProjects, projectoryEnriched, austenderContracts
    FROM pipelineRuns
    WHERE startedAt >= ${weekStart}
    ORDER BY id
  `) as any;

  for (const r of (runs as any[])) {
    console.log(`  Run ${r.id} (${r.status}, ${r.triggeredBy}, ${r.startedAt})`);
    console.log(`    DMIRS: ${r.dmirsProjects}, AEMO: ${r.aemoProjects}, Projectory: ${r.projectoryProjects}, Projectory Enriched: ${r.projectoryEnriched}, AusTender: ${r.austenderContracts}`);
  }

  // 2. Projects created by Step 4-7 sources this week (by projectKey prefix)
  console.log('\n--- 2. PROJECTS FROM STEP 4-7 SOURCES (by projectKey prefix) ---');

  const dmirsProjects = await db.select({
    id: projects.id,
    name: projects.name,
    projectKey: projects.projectKey,
    priority: projects.priority,
    actionTier: projects.actionTier,
    lifecycleStatus: projects.lifecycleStatus,
    staleReason: projects.staleReason,
    suppressed: projects.suppressed,
    suppressionReason: projects.suppressionReason,
    createdAt: projects.createdAt,
    updatedAt: projects.updatedAt,
    matchedBusinessLines: projects.matchedBusinessLines,
    sector: projects.sector,
    location: projects.location,
  }).from(projects)
    .where(and(
      like(projects.projectKey, 'dmirs-%'),
      gte(projects.createdAt, weekStart)
    ));

  const aemoProjects = await db.select({
    id: projects.id,
    name: projects.name,
    projectKey: projects.projectKey,
    priority: projects.priority,
    actionTier: projects.actionTier,
    lifecycleStatus: projects.lifecycleStatus,
    staleReason: projects.staleReason,
    suppressed: projects.suppressed,
    suppressionReason: projects.suppressionReason,
    createdAt: projects.createdAt,
    updatedAt: projects.updatedAt,
    matchedBusinessLines: projects.matchedBusinessLines,
    sector: projects.sector,
    location: projects.location,
  }).from(projects)
    .where(and(
      like(projects.projectKey, 'aemo-%'),
      gte(projects.createdAt, weekStart)
    ));

  const projectoryNewProjects = await db.select({
    id: projects.id,
    name: projects.name,
    projectKey: projects.projectKey,
    priority: projects.priority,
    actionTier: projects.actionTier,
    lifecycleStatus: projects.lifecycleStatus,
    staleReason: projects.staleReason,
    suppressed: projects.suppressed,
    suppressionReason: projects.suppressionReason,
    createdAt: projects.createdAt,
    updatedAt: projects.updatedAt,
    matchedBusinessLines: projects.matchedBusinessLines,
    projectoryEnriched: projects.projectoryEnriched,
    sector: projects.sector,
    location: projects.location,
  }).from(projects)
    .where(and(
      like(projects.projectKey, 'projectory-%'),
      gte(projects.createdAt, weekStart)
    ));

  // Also get projects enriched by Projectory this week (existing projects that got updated)
  const projectoryEnrichedThisWeek = await db.select({
    id: projects.id,
    name: projects.name,
    projectKey: projects.projectKey,
    priority: projects.priority,
    actionTier: projects.actionTier,
    lifecycleStatus: projects.lifecycleStatus,
    staleReason: projects.staleReason,
    suppressed: projects.suppressed,
    suppressionReason: projects.suppressionReason,
    createdAt: projects.createdAt,
    updatedAt: projects.updatedAt,
    matchedBusinessLines: projects.matchedBusinessLines,
    projectoryEnriched: projects.projectoryEnriched,
    sector: projects.sector,
    location: projects.location,
  }).from(projects)
    .where(and(
      eq(projects.projectoryEnriched, true),
      gte(projects.updatedAt, weekStart)
    ));

  console.log(`  DMIRS new projects this week: ${dmirsProjects.length}`);
  for (const p of dmirsProjects) {
    console.log(`    [${p.id}] ${p.name} | priority=${p.priority} tier=${p.actionTier} lifecycle=${p.lifecycleStatus} stale=${p.staleReason} suppressed=${p.suppressed} BLs=${JSON.stringify(p.matchedBusinessLines)}`);
  }

  console.log(`\n  AEMO new projects this week: ${aemoProjects.length}`);
  for (const p of aemoProjects) {
    console.log(`    [${p.id}] ${p.name} | priority=${p.priority} tier=${p.actionTier} lifecycle=${p.lifecycleStatus} stale=${p.staleReason} suppressed=${p.suppressed} BLs=${JSON.stringify(p.matchedBusinessLines)}`);
  }

  console.log(`\n  Projectory new projects this week: ${projectoryNewProjects.length}`);
  for (const p of projectoryNewProjects) {
    console.log(`    [${p.id}] ${p.name} | priority=${p.priority} tier=${p.actionTier} lifecycle=${p.lifecycleStatus} stale=${p.staleReason} suppressed=${p.suppressed} enriched=${p.projectoryEnriched} BLs=${JSON.stringify(p.matchedBusinessLines)}`);
  }

  console.log(`\n  Projectory-enriched existing projects this week: ${projectoryEnrichedThisWeek.length}`);
  // Show first 20
  for (const p of projectoryEnrichedThisWeek.slice(0, 20)) {
    console.log(`    [${p.id}] ${p.name} | priority=${p.priority} tier=${p.actionTier} lifecycle=${p.lifecycleStatus} stale=${p.staleReason} suppressed=${p.suppressed} created=${p.createdAt?.toISOString()?.slice(0,10)}`);
  }
  if (projectoryEnrichedThisWeek.length > 20) {
    console.log(`    ... and ${projectoryEnrichedThisWeek.length - 20} more`);
  }

  // 3. Now check digest eligibility - read the digest code logic
  console.log('\n--- 3. DIGEST ELIGIBILITY ANALYSIS ---');

  // Combine all Step 4-7 projects
  const allStep47 = [
    ...dmirsProjects.map(p => ({ ...p, source: 'DMIRS' })),
    ...aemoProjects.map(p => ({ ...p, source: 'AEMO' })),
    ...projectoryNewProjects.map(p => ({ ...p, source: 'Projectory (new)' })),
  ];

  let eligible = 0;
  let dropped = 0;
  const dropReasons: Record<string, { count: number; projects: string[] }> = {};

  function addDrop(reason: string, name: string) {
    if (!dropReasons[reason]) dropReasons[reason] = { count: 0, projects: [] };
    dropReasons[reason].count++;
    dropReasons[reason].projects.push(name);
    dropped++;
  }

  for (const p of allStep47) {
    // Check suppressed
    if (p.suppressed) {
      addDrop('suppressed', `[${p.id}] ${p.name} (${p.source}) reason=${p.suppressionReason}`);
      continue;
    }
    // Check lifecycle
    if (p.lifecycleStatus === 'archived' || p.lifecycleStatus === 'merged') {
      addDrop('archived/merged', `[${p.id}] ${p.name} (${p.source})`);
      continue;
    }
    // Check stale
    if (p.staleReason && p.staleReason !== '') {
      addDrop('stale', `[${p.id}] ${p.name} (${p.source}) reason=${p.staleReason}`);
      continue;
    }
    // Check action tier
    if (!p.actionTier || p.actionTier === 'unscored') {
      addDrop('no_tier/unscored', `[${p.id}] ${p.name} (${p.source}) tier=${p.actionTier}`);
      continue;
    }
    // Check BL scoring
    if (!p.matchedBusinessLines || (Array.isArray(p.matchedBusinessLines) && p.matchedBusinessLines.length === 0)) {
      addDrop('no_bl_match', `[${p.id}] ${p.name} (${p.source})`);
      continue;
    }
    // Check priority
    if (!p.priority || p.priority === 'cold') {
      addDrop('cold_priority', `[${p.id}] ${p.name} (${p.source}) priority=${p.priority}`);
      continue;
    }
    eligible++;
    console.log(`  ✓ ELIGIBLE: [${p.id}] ${p.name} (${p.source}) | priority=${p.priority} tier=${p.actionTier} lifecycle=${p.lifecycleStatus}`);
  }

  console.log(`\n--- 4. SUMMARY ---`);
  console.log(`Total projects from Step 4-7 this week (new): ${allStep47.length}`);
  console.log(`  DMIRS: ${dmirsProjects.length}`);
  console.log(`  AEMO: ${aemoProjects.length}`);
  console.log(`  Projectory (new): ${projectoryNewProjects.length}`);
  console.log(`  Projectory (enriched existing): ${projectoryEnrichedThisWeek.length}`);
  console.log(`Total still present in DB: ${allStep47.length} (none deleted)`);
  console.log(`Total eligible for digest: ${eligible}`);
  console.log(`Total dropped: ${dropped}`);

  console.log(`\n--- 5. DROPPED PROJECTS BY REASON ---`);
  for (const [reason, data] of Object.entries(dropReasons)) {
    console.log(`\n  ${reason}: ${data.count}`);
    for (const proj of data.projects) {
      console.log(`    - ${proj}`);
    }
  }

  // 6. Check what the digest actually queries
  console.log('\n--- 6. CROSS-CHECK: Are Step 4-7 projects in the actual digest shortlist query? ---');
  // The digest typically queries: non-archived, non-suppressed, actionTier in (1,2), priority in (hot,warm)
  // Let's check if any Step 4-7 project IDs appear in a simulated digest query
  const step47Ids = allStep47.map(p => p.id);
  if (step47Ids.length > 0) {
    const digestCandidates = await db.select({
      id: projects.id,
      name: projects.name,
      priority: projects.priority,
      actionTier: projects.actionTier,
    }).from(projects)
      .where(and(
        sql`${projects.id} IN (${sql.join(step47Ids.map(id => sql`${id}`), sql`, `)})`,
        or(
          isNull(projects.suppressed),
          eq(projects.suppressed, false)
        ),
        ne(projects.lifecycleStatus, 'archived'),
        isNotNull(projects.actionTier),
      ));
    console.log(`  Step 4-7 projects passing basic digest filter (non-suppressed, non-archived, has tier): ${digestCandidates.length}`);
    for (const p of digestCandidates) {
      console.log(`    [${p.id}] ${p.name} | priority=${p.priority} tier=${p.actionTier}`);
    }
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
