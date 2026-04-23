import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [rows] = await conn.query(`
  SELECT 
    l.id,
    l.digestType,
    l.sentDate,
    l.sentAt,
    l.status,
    l.weekKey,
    l.itemCount,
    l.dryRun,
    l.error,
    u.name,
    u.email,
    u.role
  FROM userEmailSendLog l
  LEFT JOIN users u ON u.id = l.userId
  WHERE l.dryRun = 0
  ORDER BY l.sentAt ASC
  LIMIT 500
`);

console.log('Total LIVE sends (dryRun=0):', rows.length);

// Group by weekKey + digestType
const grouped = new Map();
for (const r of rows) {
  const key = `${r.weekKey}|${r.digestType}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(r);
}

for (const [key, items] of grouped.entries()) {
  const [week, type] = key.split('|');
  const sentDate = items[0].sentDate;
  console.log(`\n=== ${week} (${sentDate}) — ${type.toUpperCase()} ===`);
  for (const r of items) {
    const status = r.status === 'sent' ? '✓' : '✗';
    const err = r.error ? ` ERROR: ${r.error}` : '';
    const ts = new Date(r.sentAt).toLocaleString('en-AU', { timeZone: 'Australia/Perth', dateStyle: 'short', timeStyle: 'short' });
    console.log(`  ${status} ${r.name || 'unknown'} <${r.email || 'no-email'}> | ${r.itemCount} items | ${ts}${err}`);
  }
}

// Summary by user
console.log('\n\n=== PER-USER SUMMARY (live sends only) ===');
const byUser = new Map();
for (const r of rows) {
  const key = `${r.name}|${r.email}`;
  if (!byUser.has(key)) byUser.set(key, { name: r.name, email: r.email, role: r.role, sends: [] });
  byUser.get(key).sends.push(r);
}
for (const [, u] of byUser.entries()) {
  const monday = u.sends.filter(s => s.digestType === 'monday');
  const thursday = u.sends.filter(s => s.digestType === 'thursday');
  const rollup = u.sends.filter(s => s.digestType === 'manager_rollup');
  const errors = u.sends.filter(s => s.status !== 'sent');
  console.log(`\n  ${u.name} <${u.email}> [${u.role}]`);
  console.log(`    Monday digests:    ${monday.length} sent | avg items: ${monday.length ? Math.round(monday.reduce((a,b) => a + b.itemCount, 0) / monday.length) : 'n/a'}`);
  console.log(`    Thursday reminders: ${thursday.length} sent | avg items: ${thursday.length ? Math.round(thursday.reduce((a,b) => a + b.itemCount, 0) / thursday.length) : 'n/a'}`);
  console.log(`    Manager rollups:   ${rollup.length} sent`);
  if (errors.length) console.log(`    ERRORS: ${errors.length}`);
}

await conn.end();
