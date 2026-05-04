/**
 * Targeted Contact Sweep
 * 
 * Runs discovery queue for hot/warm projects from recent successful pipeline runs
 * that do NOT yet have a send-ready contact and have a valid owner/contractor.
 * 
 * This runs AFTER the web stakeholder linkage fix is deployed, so new contacts
 * will be properly linked to their projects.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const conn = await mysql.createConnection(DATABASE_URL);

// Step 1: Find hot/warm projects without send-ready contacts, with valid owner/contractor
const [targetProjects] = await conn.execute(`
  SELECT 
    p.id,
    p.name,
    p.priority,
    p.owner,
    p.contractors,
    p.discoveryStatus,
    p.discoveryAttempts,
    p.lastDiscoveryAt,
    p.sector,
    p.matchedBusinessLines,
    (SELECT COUNT(*) FROM contactProjects cp 
     INNER JOIN contacts c ON c.id = cp.contactId 
     WHERE cp.projectId = p.id 
     AND c.email IS NOT NULL 
     AND c.enrichmentStatus = 'enriched') as sendReadyCount,
    (SELECT COUNT(*) FROM contactProjects cp WHERE cp.projectId = p.id) as linkedContactCount
  FROM projects p
  WHERE p.priority IN ('hot', 'warm')
    AND p.projectType = 'opportunity'
    AND (p.suppressed = false OR p.suppressed IS NULL)
    AND (p.geoBlockedReason IS NULL)
    AND (p.projectCountry = 'AU' OR p.projectCountry IS NULL)
    AND p.matchedBusinessLines IS NOT NULL
    AND JSON_LENGTH(p.matchedBusinessLines) > 0
    AND p.owner IS NOT NULL
    AND p.owner != ''
    AND p.owner NOT LIKE 'http%'
  HAVING sendReadyCount = 0
  ORDER BY 
    FIELD(p.priority, 'hot', 'warm'),
    p.lastActivityAt DESC
  LIMIT 50
`);

console.log(`\n=== TARGETED CONTACT SWEEP ===`);
console.log(`Found ${targetProjects.length} hot/warm projects without send-ready contacts\n`);

// Step 2: Classify each project
const validTargets = [];
const blockedTargets = [];

for (const p of targetProjects) {
  const owner = p.owner || '';
  const contractors = (() => {
    try {
      if (!p.contractors) return [];
      if (typeof p.contractors === 'string') return JSON.parse(p.contractors);
      return p.contractors;
    } catch { return []; }
  })();
  
  // Check if owner is a URL (invalid)
  const ownerIsUrl = /^https?:\/\//.test(owner);
  // Check if we have at least one valid company to search
  const hasValidContractor = contractors.some(c => c.name && !c.name.startsWith('http'));
  const hasValidOwner = !ownerIsUrl && owner.length > 2;
  
  if (!hasValidOwner && !hasValidContractor) {
    blockedTargets.push({ ...p, reason: 'no_valid_company' });
  } else {
    validTargets.push(p);
  }
}

console.log(`Valid targets: ${validTargets.length}`);
console.log(`Blocked (no valid company): ${blockedTargets.length}\n`);

// Step 3: Show the target list
console.log(`--- VALID TARGETS (will be queued for discovery) ---`);
for (const p of validTargets) {
  console.log(`  [${p.priority.toUpperCase()}] #${p.id} ${p.name} | owner: ${(p.owner || '').substring(0, 40)} | status: ${p.discoveryStatus || 'none'} | attempts: ${p.discoveryAttempts || 0} | linked: ${p.linkedContactCount}`);
}

console.log(`\n--- BLOCKED TARGETS ---`);
for (const p of blockedTargets) {
  console.log(`  [${p.priority.toUpperCase()}] #${p.id} ${p.name} | owner: ${(p.owner || '').substring(0, 40)} | reason: ${p.reason}`);
}

// Step 4: Queue all valid targets for discovery by setting their status
let queued = 0;
for (const p of validTargets) {
  // Only queue if not already running or in cooldown
  const status = p.discoveryStatus;
  if (status === 'discovery_running') {
    console.log(`  Skipping #${p.id} — already running`);
    continue;
  }
  
  await conn.execute(`
    UPDATE projects 
    SET discoveryStatus = 'discovery_queued', 
        discoveryPriority = 'A'
    WHERE id = ?
  `, [p.id]);
  queued++;
}

console.log(`\n=== QUEUED ${queued} PROJECTS FOR DISCOVERY ===`);
console.log(`These will be processed on the next pipeline run (batch size: 50)`);

// Step 5: Summary stats
const [totalStats] = await conn.execute(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN priority = 'hot' THEN 1 ELSE 0 END) as hot,
    SUM(CASE WHEN priority = 'warm' THEN 1 ELSE 0 END) as warm
  FROM projects
  WHERE projectType = 'opportunity'
    AND (suppressed = false OR suppressed IS NULL)
    AND priority IN ('hot', 'warm')
`);

const [sendReadyStats] = await conn.execute(`
  SELECT COUNT(DISTINCT p.id) as count
  FROM projects p
  INNER JOIN contactProjects cp ON cp.projectId = p.id
  INNER JOIN contacts c ON c.id = cp.contactId
  WHERE p.priority IN ('hot', 'warm')
    AND p.projectType = 'opportunity'
    AND (p.suppressed = false OR p.suppressed IS NULL)
    AND c.email IS NOT NULL
    AND c.enrichmentStatus = 'enriched'
`);

const [queuedStats] = await conn.execute(`
  SELECT COUNT(*) as count
  FROM projects
  WHERE discoveryStatus = 'discovery_queued'
    AND projectType = 'opportunity'
    AND (suppressed = false OR suppressed IS NULL)
`);

console.log(`\n=== CURRENT STATE ===`);
console.log(`Total hot/warm projects: ${totalStats[0].total} (${totalStats[0].hot} hot, ${totalStats[0].warm} warm)`);
console.log(`With send-ready contact: ${sendReadyStats[0].count}`);
console.log(`Now queued for discovery: ${queuedStats[0].count}`);
console.log(`Coverage rate: ${((sendReadyStats[0].count / totalStats[0].total) * 100).toFixed(1)}%`);

await conn.end();
console.log('\nDone. Run the pipeline to process the queued projects.');
