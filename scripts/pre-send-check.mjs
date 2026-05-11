import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection({uri: process.env.DATABASE_URL, connectTimeout: 10000});

// Get latest SEND gate results
const [gates] = await conn.query(
  'SELECT userId, decision, blockers, top3Snapshot FROM repDigestGateResults WHERE decision="SEND" ORDER BY createdAt DESC LIMIT 5'
);

// Get user names
const userIds = gates.map(g => g.userId);
const [users] = await conn.query('SELECT id, name FROM users WHERE id IN (?)', [userIds]);
const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║           FINAL PRE-SEND SAFETY CHECK — 2026-05-11         ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

for (const g of gates) {
  const name = userMap[g.userId] || 'Unknown';
  const blockers = g.blockers ? JSON.parse(g.blockers) : [];
  const top3 = g.top3Snapshot ? JSON.parse(g.top3Snapshot) : [];
  
  console.log(`\n━━━ ${name} (ID: ${g.userId}) ━━━`);
  console.log(`Decision: ${g.decision}`);
  console.log(`Blockers: ${blockers.length === 0 ? 'NONE' : blockers.map(b => b.criterion || b.type || 'unknown').join(', ')}`);
  console.log(`Top 3 Projects:`);
  
  for (const p of top3) {
    // Get the contact details from the contacts table
    const [contacts] = await conn.query(
      'SELECT name, email, contactTrustTier, title FROM contacts WHERE reportId = ? AND contactTrustTier IN ("send_ready", "named_verified") ORDER BY contactTrustTier ASC LIMIT 3',
      [p.id]
    );
    
    console.log(`  ${p.name} (score: ${p.score})`);
    console.log(`    Snapshot contact: ${p.contactName || 'none'}`);
    if (contacts.length > 0) {
      for (const c of contacts) {
        console.log(`    DB contact: ${c.name} | ${c.email} | tier: ${c.contactTrustTier} | title: ${c.title}`);
      }
    } else {
      console.log(`    DB contacts: checking broader...`);
      const [allContacts] = await conn.query(
        'SELECT name, email, contactTrustTier, title FROM contacts WHERE reportId = ? ORDER BY FIELD(contactTrustTier, "send_ready", "named_verified", "named_unverified", "role_only") LIMIT 3',
        [p.id]
      );
      for (const c of allContacts) {
        console.log(`    DB contact: ${c.name || 'unnamed'} | ${c.email || 'no email'} | tier: ${c.contactTrustTier} | title: ${c.title || 'no title'}`);
      }
    }
  }
}

// Check email send path
console.log('\n\n━━━ EMAIL PATH VERIFICATION ━━━');
const [emailConfig] = await conn.query("SELECT * FROM systemConfig WHERE configKey LIKE '%email%' OR configKey LIKE '%digest%' LIMIT 10");
if (emailConfig.length > 0) {
  for (const ec of emailConfig) {
    console.log(`  ${ec.configKey}: ${ec.configValue}`);
  }
} else {
  console.log('  No systemConfig entries for email/digest found');
}

// Check if Resend API key is configured (env check)
console.log(`  RESEND_API_KEY: ${process.env.RESEND_API_KEY ? 'SET (' + process.env.RESEND_API_KEY.substring(0, 8) + '...)' : 'NOT SET'}`);
console.log(`  EMAIL_FROM_ADDRESS: ${process.env.EMAIL_FROM_ADDRESS || 'NOT SET'}`);
console.log(`  EMAIL_DIGESTS_ENABLED: ${process.env.EMAIL_DIGESTS_ENABLED || 'NOT SET'}`);

await conn.end();
