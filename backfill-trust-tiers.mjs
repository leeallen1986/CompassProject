/**
 * backfill-trust-tiers.mjs
 * One-time script to populate contactTrustTier for all existing contacts.
 *
 * Rules:
 *   send_ready:      emailVerified=1 AND linked to at least one project AND NOT llm source
 *   llm_inferred:    enrichmentSource IN ('llm', 'llm_fallback', 'llm_contact_fallback', 'llm_inference')
 *   named_unverified: everything else
 *
 * Run: node backfill-trust-tiers.mjs
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== Contact Trust Tier Backfill ===\n");

// Step 1: Set llm_inferred for all LLM-sourced contacts (highest priority — overrides everything)
const [llmResult] = await conn.execute(`
  UPDATE contacts
  SET contactTrustTier = 'llm_inferred'
  WHERE enrichmentSource IN ('llm', 'llm_fallback', 'llm_contact_fallback', 'llm_inference')
`);
console.log(`Step 1: Set llm_inferred for LLM contacts: ${llmResult.affectedRows} rows updated`);

// Step 2: Set send_ready for verified, project-linked, non-LLM contacts
const [sendReadyResult] = await conn.execute(`
  UPDATE contacts c
  INNER JOIN contactProjects cp ON cp.contactId = c.id
  SET c.contactTrustTier = 'send_ready'
  WHERE c.emailVerified = 1
    AND c.enrichmentSource NOT IN ('llm', 'llm_fallback', 'llm_contact_fallback', 'llm_inference')
    AND (c.enrichmentSource IS NULL OR c.enrichmentSource NOT IN ('llm', 'llm_fallback', 'llm_contact_fallback', 'llm_inference'))
`);
console.log(`Step 2: Set send_ready for verified project-linked contacts: ${sendReadyResult.affectedRows} rows updated`);

// Step 3: All remaining contacts default to named_unverified (already the schema default, but let's be explicit)
const [namedResult] = await conn.execute(`
  UPDATE contacts
  SET contactTrustTier = 'named_unverified'
  WHERE contactTrustTier IS NULL
     OR (contactTrustTier != 'llm_inferred' AND contactTrustTier != 'send_ready')
`);
console.log(`Step 3: Set named_unverified for remaining contacts: ${namedResult.affectedRows} rows updated`);

// Verification query
const [verification] = await conn.query(`
  SELECT
    contactTrustTier,
    COUNT(*) AS total,
    SUM(CASE WHEN emailVerified = 1 THEN 1 ELSE 0 END) AS email_verified,
    SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) AS has_email
  FROM contacts
  GROUP BY contactTrustTier
  ORDER BY total DESC
`);

console.log("\n=== VERIFICATION: Trust Tier Distribution ===");
console.table(verification);

// Check for any anomalies: LLM contacts that somehow got send_ready
const [anomalies] = await conn.query(`
  SELECT COUNT(*) AS count
  FROM contacts
  WHERE contactTrustTier = 'send_ready'
    AND enrichmentSource IN ('llm', 'llm_fallback', 'llm_contact_fallback', 'llm_inference')
`);
console.log(`\nAnomaly check — LLM contacts with send_ready tier: ${anomalies[0].count} (should be 0)`);

// Check send_ready contacts are all project-linked
const [orphanSendReady] = await conn.query(`
  SELECT COUNT(*) AS count
  FROM contacts c
  LEFT JOIN contactProjects cp ON cp.contactId = c.id
  WHERE c.contactTrustTier = 'send_ready'
    AND cp.contactId IS NULL
`);
console.log(`Anomaly check — send_ready contacts without project link: ${orphanSendReady[0].count} (should be 0)`);

await conn.end();
console.log("\nBackfill complete.");
