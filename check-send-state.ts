import 'dotenv/config';
import { getDb } from './server/db';
import { digestSendControl, userEmailSendLog, digestScheduleLog } from './drizzle/schema';
import { eq, desc } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) { console.error('No DB'); process.exit(1); }

  // Check WA send control state
  const control = await db.select().from(digestSendControl).where(eq(digestSendControl.territory, 'WA')).limit(1);
  console.log('\n=== WA digestSendControl ===');
  console.log(JSON.stringify(control[0], null, 2));

  // Check recent email send logs
  const logs = await db.select().from(userEmailSendLog).orderBy(desc(userEmailSendLog.sentAt)).limit(15);
  console.log('\n=== Recent userEmailSendLog (last 15) ===');
  for (const l of logs) {
    console.log(`  ${(l as any).createdAt?.toISOString()} | user=${(l as any).userId} | status=${(l as any).status} | subject=${(l as any).subject?.slice(0,60)}`);
  }

  const scheduleLogs = await db.select().from(digestScheduleLog).orderBy(desc(digestScheduleLog.createdAt)).limit(10);
  console.log('\n=== Recent digestScheduleLog (last 10) ===');
  for (const l of scheduleLogs) {
    console.log(`  ${l.createdAt?.toISOString()} | territory=${l.territory} | status=${l.status} | dryRun=${l.dryRun} | recipientCount=${l.recipientCount}`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
