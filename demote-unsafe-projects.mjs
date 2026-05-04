/**
 * demote-unsafe-projects.mjs
 * One-time script to demote the 13 projects that were incorrectly promoted to
 * send_ready_contact status based on LLM or unverified web_search contacts.
 *
 * These projects have no verified email contacts and should not appear in the
 * rep-facing digest or Top Actions dashboard.
 *
 * Demotion rule:
 *   - If a project's ONLY contacts are llm_inferred or named_unverified (no send_ready contacts),
 *     set discoveryStatus = 'contact_found' (has a named contact, but not outreach-ready)
 *
 * Run: node demote-unsafe-projects.mjs
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("=== Demote Unsafe send_ready_contact Projects ===\n");

// Find projects that are send_ready_contact but have NO send_ready contacts
const [todemote] = await conn.query(`
  SELECT
    p.id,
    p.name,
    p.priority,
    p.discoveryStatus,
    COUNT(DISTINCT cp.contactId) AS total_contacts,
    SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) AS send_ready_contacts,
    SUM(CASE WHEN c.contactTrustTier = 'llm_inferred' THEN 1 ELSE 0 END) AS llm_contacts,
    SUM(CASE WHEN c.contactTrustTier = 'named_unverified' THEN 1 ELSE 0 END) AS named_unverified_contacts
  FROM projects p
  JOIN contactProjects cp ON cp.projectId = p.id
  JOIN contacts c ON c.id = cp.contactId
  WHERE p.discoveryStatus = 'send_ready_contact'
    AND p.priority IN ('hot', 'warm')
  GROUP BY p.id, p.name, p.priority, p.discoveryStatus
  HAVING send_ready_contacts = 0
  ORDER BY p.priority, p.name
`);

console.log(`Projects to demote: ${todemote.length}`);
console.table(todemote.map(p => ({
  id: p.id,
  name: p.name.substring(0, 50),
  priority: p.priority,
  total_contacts: p.total_contacts,
  send_ready: p.send_ready_contacts,
  llm: p.llm_contacts,
  named_unverified: p.named_unverified_contacts,
})));

if (todemote.length === 0) {
  console.log("No projects to demote.");
  await conn.end();
  process.exit(0);
}

// Demote them: set discoveryStatus = 'contact_found'
const projectIds = todemote.map(p => p.id);
const placeholders = projectIds.map(() => '?').join(',');

const [demoteResult] = await conn.execute(
  `UPDATE projects SET discoveryStatus = 'named_contact_no_email' WHERE id IN (${placeholders})`,
  projectIds
);

console.log(`\nDemoted ${demoteResult.affectedRows} projects from send_ready_contact → named_contact_no_email`);

// Verification: confirm they are now contact_found
const [verification] = await conn.query(
  `SELECT id, name, priority, discoveryStatus FROM projects WHERE id IN (${placeholders})`,
  projectIds
);
console.log("\n=== VERIFICATION: Demoted Projects ===");
console.table(verification.map(p => ({
  id: p.id,
  name: p.name.substring(0, 50),
  priority: p.priority,
  discoveryStatus: p.discoveryStatus,
})));

// Final summary: how many send_ready_contact projects remain?
const [remaining] = await conn.query(`
  SELECT
    p.priority,
    COUNT(*) AS projects,
    SUM(CASE WHEN c.contactTrustTier = 'send_ready' THEN 1 ELSE 0 END) AS verified_contacts
  FROM projects p
  JOIN contactProjects cp ON cp.projectId = p.id
  JOIN contacts c ON c.id = cp.contactId
  WHERE p.discoveryStatus = 'send_ready_contact'
    AND p.priority IN ('hot', 'warm')
  GROUP BY p.priority
`);

console.log("\n=== REMAINING send_ready_contact PROJECTS (all should be safe) ===");
console.table(remaining);

await conn.end();
console.log("\nDemotion complete.");
