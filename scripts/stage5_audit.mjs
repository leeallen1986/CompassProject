/**
 * Stage 5 Database Audit Script
 * Run with: node scripts/stage5_audit.mjs
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const url = new URL(DB_URL.replace("mysql://", "http://"));
const conn = await mysql.createConnection({
  host: url.hostname,
  port: parseInt(url.port || "3306"),
  user: url.username,
  password: url.password,
  database: url.pathname.replace("/", ""),
  ssl: { rejectUnauthorized: false },
});

const results = {};

async function q(label, sql) {
  try {
    const [rows] = await conn.execute(sql);
    results[label] = rows;
    return rows;
  } catch (err) {
    results[label] = { error: err.message };
    return [];
  }
}

console.log("=== ATLAS COPCO — STAGE 5 DATABASE AUDIT ===\n");

// 1. Project totals by lifecycleStatus
console.log("--- 1. PROJECTS BY LIFECYCLE STATUS ---");
console.table(await q("status", `SELECT lifecycleStatus, COUNT(*) as count FROM projects GROUP BY lifecycleStatus ORDER BY count DESC`));

// 2. Projects by priority + status
console.log("\n--- 2. PROJECTS BY PRIORITY × STATUS ---");
console.table(await q("priority_status", `SELECT priority, lifecycleStatus, COUNT(*) as count FROM projects GROUP BY priority, lifecycleStatus ORDER BY priority, lifecycleStatus`));

// 3. Projects by actionTier × status
console.log("\n--- 3. PROJECTS BY ACTION TIER × STATUS ---");
console.table(await q("tier_status", `SELECT actionTier, lifecycleStatus, COUNT(*) as count FROM projects GROUP BY actionTier, lifecycleStatus ORDER BY actionTier, lifecycleStatus`));

// 4. Projects by sector
console.log("\n--- 4. PROJECTS BY SECTOR ---");
console.table(await q("sector", `
  SELECT sector, COUNT(*) as total,
    SUM(CASE WHEN lifecycleStatus='stale' THEN 1 ELSE 0 END) as stale,
    SUM(CASE WHEN lifecycleStatus='active' THEN 1 ELSE 0 END) as active,
    ROUND(SUM(CASE WHEN lifecycleStatus='stale' THEN 1 ELSE 0 END)*100.0/COUNT(*),1) as stale_pct
  FROM projects GROUP BY sector ORDER BY total DESC`));

// 5. Age distribution of active projects
console.log("\n--- 5. AGE OF ACTIVE PROJECTS ---");
console.table(await q("age_active", `
  SELECT CASE
    WHEN DATEDIFF(NOW(), createdAt) <= 7 THEN '0-7 days'
    WHEN DATEDIFF(NOW(), createdAt) <= 30 THEN '8-30 days'
    WHEN DATEDIFF(NOW(), createdAt) <= 90 THEN '31-90 days'
    WHEN DATEDIFF(NOW(), createdAt) <= 180 THEN '91-180 days'
    ELSE '180+ days'
  END as age_bucket, COUNT(*) as count
  FROM projects WHERE lifecycleStatus='active'
  GROUP BY age_bucket ORDER BY MIN(DATEDIFF(NOW(), createdAt))`));

// 6. Age distribution of stale projects
console.log("\n--- 6. AGE OF STALE PROJECTS ---");
console.table(await q("age_stale", `
  SELECT CASE
    WHEN DATEDIFF(NOW(), createdAt) <= 30 THEN '0-30 days'
    WHEN DATEDIFF(NOW(), createdAt) <= 90 THEN '31-90 days'
    WHEN DATEDIFF(NOW(), createdAt) <= 180 THEN '91-180 days'
    WHEN DATEDIFF(NOW(), createdAt) <= 365 THEN '181-365 days'
    ELSE '365+ days'
  END as age_bucket, COUNT(*) as count
  FROM projects WHERE lifecycleStatus='stale'
  GROUP BY age_bucket ORDER BY MIN(DATEDIFF(NOW(), createdAt))`));

// 7. Missing owner
console.log("\n--- 7. PROJECTS WITH MISSING/GENERIC OWNER ---");
console.table(await q("missing_owner", `
  SELECT
    SUM(CASE WHEN owner='' OR owner='Unknown' OR owner='TBC' THEN 1 ELSE 0 END) as missing_owner,
    SUM(CASE WHEN owner!='' AND owner!='Unknown' AND owner!='TBC' THEN 1 ELSE 0 END) as has_owner,
    COUNT(*) as total
  FROM projects WHERE lifecycleStatus IN ('active','stale')`));

// 8. Missing contractors (check if array is empty)
console.log("\n--- 8. PROJECTS WITH EMPTY CONTRACTORS ARRAY ---");
console.table(await q("no_contractors", `
  SELECT
    SUM(CASE WHEN JSON_LENGTH(contractors)=0 OR contractors IS NULL THEN 1 ELSE 0 END) as empty_contractors,
    SUM(CASE WHEN JSON_LENGTH(contractors)>0 THEN 1 ELSE 0 END) as has_contractors,
    COUNT(*) as total
  FROM projects WHERE lifecycleStatus IN ('active','stale')`));

// 9. Missing equipment signals
console.log("\n--- 9. PROJECTS WITH EMPTY EQUIPMENT SIGNALS ---");
console.table(await q("no_signals", `
  SELECT
    SUM(CASE WHEN JSON_LENGTH(equipmentSignals)=0 OR equipmentSignals IS NULL THEN 1 ELSE 0 END) as empty_signals,
    SUM(CASE WHEN JSON_LENGTH(equipmentSignals)>0 THEN 1 ELSE 0 END) as has_signals,
    COUNT(*) as total
  FROM projects WHERE lifecycleStatus IN ('active','stale')`));

// 10. Project-to-contact conversion via contactProjects junction
console.log("\n--- 10. PROJECT-TO-CONTACT CONVERSION (via contactProjects) ---");
console.table(await q("contact_conv", `
  SELECT
    p.lifecycleStatus,
    COUNT(DISTINCT p.id) as total_projects,
    COUNT(DISTINCT cp.projectId) as projects_with_contacts,
    COUNT(DISTINCT p.id) - COUNT(DISTINCT cp.projectId) as projects_without_contacts,
    ROUND(COUNT(DISTINCT cp.projectId)*100.0/COUNT(DISTINCT p.id),1) as contact_coverage_pct
  FROM projects p
  LEFT JOIN contactProjects cp ON cp.projectId = p.id
  WHERE p.lifecycleStatus IN ('active','stale')
  GROUP BY p.lifecycleStatus`));

// 11. Contact enrichment status
console.log("\n--- 11. CONTACT ENRICHMENT STATUS ---");
console.table(await q("enrichment", `
  SELECT
    enrichmentStatus,
    COUNT(*) as count,
    ROUND(COUNT(*)*100.0/SUM(COUNT(*)) OVER(),1) as pct
  FROM contacts GROUP BY enrichmentStatus ORDER BY count DESC`));

// 12. Projects by source prefix
console.log("\n--- 12. PROJECTS BY SOURCE (projectKey prefix) ---");
console.table(await q("source_dist", `
  SELECT
    CASE
      WHEN projectKey LIKE 'rss-%' THEN 'RSS/AI Extraction'
      WHEN projectKey LIKE 'projectory-%' THEN 'Projectory'
      WHEN projectKey LIKE 'dmirs-%' THEN 'DMIRS'
      WHEN projectKey LIKE 'aemo-%' THEN 'AEMO'
      WHEN projectKey LIKE 'gov-%' THEN 'Gov Major Projects'
      WHEN projectKey LIKE 'austender-%' THEN 'AusTender'
      WHEN projectKey LIKE 'icn-%' THEN 'ICN Gateway'
      WHEN projectKey LIKE 'asx-%' THEN 'ASX Monitor'
      WHEN projectKey LIKE 'seed-%' THEN 'Seed/Manual'
      ELSE 'Other/Unknown'
    END as source,
    COUNT(*) as total,
    SUM(CASE WHEN lifecycleStatus='active' THEN 1 ELSE 0 END) as active,
    SUM(CASE WHEN lifecycleStatus='stale' THEN 1 ELSE 0 END) as stale,
    ROUND(SUM(CASE WHEN lifecycleStatus='stale' THEN 1 ELSE 0 END)*100.0/COUNT(*),1) as stale_pct
  FROM projects GROUP BY source ORDER BY total DESC`));

// 13. Near-duplicate clusters
console.log("\n--- 13. NEAR-DUPLICATE CLUSTERS (same 40-char name prefix) ---");
console.table(await q("near_dupes", `
  SELECT
    LOWER(TRIM(SUBSTRING(name,1,40))) as name_prefix,
    COUNT(*) as count,
    GROUP_CONCAT(id ORDER BY id SEPARATOR ', ') as project_ids,
    GROUP_CONCAT(DISTINCT lifecycleStatus ORDER BY lifecycleStatus SEPARATOR ', ') as statuses
  FROM projects
  GROUP BY name_prefix HAVING count > 1
  ORDER BY count DESC LIMIT 30`));

// 14. Missing stage field
console.log("\n--- 14. PROJECTS WITH MISSING STAGE FIELD ---");
console.table(await q("no_stage", `
  SELECT lifecycleStatus,
    SUM(CASE WHEN stage IS NULL OR stage='' THEN 1 ELSE 0 END) as no_stage,
    SUM(CASE WHEN stage IS NOT NULL AND stage!='' THEN 1 ELSE 0 END) as has_stage,
    COUNT(*) as total
  FROM projects GROUP BY lifecycleStatus`));

// 15. Tier 1 stale projects
console.log("\n--- 15. TIER 1 ACTIONABLE PROJECTS THAT ARE STALE ---");
console.table(await q("tier1_stale", `
  SELECT id, SUBSTRING(name,1,50) as name, SUBSTRING(owner,1,30) as owner,
    priority, SUBSTRING(stage,1,40) as stage, createdAt, lastActivityAt
  FROM projects WHERE actionTier='tier1_actionable' AND lifecycleStatus='stale'
  ORDER BY createdAt DESC LIMIT 20`));

// 16. Missing value
console.log("\n--- 16. PROJECTS WITH MISSING/UNKNOWN VALUE ---");
console.table(await q("no_value", `
  SELECT
    SUM(CASE WHEN value='' OR value='Unknown' OR value='TBC' OR value IS NULL THEN 1 ELSE 0 END) as missing_value,
    SUM(CASE WHEN value!='' AND value!='Unknown' AND value!='TBC' AND value IS NOT NULL THEN 1 ELSE 0 END) as has_value,
    COUNT(*) as total
  FROM projects WHERE lifecycleStatus IN ('active','stale')`));

// 17. Generic location
console.log("\n--- 17. PROJECTS WITH GENERIC/MISSING LOCATION ---");
console.table(await q("no_location", `
  SELECT
    SUM(CASE WHEN location='' OR location='Unknown' OR location='TBC' OR location='National' THEN 1 ELSE 0 END) as generic_location,
    SUM(CASE WHEN location!='' AND location!='Unknown' AND location!='TBC' AND location!='National' THEN 1 ELSE 0 END) as specific_location,
    COUNT(*) as total
  FROM projects WHERE lifecycleStatus IN ('active','stale')`));

// 18. Pipeline claim coverage
console.log("\n--- 18. PIPELINE CLAIM COVERAGE ---");
console.table(await q("claims", `
  SELECT
    p.lifecycleStatus,
    COUNT(DISTINCT p.id) as total_projects,
    COUNT(DISTINCT pc.projectId) as claimed_projects,
    ROUND(COUNT(DISTINCT pc.projectId)*100.0/COUNT(DISTINCT p.id),1) as claim_pct
  FROM projects p
  LEFT JOIN pipelineClaims pc ON pc.projectId = p.id
  WHERE p.lifecycleStatus IN ('active','stale')
  GROUP BY p.lifecycleStatus`));

// 19. RSS source performance
console.log("\n--- 19. RSS SOURCE PERFORMANCE ---");
console.table(await q("rss_sources", `
  SELECT rs.name, rs.totalArticles, rs.successCount, rs.failureCount,
    rs.lastFetchedAt,
    SUM(CASE WHEN ra.status='queued' THEN 1 ELSE 0 END) as queued,
    SUM(CASE WHEN ra.status='extracted' THEN 1 ELSE 0 END) as extracted,
    SUM(CASE WHEN ra.status='skipped' THEN 1 ELSE 0 END) as skipped,
    COUNT(ra.id) as total_articles
  FROM rssSources rs
  LEFT JOIN rawArticles ra ON ra.sourceId = rs.id
  GROUP BY rs.id, rs.name, rs.totalArticles, rs.successCount, rs.failureCount, rs.lastFetchedAt
  ORDER BY total_articles DESC`));

// 20. Send-readiness distribution
console.log("\n--- 20. CAMPAIGN CONTACT SEND-READINESS ---");
console.table(await q("send_ready", `
  SELECT sendReadiness, COUNT(*) as count,
    ROUND(COUNT(*)*100.0/SUM(COUNT(*)) OVER(),1) as pct
  FROM campaignContacts GROUP BY sendReadiness ORDER BY count DESC`));

// 21. Stale hot projects
console.log("\n--- 21. STALE HOT PROJECTS ---");
console.table(await q("stale_hot", `
  SELECT id, SUBSTRING(name,1,50) as name, SUBSTRING(owner,1,30) as owner,
    SUBSTRING(stage,1,40) as stage, sector, createdAt, lastActivityAt
  FROM projects WHERE priority='hot' AND lifecycleStatus='stale'
  ORDER BY createdAt DESC LIMIT 15`));

// 22. Recent active projects with zero contacts
console.log("\n--- 22. RECENT ACTIVE PROJECTS (90 days) WITH ZERO CONTACTS ---");
console.table(await q("recent_no_contact", `
  SELECT p.id, SUBSTRING(p.name,1,50) as name, SUBSTRING(p.owner,1,30) as owner,
    p.priority, p.sector, SUBSTRING(p.stage,1,40) as stage, p.createdAt
  FROM projects p
  LEFT JOIN contactProjects cp ON cp.projectId = p.id
  WHERE p.createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    AND p.lifecycleStatus='active' AND cp.id IS NULL
  ORDER BY p.createdAt DESC LIMIT 20`));

// 23. Monthly project creation
console.log("\n--- 23. PROJECT CREATION BY MONTH ---");
console.table(await q("monthly", `
  SELECT DATE_FORMAT(createdAt,'%Y-%m') as month,
    COUNT(*) as total,
    SUM(CASE WHEN lifecycleStatus='active' THEN 1 ELSE 0 END) as active,
    SUM(CASE WHEN lifecycleStatus='stale' THEN 1 ELSE 0 END) as stale
  FROM projects GROUP BY month ORDER BY month DESC LIMIT 18`));

// 24. Projects with no lastActivityAt update (never touched after creation)
console.log("\n--- 24. ACTIVE PROJECTS NEVER TOUCHED (lastActivityAt = createdAt) ---");
console.table(await q("never_touched", `
  SELECT
    SUM(CASE WHEN ABS(TIMESTAMPDIFF(SECOND, lastActivityAt, createdAt)) < 5 THEN 1 ELSE 0 END) as never_touched,
    SUM(CASE WHEN ABS(TIMESTAMPDIFF(SECOND, lastActivityAt, createdAt)) >= 5 THEN 1 ELSE 0 END) as has_activity,
    COUNT(*) as total
  FROM projects WHERE lifecycleStatus='active'`));

// 25. Contacts with emails that have been enriched
console.log("\n--- 25. CONTACT EMAIL ENRICHMENT BREAKDOWN ---");
console.table(await q("email_enrich", `
  SELECT
    enrichmentSource,
    COUNT(*) as total,
    SUM(CASE WHEN enrichedEmail IS NOT NULL AND enrichedEmail!='' THEN 1 ELSE 0 END) as with_email,
    ROUND(SUM(CASE WHEN enrichedEmail IS NOT NULL AND enrichedEmail!='' THEN 1 ELSE 0 END)*100.0/COUNT(*),1) as email_pct
  FROM contacts
  GROUP BY enrichmentSource ORDER BY total DESC`));

await conn.end();

// Save results as JSON for the report
import { writeFileSync } from "fs";
writeFileSync("/home/ubuntu/atlas-copco-intelligence/scripts/stage5_audit_results.json",
  JSON.stringify(results, null, 2));
console.log("\n=== AUDIT COMPLETE — results saved to stage5_audit_results.json ===");
