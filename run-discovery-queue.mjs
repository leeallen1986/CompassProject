/**
 * run-discovery-queue.mjs
 * Runs the discovery queue in batches via the live server API.
 * Uses the admin session cookie to authenticate.
 */
import { execSync } from "child_process";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const DB_URL = process.env.DATABASE_URL;
const SERVER_URL = "http://localhost:3000";

async function getStats(db) {
  const [[row]] = await db.execute(`
    SELECT
      SUM(contactTrustTier = 'send_ready') as send_ready,
      SUM(contactTrustTier = 'named_unverified') as named_unverified,
      SUM(contactTrustTier = 'named_unverified' AND email IS NOT NULL AND (crmOrphan = 0 OR crmOrphan IS NULL)) as unverified_with_email,
      SUM(contactTrustTier = 'llm_inferred') as llm_inferred
    FROM contacts
    WHERE crmOrphan = 0 OR crmOrphan IS NULL
  `);
  const [[qRow]] = await db.execute(`
    SELECT
      SUM(discoveryStatus = 'discovery_queued') as queued,
      SUM(discoveryStatus = 'send_ready_contact') as send_ready_projects,
      SUM(discoveryStatus = 'named_contact_no_email') as named_no_email_projects,
      SUM(discoveryStatus = 'role_only') as role_only_projects,
      SUM(discoveryStatus = 'discovery_running') as running
    FROM projects
    WHERE lifecycleStatus = 'active' OR lifecycleStatus IS NULL
  `);
  return { contacts: row, projects: qRow };
}

async function runBatch(db, batchNum, priority) {
  console.log(`\n[Batch ${batchNum}] Running discovery queue (priority=${priority || 'all'})...`);
  
  // Import the processDiscoveryQueue function directly
  // We'll call it via a child process using tsx
  const result = await new Promise((resolve, reject) => {
    try {
      const output = execSync(
        `node -e "
const mysql = require('mysql2/promise');
require('dotenv').config();
(async () => {
  // Dynamically import the discovery queue
  const { processDiscoveryQueue } = await import('./server/discoveryQueue.ts');
  const result = await processDiscoveryQueue({ maxBatch: 50${priority ? `, priorityFilter: '${priority}'` : ''} });
  console.log(JSON.stringify(result));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
"`,
        { cwd: "/home/ubuntu/atlas-copco-intelligence", timeout: 300000, encoding: "utf-8" }
      );
      try {
        const jsonStart = output.lastIndexOf("{");
        const jsonEnd = output.lastIndexOf("}");
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          resolve(JSON.parse(output.slice(jsonStart, jsonEnd + 1)));
        } else {
          resolve({ error: "No JSON in output", raw: output.slice(-500) });
        }
      } catch (e) {
        resolve({ error: "Parse error", raw: output.slice(-500) });
      }
    } catch (e) {
      resolve({ error: e.message, raw: e.stdout?.slice(-500) || "" });
    }
  });
  return result;
}

(async () => {
  const db = await mysql.createConnection(DB_URL);
  
  console.log("=== DISCOVERY QUEUE RUN ===");
  console.log("\n--- BEFORE ---");
  const before = await getStats(db);
  console.log("Contacts:", before.contacts);
  console.log("Projects:", before.projects);

  // Run 3 batches of 50 (150 projects total)
  const batchResults = [];
  for (let i = 1; i <= 3; i++) {
    const result = await runBatch(db, i);
    batchResults.push(result);
    console.log(`Batch ${i} result:`, JSON.stringify(result, null, 2));
    
    // Check current stats after each batch
    const mid = await getStats(db);
    console.log(`After batch ${i}: send_ready=${mid.contacts.send_ready}, queued_projects=${mid.projects.queued}`);
    
    // If no projects were processed, stop
    if (!result.processed || result.processed === 0) {
      console.log("No more eligible projects — stopping.");
      break;
    }
  }

  console.log("\n--- AFTER ---");
  const after = await getStats(db);
  console.log("Contacts:", after.contacts);
  console.log("Projects:", after.projects);

  const sendReadyGain = Number(after.contacts.send_ready) - Number(before.contacts.send_ready);
  const queuedDrop = Number(before.projects.queued) - Number(after.projects.queued);
  console.log(`\n=== SUMMARY ===`);
  console.log(`send_ready: ${before.contacts.send_ready} → ${after.contacts.send_ready} (+${sendReadyGain})`);
  console.log(`queued projects: ${before.projects.queued} → ${after.projects.queued} (-${queuedDrop})`);
  console.log(`send_ready projects: ${before.projects.send_ready_projects} → ${after.projects.send_ready_projects}`);

  await db.end();
})().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
