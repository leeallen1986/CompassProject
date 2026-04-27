/**
 * Migration: Clean duplicate userEmailSendLog rows and add unique constraint
 *
 * Steps:
 * 1. Count rows before cleanup
 * 2. Identify duplicates (same userId + digestType + sentDate)
 * 3. Delete duplicates, keeping only the earliest id per group
 * 4. Add UNIQUE KEY uq_user_type_date (userId, digestType, sentDate)
 * 5. Verify constraint is present
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  console.log('=== userEmailSendLog Unique Constraint Migration ===\n');

  // Step 1: Row count before
  const [[{ totalBefore }]] = await conn.execute(
    'SELECT COUNT(*) AS totalBefore FROM userEmailSendLog'
  );
  console.log(`Rows before cleanup: ${totalBefore}`);

  // Step 2: Identify duplicates
  const [dupGroups] = await conn.execute(`
    SELECT userId, digestType, sentDate, COUNT(*) AS cnt, MIN(id) AS keepId
    FROM userEmailSendLog
    GROUP BY userId, digestType, sentDate
    HAVING cnt > 1
    ORDER BY cnt DESC
  `);
  console.log(`\nDuplicate groups found: ${dupGroups.length}`);
  if (dupGroups.length > 0) {
    dupGroups.forEach(g => {
      console.log(`  userId=${g.userId} | ${g.digestType} | ${g.sentDate} | count=${g.cnt} | keepId=${g.keepId}`);
    });
  }

  // Count total rows to delete
  let totalToDelete = 0;
  for (const g of dupGroups) {
    totalToDelete += (g.cnt - 1);
  }
  console.log(`\nRows to delete: ${totalToDelete}`);

  // Step 3: Delete duplicates — keep only the earliest id per group
  if (totalToDelete > 0) {
    const [deleteResult] = await conn.execute(`
      DELETE l FROM userEmailSendLog l
      INNER JOIN (
        SELECT userId, digestType, sentDate, MIN(id) AS keepId
        FROM userEmailSendLog
        GROUP BY userId, digestType, sentDate
        HAVING COUNT(*) > 1
      ) keep_map
        ON l.userId = keep_map.userId
        AND l.digestType = keep_map.digestType
        AND l.sentDate = keep_map.sentDate
        AND l.id != keep_map.keepId
    `);
    console.log(`\nDeleted ${deleteResult.affectedRows} duplicate rows`);
  } else {
    console.log('\nNo rows to delete');
  }

  // Step 4: Row count after cleanup
  const [[{ totalAfter }]] = await conn.execute(
    'SELECT COUNT(*) AS totalAfter FROM userEmailSendLog'
  );
  console.log(`Rows after cleanup: ${totalAfter}`);
  console.log(`Net removed: ${totalBefore - totalAfter}`);

  // Step 5: Check if constraint already exists
  const [existingKeys] = await conn.execute(`
    SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'userEmailSendLog'
      AND INDEX_NAME = 'uq_user_type_date'
  `);

  if (existingKeys.length > 0) {
    console.log('\nConstraint uq_user_type_date already exists — skipping ADD');
  } else {
    console.log('\nAdding UNIQUE KEY uq_user_type_date...');
    await conn.execute(`
      ALTER TABLE userEmailSendLog
      ADD UNIQUE KEY uq_user_type_date (userId, digestType, sentDate)
    `);
    console.log('Constraint added successfully');
  }

  // Step 6: Verify constraint is present
  const [verifyKeys] = await conn.execute(`
    SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'userEmailSendLog'
      AND INDEX_NAME = 'uq_user_type_date'
    ORDER BY SEQ_IN_INDEX
  `);

  console.log('\n=== Constraint Verification ===');
  if (verifyKeys.length > 0) {
    console.log(`INDEX_NAME: ${verifyKeys[0].INDEX_NAME}`);
    console.log(`NON_UNIQUE: ${verifyKeys[0].NON_UNIQUE} (0 = unique)`);
    console.log(`Columns: ${verifyKeys.map(k => k.COLUMN_NAME).join(', ')}`);
    console.log('\n✓ UNIQUE constraint is present and enforced');
  } else {
    console.log('✗ Constraint NOT found — migration failed');
    process.exit(1);
  }

  // Step 7: Prove the constraint blocks duplicates
  console.log('\n=== Duplicate-Block Proof ===');
  try {
    // Try inserting a duplicate of an existing row
    const [[existingRow]] = await conn.execute(
      'SELECT userId, digestType, sentDate FROM userEmailSendLog LIMIT 1'
    );
    if (existingRow) {
      await conn.execute(
        `INSERT INTO userEmailSendLog (userId, digestType, sentDate, status, dryRun)
         VALUES (?, ?, ?, 'sent', 0)`,
        [existingRow.userId, existingRow.digestType, existingRow.sentDate]
      );
      console.log('✗ Duplicate INSERT succeeded — constraint NOT working');
      process.exit(1);
    }
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      console.log('✓ Duplicate INSERT correctly rejected with ER_DUP_ENTRY');
      console.log('✓ Race condition is now blocked at DB level');
    } else {
      throw err;
    }
  }

  // Final summary
  console.log('\n=== Migration Summary ===');
  console.log(`Rows before:      ${totalBefore}`);
  console.log(`Duplicates removed: ${totalBefore - totalAfter}`);
  console.log(`Rows after:       ${totalAfter}`);
  console.log(`Duplicate groups: ${dupGroups.length}`);
  console.log(`Constraint:       uq_user_type_date (userId, digestType, sentDate) UNIQUE`);
  console.log(`Race condition:   BLOCKED at DB level`);

  await conn.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
