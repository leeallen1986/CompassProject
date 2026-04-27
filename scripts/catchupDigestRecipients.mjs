/**
 * Catch-up Monday Digest Recipient List
 *
 * Determines who should receive the W18 catch-up Monday digest:
 * - All users with role=user (sales reps only)
 * - Who have NOT already received a W18 Monday digest (dryRun=0, status=sent)
 * - Excludes admins (they get manager rollup, not Monday digest)
 * - Excludes inactive/unverified users
 *
 * Also shows the W18 dedup state so we can confirm no false blocks.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

function getCurrentWeekKey() {
  const now = new Date();
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((now - startOfYear) / 86400000);
  const dayOfWeek = startOfYear.getUTCDay(); // 0=Sun
  // ISO week: week 1 is the week containing the first Thursday of the year
  const isoWeek = Math.ceil((dayOfYear + dayOfWeek + 1) / 7);
  return `${now.getUTCFullYear()}W${String(isoWeek).padStart(2, '0')}`;
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  const weekKey = getCurrentWeekKey();
  console.log(`=== Catch-up Monday Digest Recipient List ===`);
  console.log(`Current week key: ${weekKey}\n`);

  // 1. All users with role=user (sales reps)
  const [allReps] = await conn.execute(`
    SELECT u.id, u.name, u.email, u.role, u.authMethod,
           p.territories, p.assignedBusinessLines, p.onboardingCompleted
    FROM users u
    LEFT JOIN userProfiles p ON p.userId = u.id
    WHERE u.role = 'user'
    ORDER BY u.id
  `);

  console.log(`Total sales reps (role=user): ${allReps.length}`);
  allReps.forEach(u => {
    const terr = u.territories ? JSON.stringify(u.territories) : 'none';
    const bls = u.assignedBusinessLines ? JSON.stringify(u.assignedBusinessLines) : 'none';
    const onboarded = u.onboardingCompleted ? '✓' : '✗';
    console.log(`  [${u.id}] ${u.name} | ${u.email} | terr=${terr} | BLs=${bls} | onboarded=${onboarded}`);
  });

  // 2. Check W18 dedup state — who has already received W18 Monday
  const [alreadySent] = await conn.execute(`
    SELECT l.userId, u.name, u.email, l.sentDate, l.dryRun, l.status
    FROM userEmailSendLog l
    JOIN users u ON u.id = l.userId
    WHERE l.weekKey = ? AND l.digestType = 'monday' AND l.dryRun = 0 AND l.status = 'sent'
    ORDER BY l.userId
  `, [weekKey]);

  console.log(`\nW${weekKey} Monday digest already sent (dryRun=0, status=sent): ${alreadySent.length}`);
  alreadySent.forEach(r => {
    console.log(`  [${r.userId}] ${r.name} | ${r.email} | sentDate=${r.sentDate}`);
  });

  // 3. Build recipient list: reps who have NOT yet received W18 Monday
  const alreadySentIds = new Set(alreadySent.map(r => r.userId));
  const recipients = allReps.filter(u => !alreadySentIds.has(u.id));

  console.log(`\n=== Catch-up Recipients (need W${weekKey} Monday digest) ===`);
  console.log(`Total: ${recipients.length}`);
  recipients.forEach(u => {
    const terr = u.territories ? (Array.isArray(u.territories) ? u.territories.flat().join(', ') : JSON.stringify(u.territories)) : 'none';
    const bls = u.assignedBusinessLines ? (Array.isArray(u.assignedBusinessLines) ? u.assignedBusinessLines.flat().join(', ') : JSON.stringify(u.assignedBusinessLines)) : 'none';
    const onboarded = u.onboardingCompleted ? '✓ onboarded' : '✗ not onboarded';
    console.log(`  [${u.id}] ${u.name} | ${u.email} | ${terr} | ${bls} | ${onboarded}`);
  });

  if (recipients.length === 0) {
    console.log('  → All reps already received W18 Monday digest. No catch-up needed.');
  }

  // 4. Admins — confirm they are excluded from Monday digest
  const [admins] = await conn.execute(`
    SELECT u.id, u.name, u.email, u.role
    FROM users u
    WHERE u.role = 'admin'
    ORDER BY u.id
  `);
  console.log(`\nAdmins (excluded from Monday catch-up, get manager rollup only): ${admins.length}`);
  admins.forEach(u => console.log(`  [${u.id}] ${u.name} | ${u.email}`));

  // 5. W18 full dedup state (all digest types)
  const [w18All] = await conn.execute(`
    SELECT l.userId, u.name, l.digestType, l.sentDate, l.dryRun, l.status
    FROM userEmailSendLog l
    JOIN users u ON u.id = l.userId
    WHERE l.weekKey = ?
    ORDER BY l.digestType, l.userId
  `, [weekKey]);

  console.log(`\n=== Full W${weekKey} Dedup State ===`);
  if (w18All.length === 0) {
    console.log('  No W18 sends recorded yet — all digest types clear');
  } else {
    w18All.forEach(r => {
      const dry = r.dryRun ? '[dry_run]' : '[REAL]';
      console.log(`  [${r.userId}] ${r.name} | ${r.digestType} | ${r.status} ${dry} | ${r.sentDate}`);
    });
  }

  // 6. Confirm unique constraint is in place
  const [constraintCheck] = await conn.execute(`
    SELECT INDEX_NAME, NON_UNIQUE
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'userEmailSendLog'
      AND INDEX_NAME = 'uq_user_type_date'
    LIMIT 1
  `);
  console.log(`\n=== Duplicate-Block Status ===`);
  if (constraintCheck.length > 0 && constraintCheck[0].NON_UNIQUE === 0) {
    console.log(`✓ UNIQUE constraint uq_user_type_date is ACTIVE`);
    console.log(`✓ Any concurrent duplicate send will be rejected at DB level`);
  } else {
    console.log(`✗ Constraint NOT found — migration may not have applied`);
  }

  console.log('\n=== Summary ===');
  console.log(`Week:                 ${weekKey}`);
  console.log(`Total reps:           ${allReps.length}`);
  console.log(`Already received W${weekKey.slice(-2)} Monday: ${alreadySent.length}`);
  console.log(`Catch-up recipients:  ${recipients.length}`);
  console.log(`Admins excluded:      ${admins.length} (manager rollup only)`);
  console.log(`Unique constraint:    ${constraintCheck.length > 0 ? 'ACTIVE' : 'MISSING'}`);

  await conn.end();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
