import 'dotenv/config';
import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check post-sweep state
const [sendReady] = await conn.execute(`
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

const [newLinks] = await conn.execute(`
  SELECT COUNT(*) as count FROM contactProjects
  WHERE createdAt > DATE_SUB(NOW(), INTERVAL 2 HOUR)
`);

const [newContacts] = await conn.execute(`
  SELECT COUNT(*) as count, enrichmentSource
  FROM contacts
  WHERE createdAt > DATE_SUB(NOW(), INTERVAL 2 HOUR)
  GROUP BY enrichmentSource
`);

const [discoveryStatus] = await conn.execute(`
  SELECT discoveryStatus, COUNT(*) as count
  FROM projects
  WHERE priority IN ('hot', 'warm')
    AND projectType = 'opportunity'
    AND (suppressed = false OR suppressed IS NULL)
  GROUP BY discoveryStatus
  ORDER BY count DESC
`);

const [apolloCredits] = await conn.execute(`
  SELECT SUM(creditsUsed) as total
  FROM apolloCreditLog
  WHERE createdAt > DATE_SUB(NOW(), INTERVAL 2 HOUR)
`);

const [totalHotWarm] = await conn.execute(`
  SELECT COUNT(*) as total,
    SUM(CASE WHEN priority = 'hot' THEN 1 ELSE 0 END) as hot,
    SUM(CASE WHEN priority = 'warm' THEN 1 ELSE 0 END) as warm
  FROM projects
  WHERE projectType = 'opportunity'
    AND (suppressed = false OR suppressed IS NULL)
    AND priority IN ('hot', 'warm')
`);

const [hotWithContact] = await conn.execute(`
  SELECT COUNT(DISTINCT p.id) as count
  FROM projects p
  INNER JOIN contactProjects cp ON cp.projectId = p.id
  INNER JOIN contacts c ON c.id = cp.contactId
  WHERE p.priority = 'hot'
    AND p.projectType = 'opportunity'
    AND (p.suppressed = false OR p.suppressed IS NULL)
    AND c.email IS NOT NULL
    AND c.enrichmentStatus = 'enriched'
`);

const [totalHot] = await conn.execute(`
  SELECT COUNT(*) as count FROM projects
  WHERE priority = 'hot' AND projectType = 'opportunity'
    AND (suppressed = false OR suppressed IS NULL)
`);

const [namedStakeholder] = await conn.execute(`
  SELECT COUNT(DISTINCT p.id) as count
  FROM projects p
  INNER JOIN contactProjects cp ON cp.projectId = p.id
  INNER JOIN contacts c ON c.id = cp.contactId
  WHERE p.priority = 'hot'
    AND p.projectType = 'opportunity'
    AND (p.suppressed = false OR p.suppressed IS NULL)
    AND c.name IS NOT NULL
`);

console.log('=== POST-SWEEP ANALYSIS ===');
console.log(`Total hot/warm projects: ${totalHotWarm[0].total} (${totalHotWarm[0].hot} hot, ${totalHotWarm[0].warm} warm)`);
console.log(`Hot/warm with send-ready contact: ${sendReady[0].count} (${((sendReady[0].count / totalHotWarm[0].total) * 100).toFixed(1)}%)`);
console.log(`Hot projects with send-ready contact: ${hotWithContact[0].count} / ${totalHot[0].count} (${((hotWithContact[0].count / totalHot[0].count) * 100).toFixed(1)}%)`);
console.log(`Hot projects with named stakeholder: ${namedStakeholder[0].count} / ${totalHot[0].count} (${((namedStakeholder[0].count / totalHot[0].count) * 100).toFixed(1)}%)`);
console.log(`\nNew contactProjects links (last 2h): ${newLinks[0].count}`);
console.log('New contacts by source (last 2h):');
for (const r of newContacts) console.log(`  ${r.enrichmentSource}: ${r.count}`);
console.log(`Apollo credits used (last 2h): ${apolloCredits[0].total || 0}`);
console.log('\nDiscovery status distribution (hot/warm):');
for (const r of discoveryStatus) console.log(`  ${r.discoveryStatus || 'null'}: ${r.count}`);

// Check which projects were processed and their outcomes
const [processed] = await conn.execute(`
  SELECT p.id, p.name, p.priority, p.discoveryStatus, p.discoveryAttempts,
    (SELECT COUNT(*) FROM contactProjects cp WHERE cp.projectId = p.id) as linkCount
  FROM projects p
  WHERE p.lastDiscoveryAt > DATE_SUB(NOW(), INTERVAL 2 HOUR)
    AND p.priority IN ('hot', 'warm')
  ORDER BY p.priority, p.name
  LIMIT 60
`);

console.log(`\n=== PROJECTS PROCESSED IN LAST 2 HOURS: ${processed.length} ===`);
for (const p of processed) {
  console.log(`  [${p.priority.toUpperCase()}] #${p.id} ${p.name.substring(0, 50)} → ${p.discoveryStatus} (links: ${p.linkCount})`);
}

await conn.end();
