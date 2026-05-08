import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  
  // Check emailDigestPreferences table
  const [prefs] = await db.execute(sql.raw('SELECT * FROM emailDigestPreferences')) as any;
  console.log('=== EMAIL DIGEST PREFERENCES (all rows) ===');
  console.log(JSON.stringify(prefs, null, 2));
  
  // Check columns
  const [cols] = await db.execute(sql.raw('DESCRIBE emailDigestPreferences')) as any;
  console.log('\n=== COLUMNS ===');
  console.log(cols.map((r: any) => `${r.Field} (${r.Type}) default=${r.Default}`).join('\n'));

  // Check the actual profiles table name
  const [allTables] = await db.execute(sql`SHOW TABLES`) as any;
  const tableNames = allTables.map((r: any) => Object.values(r)[0] as string);
  const profileTables = tableNames.filter((t: string) => t.includes('rofile') || t.includes('rep'));
  console.log('\n=== PROFILE-RELATED TABLES ===');
  console.log(profileTables);

  // Check each profile table
  for (const t of profileTables) {
    const [c] = await db.execute(sql.raw(`DESCRIBE \`${t}\``)) as any;
    console.log(`\n${t}: ${c.map((r: any) => r.Field).join(', ')}`);
    const [cnt] = await db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM \`${t}\``)) as any;
    console.log(`  rows: ${cnt[0].cnt}`);
  }

  // Check recent send log entries
  const [recent] = await db.execute(sql.raw('SELECT * FROM userEmailSendLog ORDER BY sentAt DESC LIMIT 10')) as any;
  console.log('\n=== RECENT EMAIL SEND LOG (last 10) ===');
  for (const r of recent) {
    console.log(`${r.userId} | ${r.digestType} | ${r.sentDate} | ${r.status} | items=${r.itemCount} | dryRun=${r.dryRun}`);
  }

  process.exit(0);
}
main();
