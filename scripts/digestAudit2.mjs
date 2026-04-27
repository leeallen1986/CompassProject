import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

function safeParse(val) {
  if (!val) return [];
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return [val]; }
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // ── Recipient scope ──
  console.log('=== RECIPIENT SCOPE ===');
  const [recipients] = await conn.execute(`
    SELECT u.id, u.name, u.email, u.role,
           p.territories, p.assignedBusinessLines
    FROM users u
    JOIN userProfiles p ON p.userId = u.id
    WHERE u.email IS NOT NULL
    ORDER BY u.id
  `);
  console.log('Total users with profiles + email:', recipients.length);
  recipients.forEach(r => {
    const terr = safeParse(r.territories);
    const bls = safeParse(r.assignedBusinessLines);
    console.log(`  [${r.id}] ${r.name} | role=${r.role} | ${r.email} | terr=${JSON.stringify(terr)} | BLs=${JSON.stringify(bls)}`);
  });

  // ── digestScheduleLog ──
  console.log('\n=== digestScheduleLog (last 5) ===');
  const [dsl] = await conn.execute('SELECT * FROM digestScheduleLog ORDER BY id DESC LIMIT 5');
  if (dsl.length === 0) console.log('  (empty)');
  dsl.forEach(r => console.log(' ', JSON.stringify(r)));

  // ── Current time ──
  const now = new Date();
  console.log('\n=== TIME ===');
  console.log('  Current UTC:', now.toISOString());
  console.log('  Current AEST (UTC+8):', new Date(now.getTime() + 8*3600000).toISOString().replace('T',' ').substring(0,19));

  // Next Monday 08:00 AEST = Monday 00:00 UTC
  const aestNow = new Date(now.getTime() + 8*3600000);
  const dayOfWeek = aestNow.getUTCDay(); // 0=Sun, 1=Mon
  const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7 || 7;
  const nextMonday = new Date(aestNow);
  nextMonday.setUTCDate(aestNow.getUTCDate() + daysUntilMonday);
  nextMonday.setUTCHours(8, 0, 0, 0); // 08:00 AEST
  const nextMondayUTC = new Date(nextMonday.getTime() - 8*3600000);
  console.log(`  Next Monday 08:00 AEST = ${nextMonday.toISOString().replace('T',' ').substring(0,16)} AEST = ${nextMondayUTC.toISOString()} UTC`);
  const hoursUntil = (nextMondayUTC.getTime() - now.getTime()) / 3600000;
  console.log(`  Hours until next Monday digest: ${hoursUntil.toFixed(1)}h`);

  // ── Scheduler log lines ──
  console.log('\n=== SCHEDULER LOG (from devserver.log) ===');
  try {
    const log = readFileSync('/home/ubuntu/atlas-copco-intelligence/.manus-logs/devserver.log', 'utf8');
    const lines = log.split('\n').filter(l =>
      l.includes('PersistentScheduler') || l.includes('Next Monday') || l.includes('Next Thursday') ||
      l.includes('digest scheduled') || l.includes('digest sent') || l.includes('digest skipped')
    );
    lines.slice(-25).forEach(l => console.log(' ', l));
  } catch(e) { console.log('  Could not read devserver.log:', e.message); }

  // ── EMAIL_DIGESTS_ENABLED ──
  console.log('\n=== ENV FLAGS ===');
  console.log('  EMAIL_DIGESTS_ENABLED:', process.env.EMAIL_DIGESTS_ENABLED);
  console.log('  PILOT_MODE:', process.env.PILOT_MODE || '(not set)');

  // ── New users in W18 (this coming week) — check dedup won't block them ──
  console.log('\n=== W18 DEDUP CHECK (next week) ===');
  const [w18] = await conn.execute(
    `SELECT userId, digestType, status, weekKey, sentAt, dryRun
     FROM userEmailSendLog WHERE weekKey = '2026W18' ORDER BY sentAt DESC`
  );
  console.log('  W18 entries:', w18.length, '(should be 0 — no sends yet for next week)');
  w18.forEach(r => console.log('  ', JSON.stringify(r)));

  await conn.end();
}
main().catch(console.error);
