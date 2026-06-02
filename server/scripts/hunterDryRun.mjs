/**
 * Hunter.io Dry Run — verifies emails for 5 sample manual contacts WITHOUT updating the database.
 * Run with: node server/scripts/hunterDryRun.mjs
 */

import { config } from "dotenv";
config();

const HUNTER_BASE_URL = "https://api.hunter.io/v2";
const HUNTER_MIN_CONFIDENCE = 70;
const apiKey = process.env.HUNTER_API_KEY ?? "";

if (!apiKey) {
  console.error("❌ HUNTER_API_KEY is not set in environment");
  process.exit(1);
}

console.log(`✅ HUNTER_API_KEY is set (${apiKey.length} chars)`);

// ── Fetch 5 sample manual contacts with emails from the DB ──
import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(`
  SELECT c.id, c.name, c.email, c.company, c.title, c.contactTrustTier
  FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  JOIN projects p ON p.id = cp.projectId
  WHERE c.enrichmentSource = 'manual'
    AND c.enrichmentStatus = 'pending'
    AND c.email IS NOT NULL AND c.email != ''
    AND c.contactTrustTier != 'send_ready'
    AND p.priority IN ('hot', 'warm')
    AND p.lifecycleStatus = 'active'
    AND c.title NOT IN ('Finance', 'CRM Contact', 'Service Operations', 'Service Purchase',
                        'Invoice via Email', 'Collections Contact', 'IT', 'Administration',
                        'Logistics', 'Development', 'Sales & Marketing', 'HR', 'Legal')
  ORDER BY FIELD(p.priority, 'hot', 'warm') ASC
  LIMIT 5
`);

await conn.end();

if (!rows || rows.length === 0) {
  console.warn("⚠️  No eligible manual contacts found for dry run");
  process.exit(0);
}

console.log(`\n📋 Testing Hunter verification on ${rows.length} sample contacts (DRY RUN — no DB updates):\n`);

// ── Call Hunter email-verifier for each contact ──
for (const contact of rows) {
  const { id, name, email, company, title, contactTrustTier } = contact;
  console.log(`─────────────────────────────────────────`);
  console.log(`Contact #${id}: ${name} <${email}>`);
  console.log(`  Company: ${company} | Title: ${title} | Current tier: ${contactTrustTier}`);

  try {
    const url = new URL(`${HUNTER_BASE_URL}/email-verifier`);
    url.searchParams.set("email", email);
    url.searchParams.set("api_key", apiKey);

    const res = await fetch(url.toString());
    const json = await res.json();

    if (!res.ok || json.errors) {
      console.log(`  ❌ Hunter API error: ${JSON.stringify(json.errors ?? json)}`);
      continue;
    }

    const d = json.data;
    const status = d?.status ?? "unknown";
    const score = d?.score ?? 0;
    const disposable = d?.disposable ?? false;
    const block = d?.block ?? false;

    const wouldPromote =
      (status === "valid" || status === "accept_all") &&
      score >= HUNTER_MIN_CONFIDENCE &&
      !disposable &&
      !block;

    console.log(`  Hunter status: ${status} | Confidence: ${score} | Disposable: ${disposable} | Block: ${block}`);
    console.log(`  → Would promote to send_ready: ${wouldPromote ? "✅ YES" : "❌ NO"} (needs status=valid OR accept_all, score≥${HUNTER_MIN_CONFIDENCE}, not disposable/blocked)`);

  } catch (err) {
    console.log(`  ❌ Request failed: ${err.message}`);
  }

  // Rate-limit friendly delay
  await new Promise(r => setTimeout(r, 400));
}

console.log(`\n─────────────────────────────────────────`);
console.log(`✅ Dry run complete — no database changes were made`);
