/**
 * Source Quality Audit
 * Queries bounce rate, verified email rate, send-ready conversion by source
 * and classifies contacts into the three trust tiers
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ─── 1. Contacts by enrichment source ────────────────────────────────────────
const [bySource] = await conn.query(`
  SELECT
    COALESCE(enrichmentSource, 'unknown') AS source,
    COUNT(*) AS total,
    SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) AS has_email,
    SUM(CASE WHEN emailVerified = 1 THEN 1 ELSE 0 END) AS email_verified,
    SUM(CASE WHEN verificationStatus = 'bounced' THEN 1 ELSE 0 END) AS email_bounced,
    SUM(CASE WHEN verificationStatus = 'valid' THEN 1 ELSE 0 END) AS email_valid,
    SUM(CASE WHEN verificationStatus = 'risky' THEN 1 ELSE 0 END) AS email_risky,
    SUM(CASE WHEN verificationStatus = 'invalid' THEN 1 ELSE 0 END) AS email_invalid
  FROM contacts
  GROUP BY enrichmentSource
  ORDER BY total DESC
`);

// ─── 2. Project-linked contacts by source ────────────────────────────────────
const [linkedBySource] = await conn.query(`
  SELECT
    COALESCE(c.enrichmentSource, 'unknown') AS source,
    COUNT(DISTINCT c.id) AS total_contacts,
    COUNT(DISTINCT cp.contactId) AS project_linked,
    COUNT(DISTINCT CASE WHEN c.email IS NOT NULL AND c.email != '' THEN cp.contactId END) AS linked_with_email,
    COUNT(DISTINCT CASE WHEN c.emailVerified = 1 THEN cp.contactId END) AS linked_verified
  FROM contacts c
  LEFT JOIN contactProjects cp ON cp.contactId = c.id
  GROUP BY c.enrichmentSource
  ORDER BY total_contacts DESC
`);

// ─── 3. Send-ready contacts by source ────────────────────────────────────────
const [sendReadyBySource] = await conn.query(`
  SELECT
    COALESCE(c.enrichmentSource, 'unknown') AS source,
    COUNT(DISTINCT c.id) AS total,
    COUNT(DISTINCT CASE WHEN c.emailVerified = 1 AND cp.contactId IS NOT NULL THEN c.id END) AS send_ready,
    COUNT(DISTINCT CASE WHEN c.email IS NOT NULL AND c.email != '' AND cp.contactId IS NOT NULL THEN c.id END) AS named_linked
  FROM contacts c
  LEFT JOIN contactProjects cp ON cp.contactId = c.id
  GROUP BY c.enrichmentSource
  ORDER BY total DESC
`);

// ─── 4. Email bounce / delivery stats from emailSendLog ──────────────────────
const [bounceBySource] = await conn.query(`
  SELECT
    COALESCE(c.enrichmentSource, 'unknown') AS source,
    COUNT(esl.id) AS emails_sent,
    SUM(CASE WHEN esl.status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
    SUM(CASE WHEN esl.status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
    SUM(CASE WHEN esl.status = 'opened' THEN 1 ELSE 0 END) AS opened
  FROM emailSendLog esl
  JOIN contacts c ON c.id = esl.contactId
  GROUP BY c.enrichmentSource
  ORDER BY emails_sent DESC
`).catch(() => [[]]); // table may not exist

// ─── 5. LLM-inferred contact classification ──────────────────────────────────
const [llmStats] = await conn.query(`
  SELECT
    COUNT(*) AS total_llm,
    SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) AS has_email,
    SUM(CASE WHEN emailVerified = 1 THEN 1 ELSE 0 END) AS email_verified,
    SUM(CASE WHEN verificationStatus = 'bounced' THEN 1 ELSE 0 END) AS email_bounced
  FROM contacts
  WHERE enrichmentSource IN ('llm', 'llm_fallback', 'llm_contact_fallback', 'llm_inference')
     OR (enrichmentSource IS NULL AND name IS NOT NULL AND email IS NULL)
`);

// ─── 6. Trust tier classification preview ────────────────────────────────────
// Tier 1: send_ready — verified email + project linked
// Tier 2: named_unverified — named person, email missing/weak, or not linked
// Tier 3: llm_inferred — source is llm/llm_fallback, or no email + no apollo source
const [trustTierPreview] = await conn.query(`
  SELECT
    CASE
      WHEN c.emailVerified = 1 AND cp.contactId IS NOT NULL THEN 'send_ready'
      WHEN c.enrichmentSource IN ('llm', 'llm_fallback', 'llm_contact_fallback', 'llm_inference')
        OR (c.enrichmentSource IS NULL AND c.email IS NULL) THEN 'llm_inferred'
      ELSE 'named_unverified'
    END AS trust_tier,
    COUNT(*) AS total,
    SUM(CASE WHEN c.email IS NOT NULL AND c.email != '' THEN 1 ELSE 0 END) AS has_email,
    SUM(CASE WHEN c.emailVerified = 1 THEN 1 ELSE 0 END) AS email_verified,
    SUM(CASE WHEN cp.contactId IS NOT NULL THEN 1 ELSE 0 END) AS project_linked
  FROM contacts c
  LEFT JOIN contactProjects cp ON cp.contactId = c.id
  GROUP BY trust_tier
  ORDER BY total DESC
`);

// ─── 7. LLM contacts currently in rep-facing surfaces ────────────────────────
const [llmInRepFacing] = await conn.query(`
  SELECT
    COALESCE(c.enrichmentSource, 'unknown') AS source,
    COUNT(DISTINCT c.id) AS contacts_in_digest_pool,
    COUNT(DISTINCT cp.projectId) AS projects_affected
  FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  JOIN projects p ON p.id = cp.projectId
  WHERE p.discoveryStatus = 'send_ready_contact'
    AND (
      c.enrichmentSource IN ('llm', 'llm_fallback', 'llm_contact_fallback', 'llm_inference')
      OR (c.enrichmentSource IS NULL AND c.email IS NULL)
    )
  GROUP BY c.enrichmentSource
`);

// ─── 8. What sources are currently driving send_ready_contact status ──────────
const [sendReadyDrivers] = await conn.query(`
  SELECT
    COALESCE(c.enrichmentSource, 'unknown') AS source,
    COUNT(DISTINCT p.id) AS projects_with_send_ready_status,
    COUNT(DISTINCT c.id) AS contacts
  FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  JOIN projects p ON p.id = cp.projectId
  WHERE p.discoveryStatus = 'send_ready_contact'
  GROUP BY c.enrichmentSource
  ORDER BY projects_with_send_ready_status DESC
`);

// ─── Print results ────────────────────────────────────────────────────────────
console.log("\n=== CONTACTS BY ENRICHMENT SOURCE ===");
console.table(bySource);

console.log("\n=== PROJECT-LINKED CONTACTS BY SOURCE ===");
console.table(linkedBySource);

console.log("\n=== SEND-READY CONTACTS BY SOURCE ===");
console.table(sendReadyBySource);

console.log("\n=== EMAIL BOUNCE / DELIVERY BY SOURCE ===");
if (bounceBySource.length > 0) {
  console.table(bounceBySource);
} else {
  console.log("No emailSendLog data available");
}

console.log("\n=== LLM-INFERRED CONTACT STATS ===");
console.table(llmStats);

console.log("\n=== TRUST TIER CLASSIFICATION PREVIEW ===");
console.table(trustTierPreview);

console.log("\n=== LLM CONTACTS CURRENTLY IN REP-FACING SURFACES ===");
if (llmInRepFacing.length > 0) {
  console.table(llmInRepFacing);
} else {
  console.log("No LLM contacts currently driving send_ready_contact status");
}

console.log("\n=== SOURCES DRIVING send_ready_contact STATUS ===");
console.table(sendReadyDrivers);

await conn.end();
