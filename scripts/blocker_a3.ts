import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  
  // Get all digest prefs
  const [prefs] = await db.execute(sql.raw('SELECT * FROM emailDigestPrefs')) as any;
  console.log('=== EMAIL DIGEST PREFS ===');
  for (const p of prefs) {
    console.log(`userId=${p.userId} | enabled=${p.enabled} | freq=${p.frequency} | hotOnly=${p.includeHotOnly} | contacts=${p.includeContacts} | pipeline=${p.includePipelineUpdates} | lastSent=${p.lastSentAt}`);
  }
  console.log(`Total configured: ${prefs.length}`);

  // Get all users
  const [users] = await db.execute(sql.raw('SELECT id, name, email, role FROM users')) as any;
  console.log('\n=== ALL USERS ===');
  for (const u of users) {
    const hasPref = prefs.find((p: any) => p.userId === u.id);
    console.log(`${u.id}: ${u.name} (${u.email}) role=${u.role} | digestPref=${hasPref ? 'CONFIGURED' : 'MISSING'}`);
  }

  // Get recent send log
  const [sendLog] = await db.execute(sql.raw('SELECT * FROM userEmailSendLog ORDER BY sentAt DESC LIMIT 20')) as any;
  console.log('\n=== RECENT SEND LOG (last 20) ===');
  for (const r of sendLog) {
    const user = users.find((u: any) => u.id === r.userId);
    console.log(`${r.sentDate} | ${user?.name || r.userId} | ${r.digestType} | ${r.status} | items=${r.itemCount} | dryRun=${r.dryRun} | err=${r.error || 'none'}`);
  }

  // Check digestSendControl
  const [control] = await db.execute(sql.raw('SELECT * FROM digestSendControl')) as any;
  console.log('\n=== DIGEST SEND CONTROL ===');
  console.log(JSON.stringify(control, null, 2));

  // Check digestScheduleLog
  const [schedLog] = await db.execute(sql.raw('SELECT * FROM digestScheduleLog ORDER BY id DESC LIMIT 5')) as any;
  console.log('\n=== DIGEST SCHEDULE LOG (last 5) ===');
  console.log(JSON.stringify(schedLog, null, 2));

  // Check the profiles table - find the right name
  const [allTables] = await db.execute(sql`SHOW TABLES`) as any;
  const tableNames = allTables.map((r: any) => Object.values(r)[0] as string);
  const profileTables = tableNames.filter((t: string) => t.toLowerCase().includes('profile'));
  console.log('\n=== PROFILE TABLES ===');
  console.log(profileTables);

  // Check salesRepProfiles or userOnboarding
  const onboardingTables = tableNames.filter((t: string) => t.toLowerCase().includes('onboard') || t.toLowerCase().includes('sales'));
  console.log('\n=== ONBOARDING/SALES TABLES ===');
  console.log(onboardingTables);

  process.exit(0);
}
main();
