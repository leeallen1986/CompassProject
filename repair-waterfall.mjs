/**
 * repair-waterfall.mjs — Direct MySQL repair (no tsx/drizzle overhead)
 *
 * Fix 1: Backfill orphaned contactProjects rows for web_search/linkedin/llm/apollo
 * Fix 2: Promote discoveryStatus for projects with send_ready contacts
 * Fix 3: Unlink junk CRM contacts from project views
 */

import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('=== Waterfall Repair ===');
console.log(`Started: ${new Date().toISOString()}`);

// ── FIX 1: Backfill orphaned contactProjects rows ──
console.log('\n[Fix 1] Backfilling orphaned contactProjects rows...');

// Insert all missing rows in one bulk operation
const [fix1Result] = await conn.execute(`
  INSERT IGNORE INTO contactProjects (contactId, projectId, projectName, relevance, createdAt)
  SELECT DISTINCT
    c.id as contactId,
    p.id as projectId,
    p.name as projectName,
    CASE WHEN p.owner = c.company THEN 'primary' ELSE 'secondary' END as relevance,
    NOW() as createdAt
  FROM contacts c
  JOIN projects p ON p.name = c.project
  LEFT JOIN contactProjects cp ON cp.contactId = c.id AND cp.projectId = p.id
  WHERE cp.id IS NULL
    AND c.enrichmentSource IN ('web_search', 'linkedin', 'llm', 'apollo')
`);

console.log(`[Fix 1] Inserted ${fix1Result.affectedRows} new contactProjects rows`);

// ── FIX 2: Promote discoveryStatus for projects with send_ready contacts ──
console.log('\n[Fix 2] Promoting discoveryStatus for projects with send_ready contacts...');

const [fix2Result] = await conn.execute(`
  UPDATE projects p
  SET p.discoveryStatus = 'send_ready_contact'
  WHERE p.discoveryStatus != 'send_ready_contact'
    AND EXISTS (
      SELECT 1
      FROM contactProjects cp
      JOIN contacts c ON c.id = cp.contactId
      WHERE cp.projectId = p.id
        AND c.contactTrustTier = 'send_ready'
        AND c.enrichmentSource != 'manual'
        AND (c.email IS NULL OR (
          c.email NOT LIKE '%atlascopco.com'
          AND c.email NOT LIKE '%noreply%'
          AND c.email NOT LIKE '%portal.invoices%'
        ))
    )
`);

console.log(`[Fix 2] Promoted ${fix2Result.affectedRows} projects to send_ready_contact`);

// ── FIX 3: Unlink junk CRM contacts ──
console.log('\n[Fix 3] Unlinking junk CRM contacts from project views...');

const [fix3Result] = await conn.execute(`
  DELETE cp FROM contactProjects cp
  JOIN contacts c ON c.id = cp.contactId
  WHERE c.enrichmentSource = 'manual'
    AND (
      (c.roleBucket REGEXP '^[0-9+() -]+$')
      OR (c.email LIKE '%atlascopco.com')
      OR (c.email LIKE '%noreply%')
      OR (c.email LIKE '%no-reply%')
      OR (c.email LIKE '%portal.invoices%')
    )
`);

console.log(`[Fix 3] Removed ${fix3Result.affectedRows} junk CRM contactProjects rows`);

// ── VERIFICATION: Post-repair state ──
console.log('\n[Verify] Post-repair state...');

const [sourceStats] = await conn.execute(`
  SELECT 
    c.enrichmentSource as source,
    COUNT(DISTINCT c.id) as total_contacts,
    COUNT(DISTINCT cp.contactId) as linked_contacts,
    COUNT(DISTINCT CASE WHEN c.contactTrustTier = 'send_ready' THEN c.id END) as send_ready,
    ROUND(COUNT(DISTINCT cp.contactId) * 100.0 / NULLIF(COUNT(DISTINCT c.id), 0), 1) as link_pct
  FROM contacts c
  LEFT JOIN contactProjects cp ON cp.contactId = c.id
  GROUP BY c.enrichmentSource
  ORDER BY total_contacts DESC
`);

console.log('\n=== POST-REPAIR SOURCE STATS ===');
console.table(sourceStats);

const [projStats] = await conn.execute(`
  SELECT discoveryStatus, COUNT(*) as cnt
  FROM projects
  WHERE lifecycleStatus = 'active' OR lifecycleStatus IS NULL
  GROUP BY discoveryStatus
  ORDER BY cnt DESC
`);

console.log('\n=== POST-REPAIR PROJECT discoveryStatus ===');
console.table(projStats);

const [stuckCheck] = await conn.execute(`
  SELECT COUNT(DISTINCT p.id) as still_stuck
  FROM projects p
  JOIN contactProjects cp ON cp.projectId = p.id
  JOIN contacts c ON c.id = cp.contactId AND c.contactTrustTier = 'send_ready'
  WHERE p.discoveryStatus != 'send_ready_contact'
    AND c.enrichmentSource != 'manual'
`);

console.log(`\n[Verify] Projects still stuck (have send_ready but wrong status): ${stuckCheck[0].still_stuck}`);

await conn.end();
console.log(`\nCompleted: ${new Date().toISOString()}`);
