import 'dotenv/config';
import { createConnection } from 'mysql2/promise';

const key = process.env.HUNTER_API_KEY;
if (!key) {
  console.log('STATUS: ABSENT — HUNTER_API_KEY is not set in environment');
  console.log('IMPLICATION: All Hunter verification calls silently skipped (no API calls made)');
} else if (key.length < 10) {
  console.log(`STATUS: INVALID — key is too short (${key.length} chars)`);
} else {
  console.log(`STATUS: PRESENT — key starts with: ${key.slice(0, 6)}... length=${key.length}`);
}

const conn = await createConnection(process.env.DATABASE_URL);

// Check Hunter-sourced contacts overall
const [hunterRows] = await conn.execute(
  `SELECT COUNT(*) as total, 
   SUM(CASE WHEN emailVerified = 1 THEN 1 ELSE 0 END) as verified_count,
   SUM(CASE WHEN contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) as send_ready_count
   FROM contacts 
   WHERE source = 'hunter'`
);
console.log('\nHunter-sourced contacts (source = hunter):');
console.log(`  Total: ${hunterRows[0].total}, Verified emails: ${hunterRows[0].verified_count}, Send-ready: ${hunterRows[0].send_ready_count}`);

// Check the 13 demoted projects specifically — contacts join by project name
const [demotedRows] = await conn.execute(`
  SELECT p.name, p.discoveryStatus,
    COUNT(c.id) as total_contacts,
    SUM(CASE WHEN c.emailVerified = 1 THEN 1 ELSE 0 END) as verified_emails,
    SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) as send_ready,
    SUM(CASE WHEN c.source = 'hunter' THEN 1 ELSE 0 END) as hunter_sourced,
    SUM(CASE WHEN c.contactTrustTier = 'named_unverified' THEN 1 ELSE 0 END) as unverified,
    SUM(CASE WHEN c.contactTrustTier = 'llm_inferred' THEN 1 ELSE 0 END) as llm_only
  FROM projects p
  LEFT JOIN contacts c ON c.project = p.name
  WHERE p.discoveryStatus = 'named_contact_no_email'
  GROUP BY p.id, p.name, p.discoveryStatus
  ORDER BY verified_emails DESC, total_contacts DESC
`);

console.log('\n13 Demoted Projects — contact coverage after Hunter run:');
console.log('Project | Total | Verified | Send-Ready | Hunter | Unverified | LLM-only');
console.log('-'.repeat(110));
let totalVerified = 0;
let totalSendReady = 0;
let totalHunter = 0;
for (const row of demotedRows) {
  const name = row.name.length > 45 ? row.name.slice(0, 42) + '...' : row.name.padEnd(45);
  console.log(`${name} | ${String(row.total_contacts).padStart(5)} | ${String(row.verified_emails).padStart(8)} | ${String(row.send_ready).padStart(10)} | ${String(row.hunter_sourced).padStart(6)} | ${String(row.unverified).padStart(10)} | ${String(row.llm_only).padStart(8)}`);
  totalVerified += Number(row.verified_emails);
  totalSendReady += Number(row.send_ready);
  totalHunter += Number(row.hunter_sourced);
}
console.log('-'.repeat(110));
console.log(`TOTAL across ${demotedRows.length} demoted projects: verified=${totalVerified}, send_ready=${totalSendReady}, hunter_sourced=${totalHunter}`);

// Check if any have been re-promoted
const [rePromoted] = await conn.execute(`
  SELECT COUNT(*) as cnt FROM projects 
  WHERE discoveryStatus = 'send_ready_contact'
  AND updatedAt > DATE_SUB(NOW(), INTERVAL 24 HOUR)
`);
console.log(`\nProjects re-promoted to send_ready_contact in last 24h: ${rePromoted[0].cnt}`);

// Check projectValidationGates for digest-safe count
const [gateRows] = await conn.execute(`
  SELECT 
    COUNT(*) as total_gated,
    SUM(CASE WHEN digestSafe = 1 THEN 1 ELSE 0 END) as digest_safe,
    SUM(CASE WHEN primaryAcceptable = 1 THEN 1 ELSE 0 END) as primary_ok,
    SUM(CASE WHEN backupAcceptable = 1 THEN 1 ELSE 0 END) as backup_ok
  FROM projectValidationGates
`);
console.log('\nProjectValidationGates summary:');
console.log(`  Total gated: ${gateRows[0].total_gated}, Digest-safe: ${gateRows[0].digest_safe}, Primary OK: ${gateRows[0].primary_ok}, Backup OK: ${gateRows[0].backup_ok}`);

// Territory threshold status for WA
const [waProjects] = await conn.execute(`
  SELECT p.name, p.priority, p.discoveryStatus, pvg.digestSafe, pvg.primaryAcceptable
  FROM projects p
  LEFT JOIN projectValidationGates pvg ON pvg.projectId = p.id
  WHERE p.priority IN ('hot', 'warm')
  AND pvg.digestSafe = 1
  ORDER BY p.priority, p.name
  LIMIT 10
`);
console.log(`\nWA digest-safe projects (threshold requires 3): ${waProjects.length}`);
for (const row of waProjects) {
  console.log(`  ${row.name} [${row.priority}] digestSafe=${row.digestSafe}`);
}

const threshold = waProjects.length >= 3 ? 'MET' : `NOT MET (need ${3 - waProjects.length} more)`;
console.log(`\nWA digest send threshold: ${threshold}`);
console.log(`Preview-readiness: ${waProjects.length >= 3 ? 'READY FOR PREVIEW (manual review required before first live send)' : 'NOT READY — gate more projects first'}`);

await conn.end();
