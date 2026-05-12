import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '/home/ubuntu/atlas-copco-intelligence/.env' });

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }
const conn = await mysql.createConnection(DB_URL);

// Brett = WA/NT territory
const [brettProjects] = await conn.execute(`
  SELECT DISTINCT p.id, p.name, p.location, p.owner, p.priority, pbs.score
  FROM projects p
  JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
  WHERE pbs.scoringDimension = 'Pump/Dewatering'
    AND (p.lifecycleStatus = 'active' OR p.lifecycleStatus IS NULL)
    AND (p.suppressed = 0 OR p.suppressed IS NULL)
    AND (LOWER(p.location) LIKE '%western australia%' OR LOWER(p.location) LIKE '% wa%'
         OR LOWER(p.location) LIKE '%pilbara%' OR LOWER(p.location) LIKE '%kalgoorlie%'
         OR LOWER(p.location) LIKE '%perth%' OR LOWER(p.location) LIKE '%karratha%'
         OR LOWER(p.location) LIKE '%northern territory%' OR LOWER(p.location) LIKE '% nt%')
  ORDER BY pbs.score DESC
  LIMIT 5
`);

// Dan = SA/QLD/VIC/NSW/TAS
const [danProjects] = await conn.execute(`
  SELECT DISTINCT p.id, p.name, p.location, p.owner, p.priority, pbs.score
  FROM projects p
  JOIN projectBusinessLineScores pbs ON pbs.projectId = p.id
  WHERE pbs.scoringDimension = 'Pump/Dewatering'
    AND (p.lifecycleStatus = 'active' OR p.lifecycleStatus IS NULL)
    AND (p.suppressed = 0 OR p.suppressed IS NULL)
    AND (LOWER(p.location) LIKE '%queensland%' OR LOWER(p.location) LIKE '% qld%'
         OR LOWER(p.location) LIKE '%south australia%' OR LOWER(p.location) LIKE '% sa%'
         OR LOWER(p.location) LIKE '%victoria%' OR LOWER(p.location) LIKE '% vic%'
         OR LOWER(p.location) LIKE '%new south wales%' OR LOWER(p.location) LIKE '% nsw%'
         OR LOWER(p.location) LIKE '%tasmania%' OR LOWER(p.location) LIKE '% tas%')
  ORDER BY pbs.score DESC
  LIMIT 5
`);

async function getContacts(projectId) {
  const [rows] = await conn.execute(`
    SELECT c.id, c.name, c.title, c.company, c.contactTrustTier, c.roleRelevance, c.email
    FROM contacts c
    JOIN contactProjects cp ON cp.contactId = c.id
    WHERE cp.projectId = ? AND c.rejectionReason IS NULL
    ORDER BY
      CASE c.contactTrustTier WHEN 'send_ready' THEN 1 WHEN 'named_unverified' THEN 2 ELSE 3 END,
      CASE c.roleRelevance WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
    LIMIT 3
  `, [projectId]);
  return rows;
}

function printProject(p, contacts) {
  console.log(`\n  [${p.id}] ${p.name}`);
  console.log(`  Location: ${p.location} | Priority: ${p.priority} | BL Score: ${p.score}`);
  console.log(`  Owner: ${p.owner || 'unknown'}`);
  if (contacts.length === 0) {
    console.log("  -> NO CONTACTS (action mode: find_site_contact or map_package)");
  } else {
    for (const c of contacts) {
      const tier = c.contactTrustTier || 'unknown';
      const email = c.email ? `email: ${c.email}` : 'no email';
      console.log(`  -> ${c.name} | ${c.title} @ ${c.company}`);
      console.log(`     tier=${tier} | role=${c.roleRelevance} | ${email}`);
    }
  }
}

console.log("\n==================================================================");
console.log("QA: Pump Contact Selection - Brett Hansen (WA/NT) & Dan Day (East)");
console.log("==================================================================");

console.log("\n-- BRETT HANSEN -- Top 5 Pump Projects (WA/NT) --");
for (const p of brettProjects) {
  const contacts = await getContacts(p.id);
  printProject(p, contacts);
}

console.log("\n-- DAN DAY -- Top 5 Pump Projects (SA/QLD/VIC/NSW/TAS) --");
for (const p of danProjects) {
  const contacts = await getContacts(p.id);
  printProject(p, contacts);
}

// Part A: TMR quarantine proof
const [[tmrFab]] = await conn.execute(`SELECT COUNT(*) as count FROM contacts WHERE rejectionReason LIKE '%fabricated%'`);
const [[tmrAll]] = await conn.execute(`SELECT COUNT(*) as count FROM contacts WHERE rejectionReason IS NOT NULL`);
const [tmrRows] = await conn.execute(`SELECT id, name, contactTrustTier, rejectionReason FROM contacts WHERE id IN (1080026, 1080027, 1080028)`);

console.log("\n-- PART A: TMR Quarantine Proof --");
console.log(`  Contacts with fabricated-domain rejection: ${tmrFab.count}`);
console.log(`  Total quarantined (all reasons): ${tmrAll.count}`);
for (const r of tmrRows) {
  console.log(`  ID ${r.id}: ${r.name} | tier=${r.contactTrustTier} | reason="${r.rejectionReason}"`);
}

// Account priors
const [[apCount]] = await conn.execute("SELECT COUNT(*) as count FROM accountPriors");
const [[apA]] = await conn.execute("SELECT COUNT(*) as count FROM accountPriors WHERE priorityLevel = 'A - High priority'");
const [[apB]] = await conn.execute("SELECT COUNT(*) as count FROM accountPriors WHERE priorityLevel = 'B - Medium priority'");
const [apSamples] = await conn.execute("SELECT canonicalName, priorityLevel, segment, scoreOutOf100 FROM accountPriors WHERE priorityLevel = 'A - High priority' ORDER BY scoreOutOf100 DESC LIMIT 5");

console.log("\n-- ACCOUNT PRIORS (WA Top 100 Targets) --");
console.log(`  Total: ${apCount.count} | Priority A: ${apA.count} (+20pts) | Priority B: ${apB.count} (+12pts)`);
console.log("  Sample Priority A accounts:");
for (const a of apSamples) {
  console.log(`    ${a.canonicalName} | ${a.segment} | score=${a.scoreOutOf100}`);
}

await conn.end();
console.log("\n==================================================================\n");
