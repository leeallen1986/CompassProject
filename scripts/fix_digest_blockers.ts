import { getDb } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();

  // 1. Approve all existing territories in digestSendControl
  console.log('=== APPROVING ALL TERRITORIES ===');
  const [existing] = await db.execute(sql.raw('SELECT * FROM digestSendControl')) as any;
  console.log(`Found ${existing.length} territory controls`);
  
  for (const ctrl of existing) {
    if (!ctrl.firstSendApproved || !ctrl.autoSendEnabled) {
      await db.execute(sql.raw(`UPDATE digestSendControl SET firstSendApproved = 1, autoSendEnabled = 1, firstSendApprovedAt = NOW(), firstSendApprovedBy = 'admin-bulk-approve-2026-05-09' WHERE id = ${ctrl.id}`));
      console.log(`  ✓ Approved territory: ${ctrl.territory}`);
    } else {
      console.log(`  ⏭ Already approved: ${ctrl.territory}`);
    }
  }

  // Add missing territories (QLD, VIC, TAS, NT, ACT, OFFSHORE_AU, National)
  const allTerritories = ['WA', 'NSW', 'SA', 'QLD', 'VIC', 'TAS', 'NT', 'ACT', 'OFFSHORE_AU', 'National'];
  const existingTerritories = existing.map((c: any) => c.territory);
  for (const t of allTerritories) {
    if (!existingTerritories.includes(t)) {
      await db.execute(sql.raw(`INSERT INTO digestSendControl (territory, firstSendApproved, autoSendEnabled, firstSendApprovedAt, firstSendApprovedBy) VALUES ('${t}', 1, 1, NOW(), 'admin-bulk-approve-2026-05-09')`));
      console.log(`  ✓ Created + approved territory: ${t}`);
    }
  }

  // 2. Seed digest prefs for all users who don't have them
  console.log('\n=== SEEDING DIGEST PREFS ===');
  const [users] = await db.execute(sql.raw('SELECT id, name FROM users')) as any;
  const [existingPrefs] = await db.execute(sql.raw('SELECT userId FROM emailDigestPrefs')) as any;
  const usersWithPrefs = new Set(existingPrefs.map((p: any) => p.userId));

  for (const user of users) {
    if (!usersWithPrefs.has(user.id)) {
      await db.execute(sql.raw(`INSERT INTO emailDigestPrefs (userId, enabled, frequency, includeHotOnly, includeContacts, includePipelineUpdates) VALUES (${user.id}, 1, 'weekly', 0, 1, 1)`));
      console.log(`  ✓ Seeded prefs for: ${user.name} (id=${user.id})`);
    } else {
      console.log(`  ⏭ Already has prefs: ${user.name} (id=${user.id})`);
    }
  }

  // 3. Verify final state
  console.log('\n=== FINAL STATE ===');
  const [finalCtrl] = await db.execute(sql.raw('SELECT territory, firstSendApproved, autoSendEnabled FROM digestSendControl')) as any;
  console.log('Territory controls:');
  for (const c of finalCtrl) {
    console.log(`  ${c.territory}: approved=${c.firstSendApproved}, autoSend=${c.autoSendEnabled}`);
  }

  const [finalPrefs] = await db.execute(sql.raw('SELECT p.userId, u.name, p.enabled, p.frequency FROM emailDigestPrefs p LEFT JOIN users u ON p.userId = u.id')) as any;
  console.log('\nDigest prefs:');
  for (const p of finalPrefs) {
    console.log(`  ${p.name || p.userId}: enabled=${p.enabled}, freq=${p.frequency}`);
  }

  process.exit(0);
}
main();
