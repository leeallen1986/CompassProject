import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // ── 1. Scheduler state ──
  console.log('=== 1. SCHEDULER STATE ===');
  const [tables] = await conn.execute('SHOW TABLES');
  const tableNames = tables.map(t => Object.values(t)[0]);
  const schedTables = tableNames.filter(t => t.toLowerCase().includes('sched') || t.toLowerCase().includes('cron') || t.toLowerCase().includes('job'));
  console.log('  Scheduler-related tables found:', schedTables.length > 0 ? schedTables : 'none');
  console.log('  NOTE: Scheduler runs in-process. Check server logs for next run time.');

  // ── 2. Last 5 pipeline runs ──
  console.log('\n=== 2. LAST PIPELINE RUNS ===');
  const [runs] = await conn.execute(
    `SELECT id, runType, status, triggeredBy, startedAt, completedAt, durationMs,
            projectsCreated, projectsDuplicate, errors
     FROM pipelineRuns ORDER BY id DESC LIMIT 5`
  );
  if (runs.length === 0) {
    console.log('  No pipeline runs found');
  } else {
    runs.forEach(r => console.log(' ', JSON.stringify(r)));
  }

  // ── 3. Latest reports ──
  console.log('\n=== 3. LATEST REPORTS ===');
  const [reports] = await conn.execute(
    `SELECT id, weekEnding, generatedTime, totalProjects, hotProjects, warmProjects, createdAt
     FROM reports ORDER BY id DESC LIMIT 5`
  );
  reports.forEach(r => console.log(' ', JSON.stringify(r)));

  // ── 4. Active project count ──
  console.log('\n=== 4. ACTIVE PROJECT COUNT ===');
  const [proj] = await conn.execute(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN priority='hot' THEN 1 ELSE 0 END) as hot,
            SUM(CASE WHEN priority='warm' THEN 1 ELSE 0 END) as warm,
            SUM(CASE WHEN priority='cold' THEN 1 ELSE 0 END) as cold,
            SUM(CASE WHEN suppressed=1 THEN 1 ELSE 0 END) as suppressed,
            SUM(CASE WHEN (lifecycleStatus='active' OR lifecycleStatus IS NULL) AND (suppressed=0 OR suppressed IS NULL) THEN 1 ELSE 0 END) as eligible_for_digest
     FROM projects`
  );
  console.log(' ', JSON.stringify(proj[0]));

  // ── 5. Dedup: email send log ──
  console.log('\n=== 5. EMAIL SEND LOG ===');
  // ISO week key
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const weekKey = d.getUTCFullYear() + 'W' + String(weekNum).padStart(2, '0');
  console.log('  Current ISO weekKey:', weekKey);

  const [allLog] = await conn.execute(
    `SELECT userId, digestType, status, weekKey, sentAt, dryRun
     FROM userEmailSendLog ORDER BY sentAt DESC LIMIT 30`
  );
  console.log('  Total log entries (all time, last 30):', allLog.length);
  allLog.forEach(r => console.log(' ', JSON.stringify(r)));

  const [thisWeekLog] = await conn.execute(
    `SELECT userId, digestType, status, weekKey, sentAt, dryRun
     FROM userEmailSendLog WHERE weekKey = ? ORDER BY sentAt DESC`,
    [weekKey]
  );
  console.log(`  Entries for current weekKey (${weekKey}):`, thisWeekLog.length);
  if (thisWeekLog.length > 0) {
    thisWeekLog.forEach(r => console.log('  DEDUP BLOCK:', JSON.stringify(r)));
  } else {
    console.log('  CLEAR — no sends recorded for this week, digest will not be blocked by dedup');
  }

  // ── 6. Recipient scope ──
  console.log('\n=== 6. RECIPIENT SCOPE ===');
  const [recipients] = await conn.execute(
    `SELECT u.id, u.name, u.email, u.role,
            p.territories, p.assignedBusinessLines,
            p.emailDigestEnabled
     FROM users u
     JOIN userProfiles p ON p.userId = u.id
     WHERE u.email IS NOT NULL
     ORDER BY u.id`
  );
  console.log('  Total users with profiles + email:', recipients.length);
  recipients.forEach(r => {
    const terr = r.territories ? JSON.parse(r.territories) : [];
    const bls = r.assignedBusinessLines ? JSON.parse(r.assignedBusinessLines) : [];
    console.log(`  [${r.id}] ${r.name} | role=${r.role} | ${r.email} | terr=${JSON.stringify(terr)} | BLs=${JSON.stringify(bls)} | digestEnabled=${r.emailDigestEnabled}`);
  });

  // ── 7. ENV ──
  console.log('\n=== 7. ENV FLAGS ===');
  console.log('  EMAIL_DIGESTS_ENABLED:', process.env.EMAIL_DIGESTS_ENABLED);
  console.log('  PILOT_MODE:', process.env.PILOT_MODE || '(not set)');
  console.log('  PILOT_ALLOW_LIST:', process.env.PILOT_ALLOW_LIST || '(not set)');

  await conn.end();
}
main().catch(console.error);
