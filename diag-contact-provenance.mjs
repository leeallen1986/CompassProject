/**
 * Contact provenance audit for the 5 reps' digest projects.
 * For each project in each rep's scored output, pull all linked contacts
 * with: source, verificationStatus, linkedinUrl, createdAt, email, title.
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
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

// ── 3. Get all projects with their state ──────────────────────────────────
const [allProjects] = await db.execute(
  `SELECT id, name, projectState, location, priority, lifecycleStatus, tenderCloseDate,
          discoveryStatus, stageCode, suppressed, mergedIntoId
   FROM projects
   WHERE lifecycleStatus NOT IN ('archived','completed')
     AND suppressed = 0
     AND mergedIntoId IS NULL
   ORDER BY priority DESC, id ASC
   LIMIT 300`
);

// ── 4. For each project, get all linked contacts ───────────────────────────
const [allContactLinks] = await db.execute(
  `SELECT cp.projectId, cp.relevance AS linkRelevance,
          c.id AS contactId, c.name AS contactName, c.title,
          c.company, c.email,
          COALESCE(c.verifiedLinkedinUrl, c.linkedinProfileUrl, c.linkedin) AS linkedinUrl,
          c.source, c.enrichmentSource, c.verificationStatus, c.verifiedAt,
          c.createdAt, c.contactTrustTier AS trustTier,
          c.emailVerified, c.confidenceScore
   FROM contactProjects cp
   JOIN contacts c ON c.id = cp.contactId
   ORDER BY cp.projectId,
     FIELD(c.contactTrustTier,'send_ready','named_unverified','llm_inferred') ASC,
     c.createdAt DESC`
);

// Build a map: projectId → contacts[]
const contactsByProject = {};
for (const row of allContactLinks) {
  if (!contactsByProject[row.projectId]) contactsByProject[row.projectId] = [];
  contactsByProject[row.projectId].push(row);
}

// ── 5. Simple territory filter ─────────────────────────────────────────────
const AU_STATES = new Set(["WA","QLD","NSW","VIC","SA","TAS","NT","ACT"]);
const STATE_KEYWORDS = {
  WA:  ["western australia","wa","perth","pilbara","kalgoorlie","karratha","port hedland","newman"],
  QLD: ["queensland","qld","brisbane","townsville","mackay","gladstone","moranbah"],
  NSW: ["new south wales","nsw","sydney","newcastle","hunter valley","wollongong","broken hill"],
  VIC: ["victoria","vic","melbourne","geelong","ballarat","bendigo"],
  SA:  ["south australia","sa","adelaide","olympic dam","whyalla"],
  NT:  ["northern territory","nt","darwin","alice springs"],
  TAS: ["tasmania","tas","hobart","launceston"],
  ACT: ["act","canberra"],
};

function projectMatchesTerritories(project, territories) {
  if (!territories || territories.length === 0) return true;
  const terrs = Array.isArray(territories) ? territories : JSON.parse(territories || "[]");
  if (terrs.some(t => t.toUpperCase() === "NATIONAL")) return true;
  const ps = (project.projectState || "").toUpperCase();
  const loc = (project.location || "").toLowerCase();
  return terrs.some(t => {
    const tUp = t.toUpperCase();
    if (ps && AU_STATES.has(ps) && ps !== tUp) return false;
    const kws = STATE_KEYWORDS[tUp] || [t.toLowerCase()];
    return kws.some(kw => {
      if (kw.length <= 3) return new RegExp(`(?:^|[\\s,;/|()\-])${kw}(?:$|[\\s,;/|()\-])`, "i").test(loc);
      return loc.includes(kw);
    });
  });
}

// ── 6. Print per-rep contact provenance ───────────────────────────────────
const PRIORITY_ORDER = { hot: 0, warm: 1, cold: 2 };

for (const user of users) {
  const profile = profileMap[user.id];
  const territories = profile
    ? (Array.isArray(profile.territories) ? profile.territories : JSON.parse(profile.territories || "[]"))
    : [];
  const bls = profile
    ? (Array.isArray(profile.assignedBusinessLines) ? profile.assignedBusinessLines : JSON.parse(profile.assignedBusinessLines || "[]"))
    : [];

  // Filter projects to this rep's territory
  const repProjects = allProjects
    .filter(p => projectMatchesTerritories(p, territories))
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3))
    .slice(0, 10); // top 10 by priority for this rep

  console.log(`\n${"═".repeat(80)}`);
  console.log(`REP: ${user.name.toUpperCase()} | Territory: ${territories.join(", ")} | BLs: ${bls.join(", ")}`);
  console.log(`${"═".repeat(80)}`);
  console.log(`Top ${repProjects.length} in-territory projects:\n`);

  let totalContacts = 0;
  let verifiedContacts = 0;
  let llmGeneratedContacts = 0;
  let linkedinContacts = 0;
  let noContactProjects = 0;

  for (const proj of repProjects) {
    const contacts = contactsByProject[proj.id] || [];
    if (contacts.length === 0) noContactProjects++;
    totalContacts += contacts.length;

    console.log(`  ▸ [${proj.priority?.toUpperCase()}] ${proj.name}`);
    console.log(`    State: ${proj.projectState || "?"} | Close: ${proj.tenderCloseDate ? new Date(proj.tenderCloseDate).toISOString().slice(0,10) : "—"}`);

    if (contacts.length === 0) {
      console.log(`    ⚠ NO CONTACTS LINKED`);
    } else {
      for (const c of contacts) {
        const verified = c.verificationStatus === "verified" || c.verificationStatus === "confirmed";
        const hasLinkedin = !!c.linkedinUrl;
        const created = c.createdAt ? new Date(c.createdAt).toISOString().slice(0,10) : "unknown";
        const verifiedAt = c.verifiedAt ? new Date(c.verifiedAt).toISOString().slice(0,10) : null;
        const source = c.source || c.enrichmentSource || "unknown";
        const trustTier = c.trustTier || "?";

        if (verified) verifiedContacts++;
        if (source === "llm_generated" || source === "ai_generated" || source === "llm") llmGeneratedContacts++;
        if (hasLinkedin) linkedinContacts++;

        const flags = [];
        if (verified) flags.push("✓ verified");
        else flags.push("✗ unverified");
        if (hasLinkedin) flags.push("LI:yes");
        else flags.push("LI:no");
        if (c.email) flags.push(`email:${c.email.includes("@") ? "real" : "pattern"}`);
        else flags.push("email:none");

        console.log(`    Contact: ${c.contactName} | ${c.title || "?"} @ ${c.company || "?"}`);
        console.log(`      Source: ${source} | Trust: ${trustTier} | Created: ${created}${verifiedAt ? ` | Verified: ${verifiedAt}` : ""}`);
        console.log(`      Flags: ${flags.join(" | ")}`);
        if (c.email) console.log(`      Email: ${c.email}`);
        if (c.linkedinUrl) console.log(`      LinkedIn: ${c.linkedinUrl}`);
      }
    }
    console.log();
  }

  console.log(`  SUMMARY for ${user.name}:`);
  console.log(`    Projects in territory: ${repProjects.length} | Projects with no contacts: ${noContactProjects}`);
  console.log(`    Total contacts: ${totalContacts} | Verified: ${verifiedContacts} | LLM-generated: ${llmGeneratedContacts} | Has LinkedIn: ${linkedinContacts}`);
  if (totalContacts > 0) {
    console.log(`    Verification rate: ${Math.round(verifiedContacts/totalContacts*100)}% | LinkedIn rate: ${Math.round(linkedinContacts/totalContacts*100)}%`);
  }
}

// ── 7. Global contact quality summary ─────────────────────────────────────
const [globalStats] = await db.execute(`
  SELECT
    COUNT(*) AS total,
    SUM(verificationStatus IN ('verified','confirmed')) AS verified,
    SUM(linkedinUrl IS NOT NULL AND linkedinUrl != '') AS hasLinkedin,
    SUM(source = 'llm_generated' OR source = 'ai_generated' OR source = 'llm') AS llmGenerated,
    SUM(source = 'apollo') AS fromApollo,
    SUM(source = 'hunter') AS fromHunter,
    SUM(source = 'coresignal') AS fromCoresignal,
    SUM(source = 'crm_import') AS fromCRM,
    SUM(email IS NOT NULL AND email != '') AS hasEmail
  FROM contacts
`);
console.log(`\n${"═".repeat(80)}`);
console.log("GLOBAL CONTACT QUALITY SUMMARY");
console.log(`${"═".repeat(80)}`);
const g = globalStats[0];
console.log(`  Total contacts in DB: ${g.total}`);
console.log(`  Has email: ${g.hasEmail} (${Math.round(g.hasEmail/g.total*100)}%)`);
console.log(`  Verified: ${g.verified} (${Math.round(g.verified/g.total*100)}%)`);
console.log(`  Has LinkedIn: ${g.hasLinkedin} (${Math.round(g.hasLinkedin/g.total*100)}%)`);
console.log(`  Source breakdown:`);
console.log(`    LLM-generated: ${g.llmGenerated}`);
console.log(`    Apollo: ${g.fromApollo}`);
console.log(`    Hunter: ${g.fromHunter}`);
console.log(`    Coresignal: ${g.fromCoresignal}`);
console.log(`    CRM import: ${g.fromCRM}`);

// ── 8. Contacts with suspicious email patterns ─────────────────────────────
const [suspiciousEmails] = await db.execute(`
  SELECT c.name, c.email, c.source, c.verificationStatus, c.createdAt,
         GROUP_CONCAT(p.name SEPARATOR ' | ') AS linkedProjects
  FROM contacts c
  LEFT JOIN contactProjects cp ON cp.contactId = c.id
  LEFT JOIN projects p ON p.id = cp.projectId
  WHERE c.email IS NOT NULL
    AND c.email != ''
    AND (
      c.email REGEXP '^[a-z]+\\.[a-z]+@[a-z]+\\.(com|com\\.au|au)$'
      OR c.verificationStatus IS NULL
      OR c.verificationStatus = 'unverified'
    )
  GROUP BY c.id
  ORDER BY c.createdAt DESC
  LIMIT 20
`);
console.log(`\n${"═".repeat(80)}`);
console.log("CONTACTS WITH UNVERIFIED / PATTERN EMAILS (sample, newest 20)");
console.log(`${"═".repeat(80)}`);
for (const c of suspiciousEmails) {
  const created = c.createdAt ? new Date(c.createdAt).toISOString().slice(0,10) : "?";
  console.log(`  ${c.name} | ${c.email} | source:${c.source || "?"} | status:${c.verificationStatus || "none"} | created:${created}`);
  if (c.linkedProjects) console.log(`    Projects: ${c.linkedProjects}`);
}

await db.end();
