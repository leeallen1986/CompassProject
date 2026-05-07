/**
 * Contact provenance audit v2 — correct column names from DESCRIBE output.
 * contacts: source, enrichmentSource, verificationStatus, verifiedAt, createdAt,
 *           contactTrustTier, emailVerified, confidenceScore,
 *           COALESCE(verifiedLinkedinUrl, linkedinProfileUrl, linkedin) AS linkedinUrl
 * contactProjects: projectId, contactId, relevance, createdAt
 * projects: id, name, projectState, location, priority, lifecycleStatus,
 *           tenderCloseDate, discoveryStatus, stageCode, suppressed, mergedIntoId
 */
import mysql from "mysql2/promise";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// ── 1. Get the 5 rep user IDs ──────────────────────────────────────────────
const [users] = await db.execute(
  `SELECT id, name, email FROM users WHERE name IN (
    'Ryan Pemberton','Daniel Zec','Dan Day','Leo Williams','Amit Bhargava'
  ) ORDER BY name`
);
console.log("\n=== REPS FOUND ===");
for (const u of users) console.log(`  ${u.id}: ${u.name} (${u.email})`);

// ── 2. Get user profiles ───────────────────────────────────────────────────
const userIds = users.map(u => u.id);
const placeholders = userIds.map(() => "?").join(",");
const [profiles] = await db.execute(
  `SELECT userId, territories, assignedBusinessLines FROM userProfiles WHERE userId IN (${placeholders})`,
  userIds
);
const profileMap = Object.fromEntries(profiles.map(p => [p.userId, p]));

// ── 3. Get all active projects ────────────────────────────────────────────
const [allProjects] = await db.execute(
  `SELECT id, name, projectState, location, priority, lifecycleStatus,
          tenderCloseDate, discoveryStatus, stageCode
   FROM projects
   WHERE lifecycleStatus NOT IN ('archived','completed')
     AND suppressed = 0
     AND mergedIntoId IS NULL
   ORDER BY priority DESC, id ASC
   LIMIT 300`
);

// ── 4. Get all linked contacts (correct column names) ─────────────────────
const [allContactLinks] = await db.execute(
  `SELECT
     cp.projectId,
     cp.relevance AS linkRelevance,
     cp.createdAt AS linkCreatedAt,
     c.id AS contactId,
     c.name AS contactName,
     c.title,
     c.company,
     c.email,
     COALESCE(c.verifiedLinkedinUrl, c.linkedinProfileUrl, c.linkedin) AS linkedinUrl,
     c.source,
     c.enrichmentSource,
     c.verificationStatus,
     c.verifiedAt,
     c.createdAt,
     c.contactTrustTier AS trustTier,
     c.emailVerified,
     c.confidenceScore,
     c.roleBucket
   FROM contactProjects cp
   JOIN contacts c ON c.id = cp.contactId
   ORDER BY cp.projectId,
     FIELD(c.contactTrustTier, 'send_ready', 'named_unverified', 'llm_inferred') ASC,
     c.createdAt DESC`
);

// Build a map: projectId → contacts[]
const contactsByProject = {};
for (const row of allContactLinks) {
  if (!contactsByProject[row.projectId]) contactsByProject[row.projectId] = [];
  contactsByProject[row.projectId].push(row);
}

// ── 5. Territory filter ────────────────────────────────────────────────────
const AU_STATES = new Set(["WA","QLD","NSW","VIC","SA","TAS","NT","ACT"]);
const STATE_KEYWORDS = {
  WA:  ["western australia","perth","pilbara","kalgoorlie","karratha","port hedland","newman","broome","esperance","geraldton"],
  QLD: ["queensland","brisbane","townsville","mackay","gladstone","moranbah","cairns","rockhampton"],
  NSW: ["new south wales","sydney","newcastle","hunter valley","wollongong","broken hill","coffs harbour"],
  VIC: ["victoria","melbourne","geelong","ballarat","bendigo","latrobe"],
  SA:  ["south australia","adelaide","olympic dam","whyalla","port augusta"],
  NT:  ["northern territory","darwin","alice springs","katherine"],
  TAS: ["tasmania","hobart","launceston","devonport"],
  ACT: ["canberra"],
};

function projectMatchesTerritories(project, territories) {
  if (!territories || territories.length === 0) return true;
  const terrs = Array.isArray(territories) ? territories : JSON.parse(territories || "[]");
  if (terrs.some(t => t.toUpperCase() === "NATIONAL")) return true;
  const ps = (project.projectState || "").toUpperCase().trim();
  const loc = (project.location || "").toLowerCase();
  return terrs.some(t => {
    const tUp = t.toUpperCase().trim();
    // If projectState is a known AU state code, use it directly
    if (ps && AU_STATES.has(ps)) return ps === tUp;
    // Otherwise fall back to keyword matching on location string
    const kws = STATE_KEYWORDS[tUp] || [t.toLowerCase()];
    return kws.some(kw => loc.includes(kw));
  });
}

// ── 6. Per-rep contact provenance report ──────────────────────────────────
const PRIORITY_ORDER = { hot: 0, warm: 1, cold: 2 };

const reportLines = [];
const log = (...args) => {
  const line = args.join(" ");
  console.log(line);
  reportLines.push(line);
};

for (const user of users) {
  const profile = profileMap[user.id];
  const territories = profile
    ? (Array.isArray(profile.territories) ? profile.territories : JSON.parse(profile.territories || "[]"))
    : [];
  const bls = profile
    ? (Array.isArray(profile.assignedBusinessLines) ? profile.assignedBusinessLines : JSON.parse(profile.assignedBusinessLines || "[]"))
    : [];

  const repProjects = allProjects
    .filter(p => projectMatchesTerritories(p, territories))
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3))
    .slice(0, 10);

  log(`\n${"═".repeat(80)}`);
  log(`REP: ${user.name.toUpperCase()}`);
  log(`Territory: ${territories.join(", ")} | BLs: ${bls.join(", ")}`);
  log(`${"═".repeat(80)}`);

  let totalContacts = 0;
  let verifiedContacts = 0;
  let apolloContacts = 0;
  let crmContacts = 0;
  let llmContacts = 0;
  let linkedinContacts = 0;
  let noContactProjects = 0;

  for (const proj of repProjects) {
    const contacts = contactsByProject[proj.id] || [];
    if (contacts.length === 0) noContactProjects++;
    totalContacts += contacts.length;

    log(`\n  ▸ [${(proj.priority || "?").toUpperCase()}] ${proj.name}`);
    log(`    State: ${proj.projectState || "?"} | Stage: ${proj.stageCode || "?"} | Discovery: ${proj.discoveryStatus || "?"}`);
    if (proj.tenderCloseDate) {
      log(`    Tender Close: ${new Date(proj.tenderCloseDate).toISOString().slice(0,10)}`);
    }

    if (contacts.length === 0) {
      log(`    ⚠ NO CONTACTS LINKED`);
    } else {
      log(`    ${contacts.length} contact(s):`);
      for (const c of contacts) {
        const isVerified = c.verificationStatus === "verified";
        const isAiSuggested = c.verificationStatus === "ai_suggested";
        const hasLinkedin = !!(c.linkedinUrl);
        const created = c.createdAt ? new Date(c.createdAt).toISOString().slice(0,10) : "?";
        const verifiedAt = c.verifiedAt ? new Date(c.verifiedAt).toISOString().slice(0,10) : null;
        const linkCreated = c.linkCreatedAt ? new Date(c.linkCreatedAt).toISOString().slice(0,10) : null;

        // Determine source label
        const srcRaw = c.source || "?";
        const enrichSrc = c.enrichmentSource || null;
        let sourceLabel = srcRaw;
        if (enrichSrc && enrichSrc !== srcRaw) sourceLabel = `${srcRaw}/${enrichSrc}`;

        // Determine trust tier label
        const trustLabel = c.trustTier || "?";

        if (isVerified) verifiedContacts++;
        if (srcRaw === "apollo" || enrichSrc === "apollo") apolloContacts++;
        if (srcRaw === "crm") crmContacts++;
        if (enrichSrc === "llm" || enrichSrc === "web_search") llmContacts++;
        if (hasLinkedin) linkedinContacts++;

        // Status indicator
        let statusIcon = "✗";
        if (trustLabel === "send_ready") statusIcon = "✓";
        else if (isAiSuggested) statusIcon = "~";

        log(`    ${statusIcon} ${c.contactName}`);
        log(`      Title: ${c.title || "?"} | Company: ${c.company || "?"} | Role: ${c.roleBucket || "?"}`);
        log(`      Source: ${sourceLabel} | Trust: ${trustLabel} | Confidence: ${c.confidenceScore || "?"}`);
        log(`      Created: ${created}${verifiedAt ? ` | Verified: ${verifiedAt}` : ""}`);
        log(`      Verification: ${c.verificationStatus || "none"} | Email verified: ${c.emailVerified ? "yes" : "no"}`);
        if (c.email) log(`      Email: ${c.email}`);
        else log(`      Email: —`);
        if (hasLinkedin) log(`      LinkedIn: ${c.linkedinUrl}`);
        else log(`      LinkedIn: —`);
      }
    }
  }

  log(`\n  ── SUMMARY for ${user.name} ──`);
  log(`  In-territory projects shown: ${repProjects.length} | No contacts: ${noContactProjects}`);
  log(`  Total contacts: ${totalContacts}`);
  log(`  Verified (send_ready): ${verifiedContacts} | Apollo-sourced: ${apolloContacts} | CRM: ${crmContacts} | LLM-enriched: ${llmContacts}`);
  log(`  Has LinkedIn: ${linkedinContacts}`);
  if (totalContacts > 0) {
    log(`  Verification rate: ${Math.round(verifiedContacts/totalContacts*100)}% | LinkedIn rate: ${Math.round(linkedinContacts/totalContacts*100)}%`);
  }
}

// ── 7. Global contact quality summary ─────────────────────────────────────
const [gs] = await db.execute(`
  SELECT
    COUNT(*) AS total,
    SUM(verificationStatus = 'verified') AS verified,
    SUM(verificationStatus = 'ai_suggested') AS aiSuggested,
    SUM(verificationStatus = 'unverified' OR verificationStatus IS NULL) AS unverified,
    SUM(COALESCE(verifiedLinkedinUrl, linkedinProfileUrl, linkedin) IS NOT NULL) AS hasLinkedin,
    SUM(source = 'apollo') AS fromApollo,
    SUM(source = 'crm') AS fromCRM,
    SUM(source = 'manual') AS fromManual,
    SUM(source = 'scraper') AS fromScraper,
    SUM(enrichmentSource = 'llm') AS llmEnriched,
    SUM(enrichmentSource = 'apollo') AS apolloEnriched,
    SUM(email IS NOT NULL AND email != '') AS hasEmail,
    SUM(emailVerified = 1) AS emailVerified,
    SUM(contactTrustTier = 'send_ready') AS sendReady,
    SUM(contactTrustTier = 'named_unverified') AS namedUnverified,
    SUM(contactTrustTier = 'llm_inferred') AS llmInferred
  FROM contacts
`);
const g = gs[0];

log(`\n${"═".repeat(80)}`);
log(`GLOBAL CONTACT QUALITY SUMMARY (all contacts in DB)`);
log(`${"═".repeat(80)}`);
log(`Total contacts: ${g.total}`);
log(`Trust tier breakdown:`);
log(`  send_ready: ${g.sendReady} (${Math.round(g.sendReady/g.total*100)}%)`);
log(`  named_unverified: ${g.namedUnverified} (${Math.round(g.namedUnverified/g.total*100)}%)`);
log(`  llm_inferred: ${g.llmInferred} (${Math.round(g.llmInferred/g.total*100)}%)`);
log(`  tier unknown: ${g.total - g.sendReady - g.namedUnverified - g.llmInferred}`);
log(`Verification status:`);
log(`  verified: ${g.verified} | ai_suggested: ${g.aiSuggested} | unverified/null: ${g.unverified}`);
log(`Email coverage:`);
log(`  Has email: ${g.hasEmail} (${Math.round(g.hasEmail/g.total*100)}%) | Email verified: ${g.emailVerified}`);
log(`LinkedIn coverage:`);
log(`  Has LinkedIn: ${g.hasLinkedin} (${Math.round(g.hasLinkedin/g.total*100)}%)`);
log(`Source breakdown:`);
log(`  Apollo: ${g.fromApollo} | CRM: ${g.fromCRM} | Manual: ${g.fromManual} | Scraper: ${g.fromScraper}`);
log(`Enrichment breakdown:`);
log(`  LLM-enriched: ${g.llmEnriched} | Apollo-enriched: ${g.apolloEnriched}`);

// ── 8. Per-project contact summary for digest projects ────────────────────
log(`\n${"═".repeat(80)}`);
log(`PROJECTS WITH CONTACTS — DIGEST-ELIGIBLE (discoveryStatus = send_ready_contact)`);
log(`${"═".repeat(80)}`);

const [digestProjects] = await db.execute(`
  SELECT p.id, p.name, p.projectState, p.priority, p.discoveryStatus,
         COUNT(cp.contactId) AS contactCount,
         SUM(c.contactTrustTier = 'send_ready') AS sendReadyCount,
         SUM(c.contactTrustTier = 'named_unverified') AS namedUnverifiedCount,
         SUM(c.source = 'apollo') AS apolloCount,
         SUM(c.source = 'crm') AS crmCount
  FROM projects p
  JOIN contactProjects cp ON cp.projectId = p.id
  JOIN contacts c ON c.id = cp.contactId
  WHERE p.discoveryStatus = 'send_ready_contact'
    AND p.suppressed = 0
    AND p.mergedIntoId IS NULL
  GROUP BY p.id
  ORDER BY p.priority DESC, sendReadyCount DESC
`);

for (const dp of digestProjects) {
  log(`  [${(dp.priority||"?").toUpperCase()}] ${dp.name} (${dp.projectState || "?"})`);
  log(`    Total: ${dp.contactCount} | send_ready: ${dp.sendReadyCount} | named_unverified: ${dp.namedUnverifiedCount} | Apollo: ${dp.apolloCount} | CRM: ${dp.crmCount}`);
}

await db.end();

// ── 9. Write report to file ────────────────────────────────────────────────
import { writeFileSync } from "fs";
writeFileSync("/home/ubuntu/contact-provenance-report.txt", reportLines.join("\n"), "utf8");
console.log("\n✓ Report written to /home/ubuntu/contact-provenance-report.txt");
