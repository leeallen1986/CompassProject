/**
 * Manual stale project cleanup script
 * Runs the same markStaleProjects() logic as the daily pipeline step 23
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get counts before
const [[before]] = await conn.execute(`
  SELECT 
    SUM(CASE WHEN lifecycleStatus = 'active' THEN 1 ELSE 0 END) as active,
    SUM(CASE WHEN lifecycleStatus = 'stale' THEN 1 ELSE 0 END) as stale,
    SUM(CASE WHEN lifecycleStatus = 'archived' THEN 1 ELSE 0 END) as archived
  FROM projects
`);
console.log('BEFORE:', before);

const now = Date.now();
const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000);
const oneEightyDaysAgo = new Date(now - 180 * 24 * 60 * 60 * 1000);

console.log(`\nThresholds:`);
console.log(`  Stale: last seen before ${sixtyDaysAgo.toISOString()}`);
console.log(`  Archive: last seen before ${oneEightyDaysAgo.toISOString()}`);

// Get projects with active pipeline claims (never touch these)
const [claimedRows] = await conn.execute(`
  SELECT DISTINCT projectId FROM pipelineClaims WHERE status != 'lost'
`);
const claimedSet = new Set(claimedRows.map(r => r.projectId));
console.log(`\nProjects with active pipeline claims (protected): ${claimedSet.size}`);

// Find candidates to archive (180+ days, not claimed, not keepFlag)
const [archiveCandidates] = await conn.execute(`
  SELECT id, lifecycleStatus, 
    COALESCE(sourceLastSeenAt, lastActivityAt, createdAt) as freshness
  FROM projects
  WHERE lifecycleStatus IN ('active', 'stale')
    AND keepFlag = 0
    AND COALESCE(sourceLastSeenAt, lastActivityAt, createdAt) < ?
`, [oneEightyDaysAgo]);

const toArchive = archiveCandidates.filter(p => !claimedSet.has(p.id));
console.log(`\nTo archive (180+ days stale): ${toArchive.length}`);

// Find candidates to stale (60-180 days, currently active)
const [staleCandidates] = await conn.execute(`
  SELECT id, lifecycleStatus,
    COALESCE(sourceLastSeenAt, lastActivityAt, createdAt) as freshness
  FROM projects
  WHERE lifecycleStatus = 'active'
    AND keepFlag = 0
    AND COALESCE(sourceLastSeenAt, lastActivityAt, createdAt) < ?
    AND COALESCE(sourceLastSeenAt, lastActivityAt, createdAt) >= ?
`, [sixtyDaysAgo, oneEightyDaysAgo]);

const toStale = staleCandidates.filter(p => !claimedSet.has(p.id));
console.log(`To stale (60-180 days, currently active): ${toStale.length}`);

// Apply archive
if (toArchive.length > 0) {
  const ids = toArchive.map(p => p.id);
  // Process in batches of 500
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const placeholders = batch.map(() => '?').join(',');
    await conn.execute(`
      UPDATE projects SET
        lifecycleStatus = 'archived',
        archivedAt = NOW(),
        staleReason = 'No source corroboration for 180+ days (manual cleanup 2026-06-18)'
      WHERE id IN (${placeholders})
    `, batch);
  }
  console.log(`\n✓ Archived ${toArchive.length} projects`);
}

// Apply stale
if (toStale.length > 0) {
  const ids = toStale.map(p => p.id);
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const placeholders = batch.map(() => '?').join(',');
    await conn.execute(`
      UPDATE projects SET
        lifecycleStatus = 'stale',
        staleReason = 'No source corroboration for 60+ days (manual cleanup 2026-06-18)'
      WHERE id IN (${placeholders})
    `, batch);
  }
  console.log(`✓ Marked ${toStale.length} projects as stale`);
}

// Get counts after
const [[after]] = await conn.execute(`
  SELECT 
    SUM(CASE WHEN lifecycleStatus = 'active' THEN 1 ELSE 0 END) as active,
    SUM(CASE WHEN lifecycleStatus = 'stale' THEN 1 ELSE 0 END) as stale,
    SUM(CASE WHEN lifecycleStatus = 'archived' THEN 1 ELSE 0 END) as archived
  FROM projects
`);
console.log('\nAFTER:', after);
console.log(`\nNet change: active ${before.active} → ${after.active} | stale ${before.stale} → ${after.stale} | archived ${before.archived} → ${after.archived}`);

await conn.end();
