import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get column names
const [projCols] = await conn.execute('SHOW COLUMNS FROM projects');
const [contCols] = await conn.execute('SHOW COLUMNS FROM contacts');

const pc = projCols.map(r => r.Field);
const cc = contCols.map(r => r.Field);

console.log('\n=== PROJECT COLUMNS (relevant) ===');
console.log(pc.filter(c => /stale|suppress|digest|lifecycle|priority/i.test(c)).join(', '));

console.log('\n=== CONTACT COLUMNS (relevant) ===');
console.log(cc.filter(c => /trust|enrich|phone|email|source/i.test(c)).join(', '));

// Run health queries
const [trustTiers] = await conn.execute(`
  SELECT contactTrustTier, COUNT(*) as count
  FROM contacts
  GROUP BY contactTrustTier
  ORDER BY count DESC
`);
console.log('\n=== CONTACT TRUST TIERS ===');
trustTiers.forEach(r => console.log(`  ${r.contactTrustTier || 'NULL'}: ${r.count}`));

const [enrichSources] = await conn.execute(`
  SELECT enrichmentSource, COUNT(*) as count
  FROM contacts
  WHERE enrichmentSource IS NOT NULL
  GROUP BY enrichmentSource
  ORDER BY count DESC
  LIMIT 15
`);
console.log('\n=== ENRICHMENT SOURCES ===');
enrichSources.forEach(r => console.log(`  ${r.enrichmentSource}: ${r.count}`));

// Check which lifecycle column name is correct
const hasLifecycle = pc.includes('lifecycleStatus');
const lifecycleCol = hasLifecycle ? 'lifecycleStatus' : (pc.find(c => /lifecycle/i.test(c)) || 'lifecycleStatus');
console.log(`\nLifecycle column: ${lifecycleCol}`);

const [lifecycle] = await conn.execute(`
  SELECT ${lifecycleCol}, COUNT(*) as count
  FROM projects
  GROUP BY ${lifecycleCol}
  ORDER BY count DESC
`);
console.log('\n=== PROJECT LIFECYCLE STATUS ===');
lifecycle.forEach(r => console.log(`  ${r[lifecycleCol] || 'NULL'}: ${r.count}`));

// Check digestSafe column
const hasDigestSafe = pc.includes('digestSafe');
console.log(`\ndigestSafe column exists: ${hasDigestSafe}`);
if (hasDigestSafe) {
  const [ds] = await conn.execute(`
    SELECT digestSafe, COUNT(*) as count
    FROM projects
    WHERE suppressed = 0 AND ${lifecycleCol} = 'active'
    GROUP BY digestSafe
  `);
  console.log('\n=== DIGEST SAFE (active, non-suppressed) ===');
  ds.forEach(r => console.log(`  digestSafe=${r.digestSafe}: ${r.count}`));
}

// Projects with no send_ready contacts
const [noContact] = await conn.execute(`
  SELECT COUNT(*) as count
  FROM projects p
  WHERE p.suppressed = 0
    AND p.${lifecycleCol} = 'active'
    AND p.priority IN ('hot', 'warm')
    AND NOT EXISTS (
      SELECT 1 FROM contacts c
      JOIN contactProjects cp ON cp.contactId = c.id
      WHERE cp.projectId = p.id
      AND c.contactTrustTier = 'send_ready'
    )
`);
console.log(`\n=== HOT/WARM PROJECTS WITH NO SEND_READY CONTACT ===`);
console.log(`  Count: ${noContact[0].count}`);

// Lusha stats
const [lushaStats] = await conn.execute(`
  SELECT 
    COUNT(*) as total_attempts,
    SUM(creditsUsed) as total_credits,
    SUM(CASE WHEN contactPromoted = 1 THEN 1 ELSE 0 END) as total_promoted,
    SUM(CASE WHEN DATE(createdAt) = CURDATE() THEN creditsUsed ELSE 0 END) as credits_today
  FROM lushaEnrichmentLog
`);
console.log('\n=== LUSHA STATS ===');
const ls = lushaStats[0];
console.log(`  Total attempts: ${ls.total_attempts}`);
console.log(`  Total credits used: ${ls.total_credits}`);
console.log(`  Total promoted to send_ready: ${ls.total_promoted}`);
console.log(`  Credits used today: ${ls.credits_today}`);

// Check if phone is being stored in contacts from Lusha
const [lushaPhoneCheck] = await conn.execute(`
  SELECT COUNT(*) as contacts_with_phone_from_lusha
  FROM contacts
  WHERE enrichmentSource = 'lusha' AND phone IS NOT NULL AND phone != ''
`);
console.log(`\n=== LUSHA PHONE STORAGE CHECK ===`);
console.log(`  Contacts with phone stored (from Lusha): ${lushaPhoneCheck[0].contacts_with_phone_from_lusha}`);

// Per-rep digest eligibility check (users with profiles)
const [repStats] = await conn.execute(`
  SELECT 
    u.name,
    u.email,
    up.territories,
    up.assignedBusinessLines,
    (SELECT COUNT(*) FROM userEmailSendLog esl WHERE esl.userId = u.id) as emails_received,
    (SELECT MAX(esl.sentAt) FROM userEmailSendLog esl WHERE esl.userId = u.id) as last_email
  FROM users u
  LEFT JOIN userProfiles up ON up.userId = u.id
  WHERE u.role = 'user'
  ORDER BY emails_received DESC
`);
console.log('\n=== REP DIGEST STATS ===');
repStats.forEach(r => console.log(`  ${r.name} | territories: ${r.territories || 'NONE'} | BLs: ${r.assignedBusinessLines || 'NONE'} | emails: ${r.emails_received} | last: ${r.last_email || 'never'}`));

// Check pipeline freshness - last successful run
const [pipelineRuns] = await conn.execute(`
  SELECT id, status, startedAt, completedAt
  FROM pipelineRuns
  ORDER BY completedAt DESC
  LIMIT 5
`);
console.log('\n=== RECENT PIPELINE RUNS ===');
pipelineRuns.forEach(r => console.log(`  Run ${r.id}: ${r.status} | started: ${r.startedAt} | completed: ${r.completedAt}`));

await conn.end();
