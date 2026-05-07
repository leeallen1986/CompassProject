/**
 * run-queue-direct.mjs
 * Runs processDiscoveryQueue directly (no HTTP) in multiple batches.
 * Uses tsx to handle TypeScript imports.
 */
import { execSync, spawn } from "child_process";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const DB_URL = process.env.DATABASE_URL;

async function getStats(db) {
  const [[contacts]] = await db.execute(`
    SELECT
      SUM(contactTrustTier = 'send_ready') as send_ready,
      SUM(contactTrustTier = 'named_unverified') as named_unverified,
      SUM(contactTrustTier = 'named_unverified' AND email IS NOT NULL AND (crmOrphan = 0 OR crmOrphan IS NULL)) as unverified_with_email,
      SUM(contactTrustTier = 'llm_inferred') as llm_inferred
    FROM contacts
    WHERE crmOrphan = 0 OR crmOrphan IS NULL
  `);
  const [[projects]] = await db.execute(`
    SELECT
      SUM(discoveryStatus = 'discovery_queued') as queued,
      SUM(discoveryStatus = 'send_ready_contact') as send_ready_projects,
      SUM(discoveryStatus = 'named_contact_no_email') as named_no_email_projects,
      SUM(discoveryStatus = 'role_only') as role_only_projects,
      SUM(discoveryStatus = 'discovery_running') as running
    FROM projects
    WHERE lifecycleStatus = 'active' OR lifecycleStatus IS NULL
  `);
  return { contacts, projects };
}

async function runBatchViaTsx(batchNum) {
  return new Promise((resolve) => {
    const script = `
import { processDiscoveryQueue } from "./server/discoveryQueue.ts";
(async () => {
  const result = await processDiscoveryQueue({ maxBatch: 50 });
  console.log("RESULT:" + JSON.stringify(result));
  process.exit(0);
})().catch(e => {
  console.error("ERROR:" + e.message);
  process.exit(1);
});
`;
    const tmpFile = `/tmp/batch-${batchNum}.ts`;
    require("fs").writeFileSync(tmpFile, script);
    
    const proc = spawn("npx", ["tsx", tmpFile], {
      cwd: "/home/ubuntu/atlas-copco-intelligence",
      env: { ...process.env },
      timeout: 600000,
    });
    
    let output = "";
    proc.stdout.on("data", (d) => { output += d.toString(); process.stdout.write(d); });
    proc.stderr.on("data", (d) => { output += d.toString(); });
    
    proc.on("close", (code) => {
      const match = output.match(/RESULT:(\{.*\})/);
      if (match) {
        try { resolve(JSON.parse(match[1])); return; } catch {}
      }
      resolve({ error: `Exit code ${code}`, raw: output.slice(-500) });
    });
    
    proc.on("error", (e) => resolve({ error: e.message }));
  });
}

(async () => {
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  
  const db = await mysql.createConnection(DB_URL);

  console.log("=== DISCOVERY QUEUE RUN ===");
  console.log("\n--- BEFORE ---");
  const before = await getStats(db);
  console.log("Contacts:", before.contacts);
  console.log("Projects:", before.projects);

  const totalBatches = 7; // 7 × 50 = 350 projects (covers all 294 queued)
  let totalProcessed = 0;
  let totalNewSendReady = 0;
  let totalFailed = 0;

  for (let i = 1; i <= totalBatches; i++) {
    console.log(`\n[Batch ${i}/${totalBatches}] Running discovery queue (max 50 projects)...`);
    const startTime = Date.now();
    
    const r = await runBatchViaTsx(i);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (r.error) {
      console.log(`  Error: ${r.error}`);
      if (r.raw) console.log(`  Raw: ${r.raw.slice(0, 300)}`);
      break;
    }
    
    console.log(`  Processed: ${r.processed} | send_ready: +${r.newSendReady} | named_no_email: +${r.newNamedNoEmail} | role_only: +${r.newRoleOnly} | blocked: ${r.blocked} | failed: ${r.failed} | ${elapsed}s`);
    totalProcessed += r.processed || 0;
    totalNewSendReady += r.newSendReady || 0;
    totalFailed += r.failed || 0;
    
    if (!r.processed || r.processed === 0) {
      console.log("  No more eligible projects — stopping early.");
      break;
    }

    // Check mid-run stats every 2 batches
    if (i % 2 === 0) {
      const mid = await getStats(db);
      console.log(`  [Mid-run] send_ready: ${mid.contacts.send_ready} | queued_projects: ${mid.projects.queued}`);
    }
  }

  console.log("\n--- AFTER ---");
  const after = await getStats(db);
  console.log("Contacts:", after.contacts);
  console.log("Projects:", after.projects);

  const sendReadyGain = Number(after.contacts.send_ready) - Number(before.contacts.send_ready);
  const queuedDrop = Number(before.projects.queued) - Number(after.projects.queued);
  const sendReadyProjectsGain = Number(after.projects.send_ready_projects) - Number(before.projects.send_ready_projects);

  console.log(`\n=== SUMMARY ===`);
  console.log(`Projects processed: ${totalProcessed}`);
  console.log(`send_ready contacts: ${before.contacts.send_ready} → ${after.contacts.send_ready} (+${sendReadyGain})`);
  console.log(`queued projects: ${before.projects.queued} → ${after.projects.queued} (-${queuedDrop})`);
  console.log(`send_ready projects: ${before.projects.send_ready_projects} → ${after.projects.send_ready_projects} (+${sendReadyProjectsGain})`);
  console.log(`named_unverified with email: ${before.contacts.unverified_with_email} → ${after.contacts.unverified_with_email}`);
  console.log(`Total failed: ${totalFailed}`);

  await db.end();
})().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
