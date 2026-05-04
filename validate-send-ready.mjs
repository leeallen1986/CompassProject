/**
 * Validation query for the 11 projects that moved to send_ready_contact
 * Returns: project name, contact name, source, email present, email verified,
 *          project linked, confidence score, qualification reason, safe-to-show
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ─── 1. Get all projects currently in send_ready_contact with their best contact ─
const [sendReadyProjects] = await conn.query(`
  SELECT
    p.id AS project_id,
    p.name AS project_name,
    p.priority,
    p.projectState AS region,
    p.discoveryStatus,
    p.updatedAt AS status_updated,
    c.id AS contact_id,
    c.name AS contact_name,
    c.title AS contact_title,
    c.company AS contact_company,
    COALESCE(c.enrichmentSource, 'unknown') AS source,
    CASE WHEN c.email IS NOT NULL AND c.email != '' THEN 'yes' ELSE 'no' END AS email_present,
    CASE WHEN c.emailVerified = 1 THEN 'yes' ELSE 'no' END AS email_verified,
    CASE WHEN c.verificationStatus = 'bounced' THEN 'yes' ELSE 'no' END AS email_bounced,
    c.verificationStatus AS emailStatus,
    CASE WHEN cp.contactId IS NOT NULL THEN 'yes' ELSE 'no' END AS linked_to_project,
    c.confidenceScore,
    c.roleRelevance,
    c.source AS apolloPersonId,
    c.linkedinProfileUrl AS linkedinUrl,
    c.createdAt AS contact_created
  FROM projects p
  JOIN contactProjects cp ON cp.projectId = p.id
  JOIN contacts c ON c.id = cp.contactId
  WHERE p.discoveryStatus = 'send_ready_contact'
    AND p.priority IN ('hot', 'warm')
  ORDER BY p.priority, p.name, c.emailVerified DESC, c.confidenceScore DESC
`);

// ─── 2. Group by project, pick best contact per project ──────────────────────
const projectMap = new Map();
for (const row of sendReadyProjects) {
  if (!projectMap.has(row.project_id)) {
    projectMap.set(row.project_id, row);
  }
}
const bestContacts = Array.from(projectMap.values());

// ─── 3. Classify each contact's trust tier and safe-to-show status ───────────
const LLM_SOURCES = ['llm', 'llm_fallback', 'llm_contact_fallback', 'llm_inference', 'llm_generated'];

function classifyTrustTier(row) {
  const isLLM = LLM_SOURCES.includes(row.source) || row.source === 'unknown';
  const hasVerifiedEmail = row.email_verified === 'yes';
  const hasEmail = row.email_present === 'yes';
  const isLinked = row.linked_to_project === 'yes';
  const isApollo = row.source === 'apollo' || row.apolloPersonId;
  const isBounced = row.email_bounced === 'yes';

  if (isBounced) return 'BOUNCED — remove';
  if (isLLM && !hasVerifiedEmail) return 'llm_inferred — NOT safe';
  if (hasVerifiedEmail && isLinked) return 'send_ready — SAFE';
  if (isApollo && hasEmail && isLinked) return 'named_linked — review';
  if (hasEmail && isLinked) return 'named_linked — review';
  return 'named_unverified — NOT safe';
}

function safeToShow(row) {
  const isLLM = LLM_SOURCES.includes(row.source) || row.source === 'unknown';
  const hasVerifiedEmail = row.email_verified === 'yes';
  const isBounced = row.email_bounced === 'yes';
  if (isBounced) return 'NO — bounced';
  if (isLLM && !hasVerifiedEmail) return 'NO — LLM unverified';
  if (hasVerifiedEmail) return 'YES — verified';
  if (row.source === 'apollo') return 'REVIEW — Apollo unverified';
  return 'NO — unverified';
}

function qualificationReason(row) {
  const isLLM = LLM_SOURCES.includes(row.source) || row.source === 'unknown';
  if (isLLM) return `LLM-inferred (${row.source}) — no independent verification`;
  if (row.email_verified === 'yes') return `Email verified by ${row.source}`;
  if (row.source === 'apollo') return `Apollo reveal — email present but not verified`;
  if (row.source === 'web_search') return `Web search — email present but not verified`;
  return `Source: ${row.source} — email status: ${row.emailStatus || 'unknown'}`;
}

// ─── 4. Print validation table ────────────────────────────────────────────────
console.log("\n=== VALIDATION TABLE: SEND_READY_CONTACT PROJECTS ===\n");
console.log(`Total projects with send_ready_contact status (hot/warm): ${bestContacts.length}`);
console.log(`\nNote: Showing best contact per project (highest email_verified, then confidenceScore)\n`);

const tableData = bestContacts.map(row => ({
  project: row.project_name?.substring(0, 45),
  priority: row.priority,
  contact: row.contact_name?.substring(0, 30) || '(no name)',
  source: row.source,
  email: row.email_present,
  verified: row.email_verified,
  bounced: row.email_bounced,
  linked: row.linked_to_project,
  confidence: row.confidenceScore || 'n/a',
  trust_tier: classifyTrustTier(row),
  safe_to_show: safeToShow(row),
  reason: qualificationReason(row),
}));

console.table(tableData);

// ─── 5. Summary stats ────────────────────────────────────────────────────────
const totalSendReady = bestContacts.length;
const verifiedEmail = bestContacts.filter(r => r.email_verified === 'yes').length;
const apolloBacked = bestContacts.filter(r => r.source === 'apollo' || r.apolloPersonId).length;
const llmBacked = bestContacts.filter(r => LLM_SOURCES.includes(r.source) || r.source === 'unknown').length;
const safeCount = bestContacts.filter(r => safeToShow(r).startsWith('YES')).length;
const reviewCount = bestContacts.filter(r => safeToShow(r).startsWith('REVIEW')).length;
const unsafeCount = bestContacts.filter(r => safeToShow(r).startsWith('NO')).length;

console.log("\n=== SUMMARY ===");
console.log(`Total send_ready_contact projects (hot/warm): ${totalSendReady}`);
console.log(`  Backed by verified email:     ${verifiedEmail} (${Math.round(verifiedEmail/totalSendReady*100)}%)`);
console.log(`  Backed by Apollo:             ${apolloBacked} (${Math.round(apolloBacked/totalSendReady*100)}%)`);
console.log(`  LLM-originated:               ${llmBacked} (${Math.round(llmBacked/totalSendReady*100)}%)`);
console.log(`  Safe to show in digest:       ${safeCount}`);
console.log(`  Needs review before showing:  ${reviewCount}`);
console.log(`  NOT safe (LLM/unverified):    ${unsafeCount}`);

// ─── 6. Projects that should be DEMOTED from send_ready_contact ──────────────
const todemote = bestContacts.filter(r => safeToShow(r).startsWith('NO'));
if (todemote.length > 0) {
  console.log("\n=== PROJECTS TO DEMOTE FROM send_ready_contact ===");
  console.table(todemote.map(r => ({
    project: r.project_name?.substring(0, 50),
    contact: r.contact_name?.substring(0, 30),
    source: r.source,
    reason: safeToShow(r),
  })));
}

// ─── 7. Check if any LLM contacts were independently verified ────────────────
const [llmVerified] = await conn.query(`
  SELECT
    c.id, c.name, c.enrichmentSource, c.emailVerified, c.apolloPersonId, c.emailStatus
  FROM contacts c
  JOIN contactProjects cp ON cp.contactId = c.id
  JOIN projects p ON p.id = cp.projectId
  WHERE p.discoveryStatus = 'send_ready_contact'
    AND c.enrichmentSource IN ('llm', 'llm_fallback', 'llm_contact_fallback', 'llm_inference')
    AND (c.emailVerified = 1 OR c.source = 'apollo')
`);
console.log(`\n=== LLM CONTACTS WITH INDEPENDENT VERIFICATION ===`);
if (llmVerified.length > 0) {
  console.table(llmVerified);
} else {
  console.log("None — no LLM contacts have been independently verified via Apollo or email verification");
}

await conn.end();
