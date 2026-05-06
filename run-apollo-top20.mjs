/**
 * Apollo enrichment runner for Top-20 hot/warm WA projects with contact gaps.
 */
import * as dotenv from "dotenv";
dotenv.config();

import mysql from "mysql2/promise";

const db = await mysql.createConnection(process.env.DATABASE_URL);

// ── 1. Get Top-20 hot/warm WA projects ──────────────────────────────────────
const [projects] = await db.execute(`
  SELECT
    p.id,
    p.name,
    p.priority,
    p.projectState AS state,
    p.sector,
    p.discoveryStatus AS discovery_status,
    p.matchedBusinessLines AS matched_business_lines,
    COUNT(c.id) AS total_contacts,
    SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) AS send_ready_count,
    SUM(CASE WHEN c.contactTrustTier = 'named_unverified' THEN 1 ELSE 0 END) AS named_unverified_count,
    SUM(CASE WHEN c.contactTrustTier = 'llm_inferred' THEN 1 ELSE 0 END) AS llm_inferred_count
  FROM projects p
  LEFT JOIN contacts c ON c.project = p.name
  WHERE p.priority IN ('hot', 'warm')
    AND (p.projectState = 'WA' OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
    AND p.discoveryStatus NOT IN ('watchlist_monitor', 'archived')
  GROUP BY p.id, p.name, p.priority, p.projectState, p.sector, p.discoveryStatus, p.matchedBusinessLines
  ORDER BY
    CASE p.priority WHEN 'hot' THEN 0 ELSE 1 END,
    send_ready_count ASC,
    total_contacts ASC
  LIMIT 20
`);

console.log(`\n=== TOP-20 HOT/WARM WA PROJECTS FOR APOLLO ENRICHMENT ===\n`);
console.log(`${"Project".padEnd(55)} ${"Pri".padEnd(5)} ${"SendRdy".padEnd(8)} ${"Unverif".padEnd(8)} ${"LLM".padEnd(5)} Total`);
console.log("─".repeat(90));

for (const p of projects) {
  console.log(
    `${String(p.name).substring(0, 54).padEnd(55)} ${String(p.priority).padEnd(5)} ${String(p.send_ready_count).padEnd(8)} ${String(p.named_unverified_count).padEnd(8)} ${String(p.llm_inferred_count).padEnd(5)} ${p.total_contacts}`
  );
}

// ── 2. Show org signals ──────────────────────────────────────────────────────
console.log(`\n=== CONTRACTOR / OWNER SIGNALS ===\n`);

const projectIds = projects.map(p => p.id);
if (projectIds.length === 0) {
  console.log("No WA hot/warm projects found.");
  await db.end();
  process.exit(0);
}

const placeholders = projectIds.map(() => "?").join(",");
const [projectDetails] = await db.execute(
  `SELECT id, name, contractors, owner, location FROM projects WHERE id IN (${placeholders})`,
  projectIds
);

for (const p of projectDetails) {
  const orgs = [p.owner, p.contractors].filter(Boolean).join(" | ");
  console.log(`  ${String(p.name).substring(0, 50).padEnd(52)} → ${orgs || "(no org data)"}`);
}

// ── 3. Check Apollo API key ──────────────────────────────────────────────────
console.log(`\n=== APOLLO API KEY STATUS ===\n`);

const apolloKey = process.env.APOLLO_API_KEY;
if (!apolloKey) {
  console.log("❌ APOLLO_API_KEY is NOT set.");
  console.log("   Add it in Settings → Secrets to enable Apollo enrichment.");
} else {
  console.log(`✓ APOLLO_API_KEY is present (length: ${apolloKey.length})`);
  console.log(`  Apollo enrichment is available for these ${projects.length} projects.`);
  console.log(`  Use Admin → Enrich Contacts to trigger enrichment, or the tRPC endpoint.`);
}

// ── 4. Current coverage summary ─────────────────────────────────────────────
console.log(`\n=== CURRENT CONTACT COVERAGE (HOT/WARM WA) ===\n`);

const [summary] = await db.execute(`
  SELECT
    COUNT(DISTINCT p.id) AS project_count,
    SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) AS send_ready,
    SUM(CASE WHEN c.contactTrustTier = 'named_unverified' THEN 1 ELSE 0 END) AS named_unverified,
    SUM(CASE WHEN c.contactTrustTier = 'llm_inferred' THEN 1 ELSE 0 END) AS llm_inferred
  FROM projects p
  LEFT JOIN contacts c ON c.project = p.name
  WHERE p.priority IN ('hot', 'warm')
    AND (p.projectState = 'WA' OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
    AND p.discoveryStatus NOT IN ('watchlist_monitor', 'archived')
`);

const s = summary[0];
console.log(`  Hot/warm WA projects:  ${s.project_count}`);
console.log(`  Send-ready contacts:   ${s.send_ready}`);
console.log(`  Named unverified:      ${s.named_unverified}`);
console.log(`  LLM inferred:          ${s.llm_inferred}`);

// ── 5. Digest-safe gate count ────────────────────────────────────────────────
const [gateRows] = await db.execute(`
  SELECT
    COUNT(*) AS total_gated,
    SUM(CASE WHEN digestSafe = 1 THEN 1 ELSE 0 END) AS digest_safe_count,
    SUM(CASE WHEN primaryAcceptable = 1 THEN 1 ELSE 0 END) AS primary_acceptable,
    SUM(CASE WHEN backupAcceptable = 1 THEN 1 ELSE 0 END) AS backup_acceptable
  FROM project_validation_gates
`).catch(() => [[{ total_gated: 0, digest_safe_count: 0, primary_acceptable: 0, backup_acceptable: 0 }]]);

const g = gateRows[0];
console.log(`\n=== DIGEST GATE STATUS ===\n`);
console.log(`  Projects with any gate set:  ${g.total_gated}`);
console.log(`  Digest-safe:                 ${g.digest_safe_count} of 3 required`);
console.log(`  Primary acceptable:          ${g.primary_acceptable}`);
console.log(`  Backup acceptable:           ${g.backup_acceptable}`);

if (parseInt(g.digest_safe_count) >= 3) {
  console.log(`\n  ✓ Territory threshold MET — digest can proceed after manual preview approval`);
} else {
  const needed = 3 - parseInt(g.digest_safe_count);
  console.log(`\n  ⏳ Need ${needed} more digest-safe project(s) before digest can send`);
}

// ── 6. Projects with no contacts at all ─────────────────────────────────────
const [noContacts] = await db.execute(`
  SELECT p.name, p.priority, p.location
  FROM projects p
  LEFT JOIN contacts c ON c.project = p.name
  WHERE p.priority IN ('hot', 'warm')
    AND (p.projectState = 'WA' OR p.location LIKE '%Western Australia%' OR p.location LIKE '%, WA%')
    AND p.discoveryStatus NOT IN ('watchlist_monitor', 'archived')
    AND c.id IS NULL
  GROUP BY p.id, p.name, p.priority, p.location
  ORDER BY CASE p.priority WHEN 'hot' THEN 0 ELSE 1 END
`);

if (noContacts.length > 0) {
  console.log(`\n=== PROJECTS WITH ZERO CONTACTS (Apollo priority targets) ===\n`);
  for (const p of noContacts) {
    console.log(`  [${p.priority.toUpperCase()}] ${p.name} — ${p.location}`);
  }
}

await db.end();
