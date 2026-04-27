/**
 * Validate Step 4-7 data flow into Monday digest
 * Traces: DB presence → scoring → tier → digest shortlist → drop reasons
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL!;

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);
  
  // ── 1. Find the latest report (digest uses getLatestReport → most recent report) ──
  const [reportRows]: any = await conn.execute(
    `SELECT id, weekEnding FROM reports ORDER BY id DESC LIMIT 1`
  );
  const latestReport = reportRows[0];
  console.log(`\n=== LATEST REPORT ===`);
  console.log(`Report ID: ${latestReport.id}, Week Ending: ${latestReport.weekEnding}`);
  
  // ── 2. Count ALL projects linked to this report ──
  const [totalRows]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE reportId = ?`, [latestReport.id]
  );
  console.log(`\nTotal projects in latest report: ${totalRows[0].cnt}`);
  
  // ── 3. Identify Step 4-7 source projects this week (Mon Apr 21 to Sun Apr 27 UTC) ──
  // Step 4: AusTender (projectKey LIKE 'austender-%')
  // Step 5: DMIRS (projectKey LIKE 'dmirs-%')  
  // Step 6: Gov Major Projects (projectKey LIKE 'gov-%')
  // Step 7: AEMO (projectKey LIKE 'aemo-%')
  // Step 8: Projectory Enrichment (updates existing projects — check updatedAt this week)
  
  const weekStart = '2026-04-20 00:00:00'; // Monday UTC
  const weekEnd = '2026-04-27 23:59:59';   // Sunday UTC
  
  // Step 4: AusTender projects created this week
  const [austenderNew]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE projectKey LIKE 'austender-%' AND createdAt >= ? AND createdAt <= ?`,
    [weekStart, weekEnd]
  );
  console.log(`\n=== STEP 4: AusTender ===`);
  console.log(`New projects this week: ${austenderNew[0].cnt}`);
  
  // All AusTender projects in latest report
  const [austenderAll]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE projectKey LIKE 'austender-%' AND reportId = ?`,
    [latestReport.id]
  );
  console.log(`Total in latest report: ${austenderAll[0].cnt}`);
  
  // Step 3a: TendersWA (projectKey LIKE 'wa-tender-%' or 'tenders-wa-%')
  const [tendersWANew]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE (projectKey LIKE 'wa-tender-%' OR projectKey LIKE 'tenders-wa-%' OR projectKey LIKE 'WAT-%') AND createdAt >= ? AND createdAt <= ?`,
    [weekStart, weekEnd]
  );
  console.log(`\n=== STEP 3a: TendersWA ===`);
  console.log(`New projects this week: ${tendersWANew[0].cnt}`);
  
  const [tendersWAAll]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE (projectKey LIKE 'wa-tender-%' OR projectKey LIKE 'tenders-wa-%' OR projectKey LIKE 'WAT-%') AND reportId = ?`,
    [latestReport.id]
  );
  console.log(`Total in latest report: ${tendersWAAll[0].cnt}`);
  
  // Step 5: DMIRS
  const [dmirsNew]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE projectKey LIKE 'dmirs-%' AND createdAt >= ? AND createdAt <= ?`,
    [weekStart, weekEnd]
  );
  console.log(`\n=== STEP 5: DMIRS ===`);
  console.log(`New projects this week: ${dmirsNew[0].cnt}`);
  
  const [dmirsAll]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE projectKey LIKE 'dmirs-%' AND reportId = ?`,
    [latestReport.id]
  );
  console.log(`Total in latest report: ${dmirsAll[0].cnt}`);
  
  // Step 6: Gov Major Projects
  const [govNew]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE projectKey LIKE 'gov-%' AND createdAt >= ? AND createdAt <= ?`,
    [weekStart, weekEnd]
  );
  console.log(`\n=== STEP 6: Gov Major Projects ===`);
  console.log(`New projects this week: ${govNew[0].cnt}`);
  
  const [govAll]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE projectKey LIKE 'gov-%' AND reportId = ?`,
    [latestReport.id]
  );
  console.log(`Total in latest report: ${govAll[0].cnt}`);
  
  // Step 7: AEMO
  const [aemoNew]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE projectKey LIKE 'aemo-%' AND createdAt >= ? AND createdAt <= ?`,
    [weekStart, weekEnd]
  );
  console.log(`\n=== STEP 7: AEMO ===`);
  console.log(`New projects this week: ${aemoNew[0].cnt}`);
  
  const [aemoAll]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE projectKey LIKE 'aemo-%' AND reportId = ?`,
    [latestReport.id]
  );
  console.log(`Total in latest report: ${aemoAll[0].cnt}`);
  
  // ── 4. Projectory Enrichment: projects updated this week (any source) ──
  const [projectoryUpdated]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE updatedAt >= ? AND updatedAt <= ? AND reportId = ?`,
    [weekStart, weekEnd, latestReport.id]
  );
  console.log(`\n=== STEP 8: Projectory Enrichment (updates) ===`);
  console.log(`Projects updated this week: ${projectoryUpdated[0].cnt}`);
  
  // Check projectory-specific enrichment by looking at projectoryUrl field
  const [projectoryEnriched]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE projectoryUrl IS NOT NULL AND reportId = ?`,
    [latestReport.id]
  );
  console.log(`Projects with Projectory URL (ever enriched): ${projectoryEnriched[0].cnt}`);
  
  // ── 5. Check scoring/tier/lifecycle for Step 4-7 projects ──
  console.log(`\n=== SCORING & TIER STATUS ===`);
  
  // AusTender projects scoring
  const [austenderScoring]: any = await conn.execute(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN actionTier IS NOT NULL THEN 1 ELSE 0 END) as hasTier,
      SUM(CASE WHEN actionTier = 'tier1_actionable' THEN 1 ELSE 0 END) as tier1,
      SUM(CASE WHEN actionTier = 'tier2_discovery' THEN 1 ELSE 0 END) as tier2,
      SUM(CASE WHEN actionTier = 'tier3_monitor' THEN 1 ELSE 0 END) as tier3,
      SUM(CASE WHEN priority = 'hot' THEN 1 ELSE 0 END) as hot,
      SUM(CASE WHEN priority = 'warm' THEN 1 ELSE 0 END) as warm,
      SUM(CASE WHEN priority = 'cold' THEN 1 ELSE 0 END) as cold,
      SUM(CASE WHEN suppressed = 1 THEN 1 ELSE 0 END) as suppressed,
      SUM(CASE WHEN lifecycleState = 'stale' THEN 1 ELSE 0 END) as stale
    FROM projects WHERE projectKey LIKE 'austender-%' AND reportId = ?`,
    [latestReport.id]
  );
  console.log(`\nAusTender projects in report:`);
  console.log(JSON.stringify(austenderScoring[0], null, 2));
  
  // TendersWA scoring
  const [tendersWAScoring]: any = await conn.execute(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN actionTier IS NOT NULL THEN 1 ELSE 0 END) as hasTier,
      SUM(CASE WHEN actionTier = 'tier1_actionable' THEN 1 ELSE 0 END) as tier1,
      SUM(CASE WHEN actionTier = 'tier2_discovery' THEN 1 ELSE 0 END) as tier2,
      SUM(CASE WHEN actionTier = 'tier3_monitor' THEN 1 ELSE 0 END) as tier3,
      SUM(CASE WHEN priority = 'hot' THEN 1 ELSE 0 END) as hot,
      SUM(CASE WHEN priority = 'warm' THEN 1 ELSE 0 END) as warm,
      SUM(CASE WHEN priority = 'cold' THEN 1 ELSE 0 END) as cold,
      SUM(CASE WHEN suppressed = 1 THEN 1 ELSE 0 END) as suppressed,
      SUM(CASE WHEN lifecycleState = 'stale' THEN 1 ELSE 0 END) as stale
    FROM projects WHERE (projectKey LIKE 'wa-tender-%' OR projectKey LIKE 'tenders-wa-%' OR projectKey LIKE 'WAT-%') AND reportId = ?`,
    [latestReport.id]
  );
  console.log(`\nTendersWA projects in report:`);
  console.log(JSON.stringify(tendersWAScoring[0], null, 2));
  
  // DMIRS scoring
  const [dmirsScoring]: any = await conn.execute(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN actionTier IS NOT NULL THEN 1 ELSE 0 END) as hasTier,
      SUM(CASE WHEN actionTier = 'tier1_actionable' THEN 1 ELSE 0 END) as tier1,
      SUM(CASE WHEN actionTier = 'tier2_discovery' THEN 1 ELSE 0 END) as tier2,
      SUM(CASE WHEN actionTier = 'tier3_monitor' THEN 1 ELSE 0 END) as tier3,
      SUM(CASE WHEN priority = 'hot' THEN 1 ELSE 0 END) as hot,
      SUM(CASE WHEN priority = 'warm' THEN 1 ELSE 0 END) as warm,
      SUM(CASE WHEN priority = 'cold' THEN 1 ELSE 0 END) as cold,
      SUM(CASE WHEN suppressed = 1 THEN 1 ELSE 0 END) as suppressed,
      SUM(CASE WHEN lifecycleState = 'stale' THEN 1 ELSE 0 END) as stale
    FROM projects WHERE projectKey LIKE 'dmirs-%' AND reportId = ?`,
    [latestReport.id]
  );
  console.log(`\nDMIRS projects in report:`);
  console.log(JSON.stringify(dmirsScoring[0], null, 2));
  
  // Gov scoring
  const [govScoring]: any = await conn.execute(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN actionTier IS NOT NULL THEN 1 ELSE 0 END) as hasTier,
      SUM(CASE WHEN actionTier = 'tier1_actionable' THEN 1 ELSE 0 END) as tier1,
      SUM(CASE WHEN actionTier = 'tier2_discovery' THEN 1 ELSE 0 END) as tier2,
      SUM(CASE WHEN actionTier = 'tier3_monitor' THEN 1 ELSE 0 END) as tier3,
      SUM(CASE WHEN priority = 'hot' THEN 1 ELSE 0 END) as hot,
      SUM(CASE WHEN priority = 'warm' THEN 1 ELSE 0 END) as warm,
      SUM(CASE WHEN priority = 'cold' THEN 1 ELSE 0 END) as cold,
      SUM(CASE WHEN suppressed = 1 THEN 1 ELSE 0 END) as suppressed,
      SUM(CASE WHEN lifecycleState = 'stale' THEN 1 ELSE 0 END) as stale
    FROM projects WHERE projectKey LIKE 'gov-%' AND reportId = ?`,
    [latestReport.id]
  );
  console.log(`\nGov Major Projects in report:`);
  console.log(JSON.stringify(govScoring[0], null, 2));
  
  // AEMO scoring
  const [aemoScoring]: any = await conn.execute(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN actionTier IS NOT NULL THEN 1 ELSE 0 END) as hasTier,
      SUM(CASE WHEN actionTier = 'tier1_actionable' THEN 1 ELSE 0 END) as tier1,
      SUM(CASE WHEN actionTier = 'tier2_discovery' THEN 1 ELSE 0 END) as tier2,
      SUM(CASE WHEN actionTier = 'tier3_monitor' THEN 1 ELSE 0 END) as tier3,
      SUM(CASE WHEN priority = 'hot' THEN 1 ELSE 0 END) as hot,
      SUM(CASE WHEN priority = 'warm' THEN 1 ELSE 0 END) as warm,
      SUM(CASE WHEN priority = 'cold' THEN 1 ELSE 0 END) as cold,
      SUM(CASE WHEN suppressed = 1 THEN 1 ELSE 0 END) as suppressed,
      SUM(CASE WHEN lifecycleState = 'stale' THEN 1 ELSE 0 END) as stale
    FROM projects WHERE projectKey LIKE 'aemo-%' AND reportId = ?`,
    [latestReport.id]
  );
  console.log(`\nAEMO projects in report:`);
  console.log(JSON.stringify(aemoScoring[0], null, 2));
  
  // ── 6. Check which projects would pass digest relevance filter (score > 40) ──
  // The digest uses scoreProjectForUser which checks territory, industry, BL match
  // We can't replicate the full scoring here, but we CAN check the prerequisites:
  // - not suppressed
  // - has a reportId matching latest report
  // - has actionTier or priority set
  
  console.log(`\n=== DIGEST ELIGIBILITY (prerequisites) ===`);
  
  // Projects that would be EXCLUDED from digest
  const [excludedSuppressed]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE suppressed = 1 AND reportId = ?`,
    [latestReport.id]
  );
  console.log(`Suppressed (excluded from digest): ${excludedSuppressed[0].cnt}`);
  
  // Projects with no actionTier (may still pass if priority is set)
  const [noTier]: any = await conn.execute(
    `SELECT COUNT(*) as cnt FROM projects WHERE actionTier IS NULL AND reportId = ?`,
    [latestReport.id]
  );
  console.log(`No actionTier assigned: ${noTier[0].cnt}`);
  
  // ── 7. Check freshness gate — would the digest actually send? ──
  console.log(`\n=== FRESHNESS GATE CHECK ===`);
  const [latestCompleted]: any = await conn.execute(
    `SELECT id, status, startedAt, completedAt, durationMs FROM pipelineRuns WHERE status = 'completed' ORDER BY id DESC LIMIT 1`
  );
  if (latestCompleted.length > 0) {
    const run = latestCompleted[0];
    const ageHours = (Date.now() - new Date(run.completedAt).getTime()) / (1000 * 60 * 60);
    console.log(`Latest completed run: ${run.id}, completed at ${run.completedAt}, age: ${ageHours.toFixed(1)}h`);
    console.log(`Freshness gate threshold: 26h`);
    console.log(`Would pass freshness gate: ${ageHours <= 26 ? 'YES' : 'NO (STALE)'}`);
  } else {
    console.log(`No completed runs found — freshness gate would BLOCK digest`);
  }
  
  // ── 8. Sample Step 4-7 projects that were DROPPED and why ──
  console.log(`\n=== SAMPLE DROPPED PROJECTS (Step 4-7 sources) ===`);
  
  // Suppressed Step 4-7 projects
  const [suppressedStep47]: any = await conn.execute(
    `SELECT name, projectKey, priority, actionTier, lifecycleState, suppressed 
     FROM projects 
     WHERE reportId = ? 
       AND suppressed = 1
       AND (projectKey LIKE 'austender-%' OR projectKey LIKE 'dmirs-%' OR projectKey LIKE 'gov-%' OR projectKey LIKE 'aemo-%' OR projectKey LIKE 'wa-tender-%' OR projectKey LIKE 'tenders-wa-%' OR projectKey LIKE 'WAT-%')
     LIMIT 10`,
    [latestReport.id]
  );
  console.log(`\nSuppressed Step 4-7 projects (sample):`);
  suppressedStep47.forEach((p: any) => console.log(`  - ${p.name} [${p.projectKey}] priority=${p.priority} tier=${p.actionTier} lifecycle=${p.lifecycleState}`));
  
  // Stale Step 4-7 projects
  const [staleStep47]: any = await conn.execute(
    `SELECT name, projectKey, priority, actionTier, lifecycleState 
     FROM projects 
     WHERE reportId = ? 
       AND lifecycleState = 'stale'
       AND (projectKey LIKE 'austender-%' OR projectKey LIKE 'dmirs-%' OR projectKey LIKE 'gov-%' OR projectKey LIKE 'aemo-%' OR projectKey LIKE 'wa-tender-%' OR projectKey LIKE 'tenders-wa-%' OR projectKey LIKE 'WAT-%')
     LIMIT 10`,
    [latestReport.id]
  );
  console.log(`\nStale Step 4-7 projects (sample):`);
  staleStep47.forEach((p: any) => console.log(`  - ${p.name} [${p.projectKey}] priority=${p.priority} tier=${p.actionTier}`));
  
  // No tier Step 4-7 projects
  const [noTierStep47]: any = await conn.execute(
    `SELECT name, projectKey, priority, actionTier, lifecycleState 
     FROM projects 
     WHERE reportId = ? 
       AND actionTier IS NULL
       AND (projectKey LIKE 'austender-%' OR projectKey LIKE 'dmirs-%' OR projectKey LIKE 'gov-%' OR projectKey LIKE 'aemo-%' OR projectKey LIKE 'wa-tender-%' OR projectKey LIKE 'tenders-wa-%' OR projectKey LIKE 'WAT-%')
     LIMIT 10`,
    [latestReport.id]
  );
  console.log(`\nNo-tier Step 4-7 projects (sample):`);
  noTierStep47.forEach((p: any) => console.log(`  - ${p.name} [${p.projectKey}] priority=${p.priority} lifecycle=${p.lifecycleState}`));
  
  // ── 9. Check actual projectKey prefixes in the DB ──
  console.log(`\n=== PROJECT KEY PREFIX DISTRIBUTION ===`);
  const [prefixes]: any = await conn.execute(
    `SELECT 
      SUBSTRING_INDEX(projectKey, '-', 1) as prefix, 
      COUNT(*) as cnt 
     FROM projects 
     WHERE reportId = ?
     GROUP BY prefix 
     ORDER BY cnt DESC 
     LIMIT 20`,
    [latestReport.id]
  );
  prefixes.forEach((p: any) => console.log(`  ${p.prefix}: ${p.cnt}`));
  
  // ── 10. Check BL scores for Step 4-7 projects ──
  console.log(`\n=== BL SCORES FOR STEP 4-7 PROJECTS ===`);
  const [blScored]: any = await conn.execute(
    `SELECT COUNT(DISTINCT bs.projectId) as cnt 
     FROM businessLineScores bs 
     JOIN projects p ON bs.projectId = p.id 
     WHERE p.reportId = ?
       AND (p.projectKey LIKE 'austender-%' OR p.projectKey LIKE 'dmirs-%' OR p.projectKey LIKE 'gov-%' OR p.projectKey LIKE 'aemo-%' OR p.projectKey LIKE 'wa-tender-%' OR p.projectKey LIKE 'tenders-wa-%' OR p.projectKey LIKE 'WAT-%')`,
    [latestReport.id]
  );
  console.log(`Step 4-7 projects with BL scores: ${blScored[0].cnt}`);
  
  // ── 11. GRAND SUMMARY ──
  console.log(`\n${'='.repeat(60)}`);
  console.log(`GRAND SUMMARY: Step 4-7 Data Flow Into Monday Digest`);
  console.log(`${'='.repeat(60)}`);
  
  // Count all Step 4-7 projects in report
  const [step47Total]: any = await conn.execute(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN suppressed = 1 THEN 1 ELSE 0 END) as suppressed,
      SUM(CASE WHEN lifecycleState = 'stale' THEN 1 ELSE 0 END) as stale,
      SUM(CASE WHEN actionTier IS NULL THEN 1 ELSE 0 END) as noTier,
      SUM(CASE WHEN actionTier = 'tier1_actionable' THEN 1 ELSE 0 END) as tier1,
      SUM(CASE WHEN actionTier = 'tier2_discovery' THEN 1 ELSE 0 END) as tier2,
      SUM(CASE WHEN actionTier = 'tier3_monitor' THEN 1 ELSE 0 END) as tier3,
      SUM(CASE WHEN priority = 'hot' THEN 1 ELSE 0 END) as hot,
      SUM(CASE WHEN priority = 'warm' THEN 1 ELSE 0 END) as warm,
      SUM(CASE WHEN suppressed = 0 OR suppressed IS NULL THEN 1 ELSE 0 END) as notSuppressed
    FROM projects 
    WHERE reportId = ?
      AND (projectKey LIKE 'austender-%' OR projectKey LIKE 'dmirs-%' OR projectKey LIKE 'gov-%' OR projectKey LIKE 'aemo-%' OR projectKey LIKE 'wa-tender-%' OR projectKey LIKE 'tenders-wa-%' OR projectKey LIKE 'WAT-%')`,
    [latestReport.id]
  );
  const s = step47Total[0];
  console.log(`Total Step 4-7 projects in latest report: ${s.total}`);
  console.log(`  Suppressed (excluded): ${s.suppressed}`);
  console.log(`  Not suppressed (eligible pool): ${s.notSuppressed}`);
  console.log(`  Stale: ${s.stale}`);
  console.log(`  No tier assigned: ${s.noTier}`);
  console.log(`  Tier 1 (actionable): ${s.tier1}`);
  console.log(`  Tier 2 (discovery): ${s.tier2}`);
  console.log(`  Tier 3 (monitor): ${s.tier3}`);
  console.log(`  Hot: ${s.hot}`);
  console.log(`  Warm: ${s.warm}`);
  console.log(`\nDigest eligible (not suppressed + has tier or priority): ${Number(s.notSuppressed) - Number(s.noTier)}`);
  console.log(`Note: Final shortlisting depends on per-user relevance score > 40 (territory + BL match)`);
  
  // Check how many Step 4-7 projects were created this week specifically
  const [step47ThisWeek]: any = await conn.execute(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN projectKey LIKE 'austender-%' THEN 1 ELSE 0 END) as austender,
      SUM(CASE WHEN projectKey LIKE 'wa-tender-%' OR projectKey LIKE 'tenders-wa-%' OR projectKey LIKE 'WAT-%' THEN 1 ELSE 0 END) as tendersWA,
      SUM(CASE WHEN projectKey LIKE 'dmirs-%' THEN 1 ELSE 0 END) as dmirs,
      SUM(CASE WHEN projectKey LIKE 'gov-%' THEN 1 ELSE 0 END) as gov,
      SUM(CASE WHEN projectKey LIKE 'aemo-%' THEN 1 ELSE 0 END) as aemo
    FROM projects 
    WHERE reportId = ?
      AND createdAt >= ? AND createdAt <= ?
      AND (projectKey LIKE 'austender-%' OR projectKey LIKE 'dmirs-%' OR projectKey LIKE 'gov-%' OR projectKey LIKE 'aemo-%' OR projectKey LIKE 'wa-tender-%' OR projectKey LIKE 'tenders-wa-%' OR projectKey LIKE 'WAT-%')`,
    [latestReport.id, weekStart, weekEnd]
  );
  const w = step47ThisWeek[0];
  console.log(`\nNew Step 4-7 projects created THIS WEEK:`);
  console.log(`  Total: ${w.total}`);
  console.log(`  AusTender: ${w.austender}`);
  console.log(`  TendersWA: ${w.tendersWA}`);
  console.log(`  DMIRS: ${w.dmirs}`);
  console.log(`  Gov: ${w.gov}`);
  console.log(`  AEMO: ${w.aemo}`);
  
  await conn.end();
  console.log(`\nValidation complete.`);
}

main().catch(err => { console.error(err); process.exit(1); });
