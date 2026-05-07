/**
 * run-queue-via-api.mjs
 * Creates an admin JWT session cookie and calls the discovery.process tRPC endpoint
 * in multiple batches, reporting before/after stats.
 */
import mysql from "mysql2/promise";
import { SignJWT } from "jose";
import dotenv from "dotenv";

dotenv.config();

const DB_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const VITE_APP_ID = process.env.VITE_APP_ID;
const SERVER_URL = "http://localhost:3000";
const ADMIN_OPEN_ID = "KXUsvt9ymLcAyajyGLJPZk"; // Lee (admin)
const COOKIE_NAME = "app_session_id";

async function createAdminJwt() {
  const secretKey = new TextEncoder().encode(JWT_SECRET);
  const token = await new SignJWT({
    openId: ADMIN_OPEN_ID,
    appId: VITE_APP_ID || "atlas-copco-intelligence",
    name: "Lee",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(secretKey);
  return token;
}

async function callTrpc(endpoint, body, cookie) {
  const res = await fetch(`${SERVER_URL}/api/trpc/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${COOKIE_NAME}=${cookie}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 500) };
  }
}

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

(async () => {
  const db = await mysql.createConnection(DB_URL);
  const cookie = await createAdminJwt();

  console.log("=== DISCOVERY QUEUE RUN ===");
  console.log("\n--- BEFORE ---");
  const before = await getStats(db);
  console.log("Contacts:", before.contacts);
  console.log("Projects:", before.projects);

  const totalBatches = 13; // 13 × 50 = 650 projects (covers all 611 queued)
  let totalProcessed = 0;
  let totalNewSendReady = 0;
  let totalFailed = 0;

  for (let i = 1; i <= totalBatches; i++) {
    console.log(`\n[Batch ${i}/${totalBatches}] Calling discovery.process...`);
    const startTime = Date.now();
    
    const resp = await callTrpc("discoveryQueue.process", { "0": { json: { maxBatch: 50 } } }, cookie);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (resp?.result?.data?.json) {
      const r = resp.result.data.json;
      console.log(`  Processed: ${r.processed} | send_ready: +${r.newSendReady} | named_no_email: +${r.newNamedNoEmail} | failed: ${r.failed} | ${elapsed}s`);
      totalProcessed += r.processed || 0;
      totalNewSendReady += r.newSendReady || 0;
      totalFailed += r.failed || 0;
      if (!r.processed || r.processed === 0) {
        console.log("  No more eligible projects — stopping early.");
        break;
      }
    } else if (resp?.error) {
      console.log(`  Error: ${JSON.stringify(resp.error).slice(0, 200)}`);
      break;
    } else {
      console.log(`  Unexpected response: ${JSON.stringify(resp).slice(0, 300)}`);
      break;
    }

    // Check mid-run stats every 3 batches
    if (i % 3 === 0) {
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
