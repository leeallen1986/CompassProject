import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Check columns in userEmailSendLog
  const [cols] = await conn.execute('DESCRIBE userEmailSendLog');
  console.log('userEmailSendLog columns:', cols.map(c => c.Field).join(', '));

  // Get all W17 monday sends for user 840008
  const [rows] = await conn.execute(`
    SELECT id, userId, digestType, sentDate, weekKey, status, dryRun, sentAt
    FROM userEmailSendLog
    WHERE userId = 840008 AND weekKey = '2026W17' AND digestType = 'monday'
    ORDER BY id
  `);
  console.log('\nUser 840008 W17 monday sends:', rows.length);
  rows.forEach(r => console.log(JSON.stringify(r)));

  // Check unique constraints
  const [ddl] = await conn.execute('SHOW CREATE TABLE userEmailSendLog');
  const createTable = ddl[0]['Create Table'];
  // Extract just the constraint lines
  const constraintLines = createTable.split('\n').filter(l => l.includes('UNIQUE') || l.includes('PRIMARY'));
  console.log('\nuserEmailSendLog constraints:');
  constraintLines.forEach(l => console.log(l));

  // Understand the duplicate pattern — what sentDates do the 3 sends have?
  const [allDups] = await conn.execute(`
    SELECT userId, u.name, digestType, weekKey, sentDate, dryRun, status, COUNT(*) as cnt
    FROM userEmailSendLog l
    JOIN users u ON u.id = l.userId
    WHERE weekKey = '2026W17' AND dryRun = 0 AND status = 'sent'
    GROUP BY userId, digestType, weekKey, sentDate, dryRun, status
    ORDER BY cnt DESC, userId, digestType
  `);
  console.log('\nW17 real sends grouped by (userId, digestType, weekKey, sentDate):');
  allDups.forEach(r => console.log(`  userId=${r.userId} ${r.name} | ${r.digestType} | sentDate=${r.sentDate} | cnt=${r.cnt}`));

  await conn.end();
}
main().catch(console.error);
