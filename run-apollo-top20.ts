/**
 * Apollo Enrichment — Top-20 Hot/Warm Projects
 * Run via: npx tsx run-apollo-top20.ts
 */

import { getDb } from "./server/db";
import { enrichProjectContacts } from "./server/apolloEnrichment";
import { sql } from "drizzle-orm";

const TARGET_TITLES = [
  "project manager",
  "project engineer",
  "procurement manager",
  "operations manager",
  "maintenance manager",
  "site manager",
  "construction manager",
  "hire manager",
  "rental manager",
  "contracts manager",
  "project director",
  "engineering manager",
];

interface ProjectRow {
  id: number;
  name: string;
  owner: string;
  discoveryStatus: string;
  priority: string;
  enrichmentBlockedReason: string | null;
  send_ready_count: number;
  total_contacts: number;
}

interface SummaryRow {
  id: number;
  name: string;
  priority: string;
  enrichmentBlockedReason: string | null;
  send_ready: number;
  named_unverified: number;
  llm_inferred: number;
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Step 1: Get top hot/warm active projects with no send_ready contacts, not blocked
  const rawResult = await db.execute(sql`
    SELECT 
      p.id,
      p.name,
      p.owner,
      p.discoveryStatus,
      p.priority,
      p.enrichmentBlockedReason,
      COUNT(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 END) as send_ready_count,
      COUNT(c.id) as total_contacts
    FROM projects p
    LEFT JOIN contacts c ON c.project = p.name
    WHERE p.priority IN ('hot', 'warm')
      AND p.discoveryStatus NOT IN ('watchlist_monitor')
      AND p.lifecycleStatus = 'active'
      AND (p.owner IS NOT NULL AND p.owner != '')
      AND p.enrichmentBlockedReason IS NULL
    GROUP BY p.id, p.name, p.owner, p.discoveryStatus, p.priority, p.enrichmentBlockedReason
    HAVING send_ready_count = 0
    ORDER BY 
      CASE p.priority WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END,
      total_contacts DESC,
      p.id
    LIMIT 30
  `);

  // Drizzle mysql2 execute returns [rows, fields] tuple
  const allProjects = (Array.isArray(rawResult) ? rawResult[0] : rawResult) as ProjectRow[];

  if (!Array.isArray(allProjects)) {
    console.error("Unexpected result shape:", typeof allProjects, JSON.stringify(allProjects).substring(0, 200));
    process.exit(1);
  }

  console.log(`\n=== TOP HOT/WARM ACTIVE PROJECTS (no send_ready, not blocked) ===\n`);
  console.log("ID     | PRI  | TOTAL | PROJECT (OWNER)");
  console.log("-".repeat(100));
  for (const p of allProjects) {
    const name = (p.name || "").substring(0, 45).padEnd(45);
    const owner = (p.owner || "").substring(0, 25);
    console.log(`${String(p.id).padStart(6)} | ${(p.priority || "").padEnd(4)} | ${String(p.total_contacts).padStart(5)} | ${name} (${owner})`);
  }

  const top8 = allProjects.slice(0, 8);
  console.log(`\n=== RUNNING APOLLO ENRICHMENT ON TOP ${top8.length} PROJECTS ===\n`);

  // Get first report ID
  const reportRaw = await db.execute(sql`SELECT id FROM reports ORDER BY id LIMIT 1`);
  const reportRows = Array.isArray(reportRaw) ? reportRaw[0] : reportRaw;
  const reportId = (Array.isArray(reportRows) ? reportRows[0] : reportRows)?.id ?? 1;
  console.log(`Using reportId: ${reportId}\n`);

  const results: Array<{
    projectId: number;
    projectName: string;
    owner: string;
    priority: string;
    searched: number;
    found: number;
    enriched: number;
    inserted: number;
    creditsUsed: number;
    blocked: boolean;
    blockedReason?: string;
    error?: string;
  }> = [];

  for (const project of top8) {
    console.log(`\n[${project.priority.toUpperCase()}] ${project.name}`);
    console.log(`  Owner: ${project.owner}`);
    try {
      const result = await enrichProjectContacts(project.id, reportId, {
        enrichEmails: true,
        maxPerCompany: 5,
        targetTitles: TARGET_TITLES,
      });
      console.log(`  ✅ searched=${result.searched} found=${result.found} enriched=${result.enriched} inserted=${result.inserted} credits=${result.creditsUsed}`);
      if (result.blocked) {
        console.log(`  ⚠️  blocked: ${result.blockedReason}`);
      }
      results.push({
        projectId: project.id,
        projectName: project.name,
        owner: project.owner,
        priority: project.priority,
        ...result,
      });
    } catch (err: any) {
      console.log(`  ❌ Error: ${err.message}`);
      results.push({
        projectId: project.id,
        projectName: project.name,
        owner: project.owner,
        priority: project.priority,
        searched: 0,
        found: 0,
        enriched: 0,
        inserted: 0,
        creditsUsed: 0,
        blocked: false,
        error: err.message,
      });
    }
  }

  // Step 2: Final coverage summary
  const summaryRaw = await db.execute(sql`
    SELECT 
      p.id,
      p.name,
      p.priority,
      p.enrichmentBlockedReason,
      COUNT(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 END) as send_ready,
      COUNT(CASE WHEN c.contactTrustTier = 'named_unverified' THEN 1 END) as named_unverified,
      COUNT(CASE WHEN c.contactTrustTier = 'llm_inferred' THEN 1 END) as llm_inferred
    FROM projects p
    LEFT JOIN contacts c ON c.project = p.name
    WHERE p.id IN (${sql.raw(top8.map(p => p.id).join(","))})
    GROUP BY p.id, p.name, p.priority, p.enrichmentBlockedReason
  `);

  const summary = (Array.isArray(summaryRaw) ? summaryRaw[0] : summaryRaw) as SummaryRow[];

  console.log("\n\n=== ENRICHMENT RESULTS SUMMARY ===\n");
  console.log("ID     | PRI  | SEND_RDY | NAMED_UV | LLM | BLOCKED | PROJECT");
  console.log("-".repeat(110));
  let totalSendReady = 0;
  let totalNamedUV = 0;
  for (const r of summary) {
    const blocked = r.enrichmentBlockedReason ? r.enrichmentBlockedReason.substring(0, 30) : "-";
    console.log(
      `${String(r.id).padStart(6)} | ${(r.priority || "").padEnd(4)} | ${String(r.send_ready).padStart(8)} | ${String(r.named_unverified).padStart(8)} | ${String(r.llm_inferred).padStart(3)} | ${blocked.padEnd(30)} | ${(r.name || "").substring(0, 45)}`
    );
    totalSendReady += Number(r.send_ready);
    totalNamedUV += Number(r.named_unverified);
  }

  console.log(`\nTOTAL: ${totalSendReady} send_ready, ${totalNamedUV} named_unverified across ${top8.length} projects`);

  const totalCredits = results.reduce((sum, r) => sum + (r.creditsUsed || 0), 0);
  const totalInserted = results.reduce((sum, r) => sum + (r.inserted || 0), 0);
  const blockedCount = results.filter(r => r.blocked).length;
  const errorCount = results.filter(r => r.error).length;

  console.log(`\n=== CREDIT & INSERTION SUMMARY ===`);
  console.log(`Total Apollo credits used: ${totalCredits}`);
  console.log(`Total contacts inserted:   ${totalInserted}`);
  console.log(`Projects blocked:          ${blockedCount}`);
  console.log(`Projects with errors:      ${errorCount}`);

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
