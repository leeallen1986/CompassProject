/**
 * Manual Apollo contact rescue pass
 * Runs both the backfill pass (named_unverified → send_ready) and
 * the manual contact pass (manual pending → email reveal) for hot/warm projects
 * with no send_ready contacts.
 *
 * Usage: node scripts/runApolloRescue.mjs [--dry-run]
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const isDryRun = process.argv.includes('--dry-run');
console.log(`\n=== Apollo Contact Rescue Pass ${isDryRun ? '(DRY RUN)' : ''} ===`);
console.log(`Started: ${new Date().toISOString()}\n`);

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check today's Apollo credit usage
const [[creditRow]] = await conn.execute(`
  SELECT COALESCE(SUM(creditsUsed), 0) as used
  FROM apolloCreditLog
  WHERE DATE(createdAt) = CURDATE()
`);
const dailyUsed = Number(creditRow.used);
const DAILY_CAP = 300;
const remaining = Math.max(0, DAILY_CAP - dailyUsed);
console.log(`Apollo credits today: ${dailyUsed} used / ${DAILY_CAP} cap → ${remaining} remaining`);

if (remaining < 5) {
  console.log('❌ Not enough credits remaining today. Exiting.');
  await conn.end();
  process.exit(0);
}

// ── Phase 1: Backfill pass (named_unverified contacts on hot/warm projects with 0 send_ready) ──
console.log('\n--- Phase 1: Backfill Pass (named_unverified → send_ready) ---');
const [backfillTargets] = await conn.execute(`
  SELECT DISTINCT
    cp.projectId,
    p.name AS projectName,
    p.priority,
    SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) AS send_ready_count,
    SUM(CASE WHEN c.contactTrustTier = 'named_unverified'
      AND c.rejectionReason IS NULL AND c.crmOrphan = 0
      AND (c.enrichmentSource = 'apollo' OR c.linkedin IS NOT NULL)
      AND (c.enrichmentStatus IS NULL
        OR (c.enrichmentStatus NOT IN ('enriched', 'not_found') AND c.enrichedAt IS NULL)
        OR c.enrichedAt < DATE_SUB(NOW(), INTERVAL 7 DAY))
    THEN 1 ELSE 0 END) AS eligible_count
  FROM projects p
  JOIN contactProjects cp ON cp.projectId = p.id
  JOIN contacts c ON c.id = cp.contactId AND c.rejectionReason IS NULL AND c.crmOrphan = 0
  WHERE p.priority IN ('hot', 'warm')
    AND p.lifecycleStatus = 'active'
    AND (p.suppressed IS NULL OR p.suppressed = 0)
  GROUP BY cp.projectId, p.name, p.priority
  HAVING send_ready_count = 0 AND eligible_count > 0
  ORDER BY p.priority = 'hot' DESC, eligible_count DESC
  LIMIT 30
`);

console.log(`Found ${backfillTargets.length} hot/warm projects with eligible named_unverified contacts`);

// ── Phase 2: Manual pending contacts on hot/warm projects ──
console.log('\n--- Phase 2: Manual Contact Pass (manual pending → email reveal) ---');
const [manualTargets] = await conn.execute(`
  SELECT c.id, c.name, c.company, c.title, c.linkedin, p.priority, p.id AS projectId, p.name AS projectName
  FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  JOIN projects p ON p.id = cp.projectId
  WHERE c.enrichmentSource = 'manual'
    AND c.enrichmentStatus = 'pending'
    AND (c.email IS NULL OR c.email = '')
    AND c.rejectionReason IS NULL
    AND (c.crmOrphan IS NULL OR c.crmOrphan = 0)
    AND p.priority IN ('hot', 'warm')
    AND p.lifecycleStatus = 'active'
    AND (p.suppressed IS NULL OR p.suppressed = 0)
    AND (c.enrichedAt IS NULL OR c.enrichedAt < DATE_SUB(NOW(), INTERVAL 7 DAY))
    AND c.title NOT IN (
      'Finance', 'CRM Contact', 'Invoice via Email', 'Collections Contact',
      'IT', 'Administration', 'Logistics', 'Development',
      'Service Operations', 'Service Purchase',
      'Sales & Marketing', 'HR', 'Legal', 'Department', 'Health & Safety'
    )
  ORDER BY
    FIELD(p.priority, 'hot', 'warm') ASC,
    (c.linkedin IS NOT NULL AND c.linkedin != '') DESC,
    c.createdAt DESC
  LIMIT 200
`);

const projectsWithManual = new Set(manualTargets.map(r => r.projectId));
console.log(`Found ${manualTargets.length} manual pending contacts across ${projectsWithManual.size} projects`);

// ── Summary ──
console.log('\n=== RESCUE PASS SUMMARY ===');
console.log(`Backfill targets (named_unverified): ${backfillTargets.length} projects`);
console.log(`Manual pass targets: ${manualTargets.length} contacts across ${projectsWithManual.size} projects`);
console.log(`Apollo credits available: ${remaining}`);

// Show top 10 backfill targets
console.log('\nTop backfill targets:');
backfillTargets.slice(0, 10).forEach(r => {
  console.log(`  [${r.priority.toUpperCase()}] ${r.projectName} — ${r.eligible_count} eligible contacts`);
});

// Show top 10 manual targets
console.log('\nTop manual pass targets:');
const manualByProject = {};
for (const r of manualTargets) {
  if (!manualByProject[r.projectId]) {
    manualByProject[r.projectId] = { name: r.projectName, priority: r.priority, count: 0 };
  }
  manualByProject[r.projectId].count++;
}
Object.values(manualByProject).slice(0, 10).forEach(p => {
  console.log(`  [${p.priority.toUpperCase()}] ${p.name} — ${p.count} contacts`);
});

if (isDryRun) {
  console.log('\n✓ DRY RUN complete — no credits used, no changes made');
  console.log('Run without --dry-run to execute the rescue pass via the pipeline API');
} else {
  console.log('\n⚡ To execute the rescue pass, trigger it via the pipeline API endpoint:');
  console.log('   POST /api/scheduled/run-pipeline');
  console.log('   (The pipeline will run steps 12b and 12d which perform these exact passes)');
  console.log('\n   Or trigger via Admin > Pipeline in the dashboard.');
}

await conn.end();
