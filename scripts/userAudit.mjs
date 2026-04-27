import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // ── User 840008 full record ──
  console.log('=== USER 840008 FULL RECORD ===');
  const [user] = await conn.execute(
    `SELECT id, name, email, role, authMethod, openId, createdAt, updatedAt
     FROM users WHERE id = 840008`
  );
  console.log('users row:', JSON.stringify(user[0] ?? 'NOT FOUND'));

  const [profile] = await conn.execute(
    `SELECT * FROM userProfiles WHERE userId = 840008`
  );
  console.log('userProfiles row:', JSON.stringify(profile[0] ?? 'NOT FOUND'));

  // ── All users with their full identity ──
  console.log('\n=== ALL USERS (full identity) ===');
  const [allUsers] = await conn.execute(
    `SELECT u.id, u.name, u.email, u.role, u.authMethod, u.openId,
            p.territories, p.assignedBusinessLines
     FROM users u
     LEFT JOIN userProfiles p ON p.userId = u.id
     ORDER BY u.id`
  );
  allUsers.forEach(u => {
    const terr = u.territories ? (() => { try { return JSON.parse(u.territories); } catch { return [u.territories]; } })() : [];
    const bls = u.assignedBusinessLines ? (() => { try { return JSON.parse(u.assignedBusinessLines); } catch { return [u.assignedBusinessLines]; } })() : [];
    console.log(`[${u.id}] ${u.name || '(no name)'} | ${u.email || '(no email)'} | role=${u.role} | auth=${u.authMethod} | openId=${u.openId || '-'} | terr=${JSON.stringify(terr)} | BLs=${JSON.stringify(bls)}`);
  });

  // ── W17 send log — full reconciliation ──
  console.log('\n=== W17 SEND LOG — FULL (all statuses, all dryRun values) ===');
  const [w17] = await conn.execute(
    `SELECT l.userId, u.name, u.email, l.digestType, l.status, l.weekKey, l.sentAt, l.dryRun
     FROM userEmailSendLog l
     LEFT JOIN users u ON u.id = l.userId
     WHERE l.weekKey = '2026W17'
     ORDER BY l.digestType, l.sentAt`
  );
  console.log('Total W17 log entries:', w17.length);
  
  // Group by digestType + dryRun + status
  const groups = {};
  w17.forEach(r => {
    const key = `${r.digestType}|dryRun=${r.dryRun}|status=${r.status}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });
  
  for (const [key, rows] of Object.entries(groups)) {
    console.log(`\n  [${key}] — ${rows.length} entries:`);
    rows.forEach(r => console.log(`    userId=${r.userId} | ${r.name || '?'} | ${r.email || '?'} | sentAt=${r.sentAt}`));
  }

  // ── W17 real sends only (dryRun=0, status=sent) ──
  console.log('\n=== W17 REAL SENDS ONLY (dryRun=0, status=sent) ===');
  const [realSends] = await conn.execute(
    `SELECT l.userId, u.name, u.email, l.digestType, l.sentAt
     FROM userEmailSendLog l
     LEFT JOIN users u ON u.id = l.userId
     WHERE l.weekKey = '2026W17' AND l.dryRun = 0 AND l.status = 'sent'
     ORDER BY l.digestType, l.sentAt`
  );
  console.log('Total real sends W17:', realSends.length);
  realSends.forEach(r => console.log(`  ${r.digestType} | userId=${r.userId} | ${r.name || '?'} | ${r.email || '?'} | ${r.sentAt}`));

  await conn.end();
}
main().catch(console.error);
