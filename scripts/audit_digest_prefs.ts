import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  
  // Get all active reps with their profiles and digest preferences
  const [rows] = await db.execute(sql`
    SELECT u.id, u.name, u.email, u.role, 
           up.territories, up.assignedBusinessLines, up.onboardingCompleted,
           edp.id as digestPrefId, edp.enabled, edp.frequency
    FROM users u
    LEFT JOIN userProfiles up ON u.id = up.userId
    LEFT JOIN emailDigestPrefs edp ON u.id = edp.userId
    WHERE u.role IN ('user', 'admin')
    ORDER BY u.name
  `);
  
  console.log("=== ALL ACTIVE USERS ===");
  let configured = 0;
  let unconfigured = 0;
  const unconfiguredUsers: any[] = [];
  
  for (const row of rows as any[]) {
    const hasDigestPref = row.digestPrefId !== null;
    const status = hasDigestPref ? `✅ configured (enabled=${row.enabled}, freq=${row.frequency})` : "❌ NO DIGEST PREFS";
    console.log(`  [${row.id}] ${row.name} (${row.email || 'no email'}) | role=${row.role} | onboarded=${row.onboardingCompleted} | digest: ${status}`);
    console.log(`       territories: ${row.territories || 'none'} | BL: ${row.assignedBusinessLines || 'none'}`);
    
    if (hasDigestPref) {
      configured++;
    } else {
      unconfigured++;
      unconfiguredUsers.push(row);
    }
  }
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`  Total active users: ${(rows as any[]).length}`);
  console.log(`  Fully configured digest prefs: ${configured}`);
  console.log(`  Unconfigured (need seeding): ${unconfigured}`);
  
  if (unconfiguredUsers.length > 0) {
    console.log(`\n=== USERS NEEDING DIGEST PREFS ===`);
    for (const u of unconfiguredUsers) {
      console.log(`  [${u.id}] ${u.name} — ${u.email || 'no email'} — onboarded: ${u.onboardingCompleted}`);
    }
  }
  
  // Also check the send log for recent activity
  const [sendLogs] = await db.execute(sql`
    SELECT usl.userId, u.name, usl.digestType, usl.sentDate, usl.weekKey, usl.status, usl.dryRun, usl.itemCount, usl.error
    FROM userEmailSendLog usl
    JOIN users u ON usl.userId = u.id
    ORDER BY usl.sentDate DESC, usl.userId
    LIMIT 30
  `);
  
  console.log(`\n=== RECENT SEND LOG (last 30 entries) ===`);
  for (const log of sendLogs as any[]) {
    console.log(`  ${log.sentDate} | ${log.name} | type=${log.digestType} | status=${log.status} | items=${log.itemCount} | dryRun=${log.dryRun} | error=${log.error || 'none'}`);
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
