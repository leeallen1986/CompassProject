import 'dotenv/config';
import mysql from 'mysql2/promise';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// 1. Linked contacts by source (for hot/warm projects)
const [bySource] = await conn.execute(`
  SELECT c.enrichmentSource, COUNT(*) as count,
    SUM(CASE WHEN c.email IS NOT NULL AND c.enrichmentStatus = 'enriched' THEN 1 ELSE 0 END) as sendReady
  FROM contactProjects cp
  INNER JOIN contacts c ON c.id = cp.contactId
  INNER JOIN projects p ON p.id = cp.projectId
  WHERE p.priority IN ('hot', 'warm')
    AND p.projectType = 'opportunity'
    AND (p.suppressed = false OR p.suppressed IS NULL)
  GROUP BY c.enrichmentSource
  ORDER BY count DESC
`);

// 2. Coverage rates
const [hotTotal] = await conn.execute(`SELECT COUNT(*) as c FROM projects WHERE priority = 'hot' AND projectType = 'opportunity' AND (suppressed = false OR suppressed IS NULL)`);
const [hotWithSendReady] = await conn.execute(`
  SELECT COUNT(DISTINCT p.id) as c FROM projects p
  INNER JOIN contactProjects cp ON cp.projectId = p.id
  INNER JOIN contacts c ON c.id = cp.contactId
  WHERE p.priority = 'hot' AND p.projectType = 'opportunity' AND (p.suppressed = false OR p.suppressed IS NULL)
    AND c.email IS NOT NULL AND c.enrichmentStatus = 'enriched'
`);
const [hotWithNamed] = await conn.execute(`
  SELECT COUNT(DISTINCT p.id) as c FROM projects p
  INNER JOIN contactProjects cp ON cp.projectId = p.id
  INNER JOIN contacts c ON c.id = cp.contactId
  WHERE p.priority = 'hot' AND p.projectType = 'opportunity' AND (p.suppressed = false OR p.suppressed IS NULL)
    AND c.name IS NOT NULL
`);
const [warmTotal] = await conn.execute(`SELECT COUNT(*) as c FROM projects WHERE priority = 'warm' AND projectType = 'opportunity' AND (suppressed = false OR suppressed IS NULL)`);
const [warmWithSendReady] = await conn.execute(`
  SELECT COUNT(DISTINCT p.id) as c FROM projects p
  INNER JOIN contactProjects cp ON cp.projectId = p.id
  INNER JOIN contacts c ON c.id = cp.contactId
  WHERE p.priority = 'warm' AND p.projectType = 'opportunity' AND (p.suppressed = false OR p.suppressed IS NULL)
    AND c.email IS NOT NULL AND c.enrichmentStatus = 'enriched'
`);

// 3. Blocked projects by reason
const [blocked] = await conn.execute(`
  SELECT discoveryStatus, COUNT(*) as count
  FROM projects
  WHERE priority IN ('hot', 'warm') AND projectType = 'opportunity'
    AND (suppressed = false OR suppressed IS NULL)
    AND discoveryStatus LIKE 'blocked%'
  GROUP BY discoveryStatus
  ORDER BY count DESC
`);

// 4. New links created today
const [todayLinks] = await conn.execute(`
  SELECT COUNT(*) as c FROM contactProjects WHERE createdAt > CURDATE()
`);

// 5. Queue state
const [queueState] = await conn.execute(`
  SELECT discoveryStatus, COUNT(*) as count
  FROM projects
  WHERE priority IN ('hot', 'warm') AND projectType = 'opportunity'
    AND (suppressed = false OR suppressed IS NULL)
  GROUP BY discoveryStatus
  ORDER BY count DESC
`);

// 6. Digest impact - projects with actionable contacts in digest
const [digestActionable] = await conn.execute(`
  SELECT COUNT(DISTINCT p.id) as c
  FROM projects p
  INNER JOIN contactProjects cp ON cp.projectId = p.id
  INNER JOIN contacts c ON c.id = cp.contactId
  WHERE p.priority IN ('hot', 'warm')
    AND p.projectType = 'opportunity'
    AND (p.suppressed = false OR p.suppressed IS NULL)
    AND c.email IS NOT NULL
    AND c.enrichmentStatus = 'enriched'
    AND p.createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY)
`);

console.log('=== FINAL POST-SWEEP SUMMARY ===\n');
console.log('1. LINKED CONTACTS BY SOURCE (hot/warm projects):');
console.log('   Source                 | Linked | Send-Ready');
console.log('   ----------------------|--------|----------');
for (const r of bySource) console.log('   ' + (r.enrichmentSource || 'null').padEnd(22) + '| ' + String(r.count).padEnd(7) + '| ' + r.sendReady);

console.log('\n2. COVERAGE RATES:');
console.log('   Hot projects with send-ready contact: ' + hotWithSendReady[0].c + ' / ' + hotTotal[0].c + ' (' + ((hotWithSendReady[0].c / hotTotal[0].c) * 100).toFixed(1) + '%)');
console.log('   Hot projects with named stakeholder:  ' + hotWithNamed[0].c + ' / ' + hotTotal[0].c + ' (' + ((hotWithNamed[0].c / hotTotal[0].c) * 100).toFixed(1) + '%)');
console.log('   Warm projects with send-ready contact: ' + warmWithSendReady[0].c + ' / ' + warmTotal[0].c + ' (' + ((warmWithSendReady[0].c / warmTotal[0].c) * 100).toFixed(1) + '%)');

console.log('\n3. BLOCKED PROJECTS (hot/warm):');
for (const r of blocked) console.log('   ' + r.discoveryStatus + ': ' + r.count);

console.log('\n4. NEW CONTACT-PROJECT LINKS TODAY: ' + todayLinks[0].c);

console.log('\n5. DISCOVERY STATUS DISTRIBUTION (hot/warm):');
for (const r of queueState) console.log('   ' + (r.discoveryStatus || 'null') + ': ' + r.count);

console.log('\n6. DIGEST IMPACT:');
console.log('   New projects (last 7d) with actionable contacts: ' + digestActionable[0].c);

await conn.end();
