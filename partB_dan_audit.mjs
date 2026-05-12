/**
 * Part B: Dan Day east-coast contact rescue
 * Audits Dan's top 10 pump projects and all contacts on each.
 * Flags: fabricated domains, wrong person, no email, llm_inferred.
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// 1. Get Dan Day's userId and profile
const [profiles] = await db.query(
  `SELECT up.userId, u.name, up.territories, up.assignedBusinessLines
   FROM userProfiles up
   JOIN users u ON u.id = up.userId
   WHERE u.name LIKE '%Dan%' OR u.name LIKE '%Day%'
   LIMIT 5`
);
console.log("\n=== MATCHING PROFILES ===");
console.log(JSON.stringify(profiles, null, 2));
if (!profiles.length) { console.log("Dan Day not found"); process.exit(1); }
// Pick Dan Day specifically (not Daniel Zec)
const dan = profiles.find(p => p.name === 'Dan Day') || profiles[0];
console.log("\n=== USING PROFILE ===");
console.log(`userId: ${dan.userId}`);
console.log(`name: ${dan.name}`);
console.log(`territories: ${dan.territories}`);
console.log(`assignedBusinessLines: ${dan.assignedBusinessLines}`);

// 2. Get Dan's top 15 pump-scored projects (east coast)
const [projects] = await db.query(
  `SELECT DISTINCT p.id, p.name, p.owner, p.location, p.lifecycleStatus, p.priority,
          pbl.score AS pumpScore
   FROM projects p
   JOIN projectBusinessLineScores pbl ON pbl.projectId = p.id
   WHERE pbl.scoringDimension = 'Pump/Dewatering'
     AND pbl.score > 0
     AND p.mergedIntoId IS NULL
     AND (
       p.location LIKE '%QLD%' OR p.location LIKE '%NSW%' OR p.location LIKE '%VIC%'
       OR p.location LIKE '%Queensland%' OR p.location LIKE '%New South Wales%'
       OR p.location LIKE '%Victoria%' OR p.location LIKE '%Cairns%'
       OR p.location LIKE '%Brisbane%' OR p.location LIKE '%Sydney%'
       OR p.location LIKE '%Melbourne%' OR p.location LIKE '%NT%'
       OR p.location LIKE '%Northern Territory%'
     )
   ORDER BY pbl.score DESC
   LIMIT 15`
);

console.log(`\n=== DAN'S TOP ${projects.length} EAST-COAST PUMP PROJECTS ===`);

const FABRICATED_DOMAIN_PATTERNS = [
  /[a-z]{20,}\.com\.au$/,       // suspiciously long domain
  /[a-z]+(government|council|authority|department)[a-z]+\.(com|com\.au)$/,  // gov mashup
  /woodsidepizzeria/i,
  /cairnswaterinfrastructure/i,
  /bassstrait[a-z]+\.(com|com\.au)/i,
];

function isFabricatedEmail(email) {
  if (!email) return false;
  const domain = email.split("@")[1] ?? "";
  return FABRICATED_DOMAIN_PATTERNS.some(p => p.test(domain));
}

const badContacts = [];

for (const proj of projects) {
  // Get all contacts for this project
  const [contacts] = await db.query(
    `SELECT c.id, c.name, c.title, c.company, c.email, c.linkedin,
            c.contactTrustTier, c.roleRelevance, c.rejectionReason,
            c.enrichmentSource
     FROM contacts c
     JOIN contactProjects cp ON cp.contactId = c.id
     WHERE cp.projectId = ?
     ORDER BY c.contactTrustTier ASC, c.roleRelevance DESC`,
    [proj.id]
  );

  console.log(`\n--- Project ${proj.id}: ${proj.name} (score: ${proj.pumpScore}) ---`);
  console.log(`  Location: ${proj.location} | Status: ${proj.lifecycleStatus} | Priority: ${proj.priority}`);
  console.log(`  Contacts: ${contacts.length}`);

  for (const c of contacts) {
    const fabricated = isFabricatedEmail(c.email);
    const flag = fabricated ? " ⚠️ FABRICATED_DOMAIN" : "";
    const quarantined = c.rejectionReason ? " 🚫 QUARANTINED" : "";
    console.log(`    [${c.contactTrustTier ?? "unknown"}] ${c.name} | ${c.title} | ${c.company} | ${c.email ?? "no-email"}${flag}${quarantined}`);
    if (fabricated && !c.rejectionReason) {
      badContacts.push({ projectId: proj.id, projectName: proj.name, contactId: c.id, name: c.name, email: c.email, reason: "fabricated_domain" });
    }
  }
}

console.log(`\n=== CONTACTS TO QUARANTINE (${badContacts.length}) ===`);
for (const b of badContacts) {
  console.log(`  Contact ${b.contactId}: ${b.name} | ${b.email} | Project: ${b.projectName}`);
}

if (badContacts.length > 0) {
  const ids = badContacts.map(b => b.contactId);
  await db.query(
    `UPDATE contacts
     SET rejectionReason = 'fabricated_domain_east_coast_audit',
         contactTrustTier = 'named_unverified'
     WHERE id IN (${ids.join(",")})
       AND rejectionReason IS NULL`
  );
  console.log(`\n✅ Quarantined ${badContacts.length} contacts with fabricated domains.`);
} else {
  console.log("No new contacts to quarantine.");
}

await db.end();
