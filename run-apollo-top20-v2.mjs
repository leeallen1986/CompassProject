/**
 * Apollo Enrichment — Top-20 Hot/Warm WA Projects
 * Runs enrichProjectContacts() on the 8 highest-priority projects
 * with known private-sector org signals.
 */

import { createRequire } from "module";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Use tsx to handle TypeScript imports
const { execSync } = await import("child_process");

// Get project IDs first using raw SQL via mysql2
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Step 1: Get top hot/warm active projects (not watchlist) with no send_ready contacts
const [projects] = await conn.execute(`
  SELECT 
    p.id,
    p.name,
    p.owner,
    p.discoveryStatus,
    p.priority,
    p.projectState,
    p.enrichmentBlockedReason,
    COUNT(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 END) as send_ready_count,
    COUNT(c.id) as total_contacts
  FROM projects p
  LEFT JOIN contacts c ON c.project = p.name
  WHERE p.priority IN ('hot', 'warm')
    AND p.discoveryStatus NOT IN ('watchlist_monitor')
    AND p.lifecycleStatus = 'active'
    AND (p.owner IS NOT NULL AND p.owner != '')
  GROUP BY p.id, p.name, p.owner, p.discoveryStatus, p.priority, p.projectState, p.enrichmentBlockedReason
  ORDER BY 
    CASE p.priority WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END,
    send_ready_count ASC,
    p.id
  LIMIT 30
`);

console.log("\n=== TOP HOT/WARM ACTIVE PROJECTS (contact gap first) ===\n");
console.log("ID  | PRI  | SEND_RDY | TOTAL | BLOCKED | NAME (OWNER)");
console.log("-".repeat(100));

const enrichTargets = [];
for (const p of projects) {
  const blocked = p.enrichment_blocked_reason || "-";
  const name = (p.name || "").substring(0, 40).padEnd(40);
  const owner = (p.owner || "").substring(0, 25).padEnd(25);
  console.log(
    `${String(p.id).padStart(4)} | ${(p.priority || "").padEnd(4)} | ${String(p.send_ready_count).padStart(8)} | ${String(p.total_contacts).padStart(5)} | ${blocked.substring(0, 35).padEnd(35)} | ${name} (${owner})`
  );
  // Only target projects with no send_ready contacts and no blocking reason
  if (p.send_ready_count === 0 && !p.enrichmentBlockedReason) {
    enrichTargets.push({ id: p.id, name: p.name, owner: p.owner, priority: p.priority });
  }
}

console.log(`\n${enrichTargets.length} projects eligible for Apollo enrichment (no send_ready, not blocked)`);

if (enrichTargets.length === 0) {
  console.log("No eligible projects found. Exiting.");
  await conn.end();
  process.exit(0);
}

// Step 2: Get the first report ID (needed for enrichProjectContacts)
const [[firstReport]] = await conn.execute(`SELECT id FROM reports ORDER BY id LIMIT 1`);
const reportId = firstReport?.id || 1;
console.log(`\nUsing reportId: ${reportId}`);

await conn.end();

// Step 3: Run enrichProjectContacts via tsx for the top 8 targets
const top8 = enrichTargets.slice(0, 8);
console.log(`\n=== RUNNING APOLLO ENRICHMENT ON ${top8.length} PROJECTS ===\n`);

for (const project of top8) {
  console.log(`\n[${project.priority.toUpperCase()}] ${project.name} (owner: ${project.owner})`);
  try {
    const result = execSync(
      `npx tsx -e "
import { enrichProjectContacts } from './server/apolloEnrichment.ts';
enrichProjectContacts(${project.id}, ${reportId}, {
  enrichEmails: true,
  maxPerCompany: 5,
  targetTitles: [
    'project manager', 'project engineer', 'procurement manager',
    'operations manager', 'maintenance manager', 'site manager',
    'construction manager', 'hire manager', 'rental manager',
    'contracts manager', 'project director', 'engineering manager'
  ]
}).then(r => {
  console.log(JSON.stringify({
    searched: r.searched,
    found: r.found,
    enriched: r.enriched,
    inserted: r.inserted,
    creditsUsed: r.creditsUsed,
    blocked: r.blocked,
    blockedReason: r.blockedReason
  }));
}).catch(e => console.error('ERROR:', e.message));
"`,
      { cwd: "/home/ubuntu/atlas-copco-intelligence", timeout: 120000, encoding: "utf8" }
    );
    // Extract the JSON result from the output
    const jsonMatch = result.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const res = JSON.parse(jsonMatch[0]);
      console.log(`  ✅ searched=${res.searched} found=${res.found} enriched=${res.enriched} inserted=${res.inserted} credits=${res.creditsUsed}`);
      if (res.blocked) console.log(`  ⚠️  blocked: ${res.blockedReason}`);
    } else {
      console.log(`  Output: ${result.trim().substring(0, 200)}`);
    }
  } catch (err) {
    console.log(`  ❌ Error: ${err.message?.substring(0, 150)}`);
  }
}

// Step 4: Final coverage summary
const conn2 = await mysql.createConnection(process.env.DATABASE_URL);
const [summary] = await conn2.execute(`
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
  WHERE p.id IN (${top8.map(p => p.id).join(",")})
  GROUP BY p.id, p.name, p.priority, p.enrichmentBlockedReason
`);

console.log("\n=== ENRICHMENT RESULTS SUMMARY ===\n");
console.log("ID  | PRI  | SEND_RDY | NAMED_UV | LLM | BLOCKED | PROJECT");
console.log("-".repeat(100));
let totalSendReady = 0;
let totalNamedUV = 0;
for (const r of summary) {
  const blocked = r.enrichmentBlockedReason ? r.enrichmentBlockedReason.substring(0, 30) : "-";
  console.log(
    `${String(r.id).padStart(4)} | ${(r.priority || "").padEnd(4)} | ${String(r.send_ready).padStart(8)} | ${String(r.named_unverified).padStart(8)} | ${String(r.llm_inferred).padStart(3)} | ${blocked.padEnd(30)} | ${(r.name || "").substring(0, 40)}`
  );
  totalSendReady += Number(r.send_ready);
  totalNamedUV += Number(r.named_unverified);
}
console.log(`\nTOTAL: ${totalSendReady} send_ready, ${totalNamedUV} named_unverified across ${top8.length} projects`);

await conn2.end();
process.exit(0);
